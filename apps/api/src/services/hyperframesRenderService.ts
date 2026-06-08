import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { VideoEditContext } from '@viral-struct/video-agent';
import {
  createDoubaoHyperframesAuthor,
  ensureRootDuration,
  mockHyperframesComposition,
  type HyperframesAuthor,
  type HyperframesAssetRef,
  type HyperframesAuthorInput
} from './hyperframesAuthor';
import { rewriteAssetCardUrlsToDisk } from './authoredRenderService';
import { createDoubaoCritic, type CritiqueResult, type HyperframesCritic } from './hyperframesCritic';
import { getRenderDir } from './videoPaths';

// Pin the renderer version: the determinism caveat warns pixels move across HyperFrames/Chrome versions.
const PINNED_HYPERFRAMES = process.env.HYPERFRAMES_VERSION ?? 'hyperframes@0.6.80';

const HF_MANIFEST = {
  $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
  registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
  paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }
};

/** Authored HyperFrames render is opt-in (default OFF), mirroring USE_AUTHORED_RENDER. */
export function hyperframesRenderEnabled(explicit?: boolean): boolean {
  return explicit ?? process.env.USE_HYPERFRAMES_RENDER === 'true';
}

export interface HyperframesLintResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface HyperframesRenderResult {
  rendered: boolean;
  mediaUrl: string | null;
  projectDir: string;
  source: 'llm' | 'mock';
  lint: HyperframesLintResult;
  inspectIssues: string[];
  critique?: CritiqueResult;
  assetCount: number;
  log: string;
  html: string;
}

export interface HyperframesRenderDeps {
  /** Inject the HTML author. Default: Doubao via createOpenAICompatibleClient; falls back to the deterministic mock. */
  author?: HyperframesAuthor;
  /** Override the spawned binary (tests). Default 'npx'. */
  npxBin?: string;
  /** Override the pinned hyperframes spec (tests). */
  pinnedVersion?: string;
  /** Max LLM self-heal retries on lint errors (default 2). */
  maxHealAttempts?: number;
  /** Render timeout ms (default 8 min). */
  renderTimeoutMs?: number;
  /** Inject the aesthetic critic (vision LLM). undefined → build from env; null → disable. */
  critic?: HyperframesCritic | null;
  /** Max critic revise rounds (default 1). */
  maxCriticRounds?: number;
}

// <img>/<video> media src references (NOT <script src>, which may legitimately be the GSAP CDN).
const MEDIA_SRC_RE = /<(?:img|video)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
// CSS url(...) references (background images etc.).
const CSS_URL_RE = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;

/**
 * Honesty + safety gate: every image/video reference must be a local ./assets/<file>
 * that actually exists in the project assets dir. External URLs, data: images, or
 * invented filenames are violations → caller falls back to the deterministic mock.
 */
export function validateComposition(html: string, assetsDir: string): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const check = (ref: string, where: string) => {
    const v = ref.trim();
    const m = /^\.?\/?assets\/(.+)$/.exec(v);
    if (!m) {
      violations.push(`${where}: non-local reference "${v}"`);
      return;
    }
    if (!existsSync(path.join(assetsDir, m[1]))) {
      violations.push(`${where}: missing asset "${v}"`);
    }
  };
  let m: RegExpExecArray | null;
  while ((m = MEDIA_SRC_RE.exec(html))) check(m[1], 'media src');
  while ((m = CSS_URL_RE.exec(html))) check(m[1], 'css url');
  return { ok: violations.length === 0, violations };
}

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Spawn a plain executable (ffmpeg/ffprobe .exe) — no shell, so args with spaces (paths) pass safely. */
function spawnPlain(bin: string, args: string[], timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', (c) => (stdout += String(c)));
    proc.stderr.on('data', (c) => (stderr += String(c)));
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err) });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** Extract `count` evenly-spaced keyframes from a rendered MP4 using system ffmpeg/ffprobe (for the critic). */
async function extractFrames(mp4: string, projectDir: string, count: number): Promise<string[]> {
  const probe = await spawnPlain('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], 30_000);
  const dur = parseFloat((probe.stdout || '').trim()) || 15;
  const framesDir = path.join(projectDir, '_frames');
  mkdirSync(framesDir, { recursive: true });
  const frames: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = ((dur * (i + 0.5)) / count).toFixed(2);
    const fp = path.join(framesDir, `f${i}.png`);
    await spawnPlain('ffmpeg', ['-y', '-ss', t, '-i', mp4, '-frames:v', '1', '-update', '1', fp], 30_000);
    if (existsSync(fp)) frames.push(fp);
  }
  return frames;
}

function spawnHf(args: string[], cwd: string, npxBin: string, pinned: string, timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    // shell:true is REQUIRED on Windows: npx is npx.cmd, and Node>=20 throws EINVAL/ENOENT
    // spawning a .cmd without a shell (CVE-2024-27980). Our args are fixed tokens (no spaces),
    // so shell quoting is safe; the spaces-bearing cwd is passed via the `cwd` option, not argv.
    const proc = spawn(npxBin, ['--yes', pinned, ...args], {
      cwd,
      env: { ...process.env, HYPERFRAMES_NO_UPDATE_CHECK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stdout.on('data', (c) => (stdout += String(c)));
    proc.stderr.on('data', (c) => (stderr += String(c)));
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err) });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function extractJson(s: string): string | null {
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  return i !== -1 && j > i ? s.slice(i, j + 1) : null;
}

/**
 * Parse `hyperframes lint --json`. Only severity==='error' findings block the render;
 * warnings are advisory. The exit code is NOT used to decide `ok` when findings parse
 * (the CLI may exit non-zero on warnings, and stdout may carry a banner before the JSON).
 */
function parseLint(res: SpawnResult): HyperframesLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let parsed = false;
  const jsonText = extractJson(res.stdout);
  if (jsonText) {
    try {
      const data = JSON.parse(jsonText) as Record<string, unknown>;
      const findings = (data.findings ?? data.issues ?? data.results ?? data.diagnostics) as
        | Array<Record<string, unknown>>
        | undefined;
      if (Array.isArray(findings)) {
        parsed = true;
        for (const f of findings) {
          const sev = String(f.severity ?? f.level ?? '').toLowerCase();
          const msg = String(f.message ?? f.code ?? f.detail ?? JSON.stringify(f));
          if (sev === 'error' || sev === 'fatal') errors.push(msg);
          else warnings.push(msg);
        }
      } else {
        const dataErrors = (data as Record<string, unknown>).errors;
        if (Array.isArray(dataErrors)) {
          parsed = true;
          for (const e of dataErrors) errors.push(String((e as Record<string, unknown>)?.message ?? e));
        } else if (data && typeof data === 'object') {
          parsed = true; // valid envelope, no findings array => no errors
        }
      }
    } catch {
      parsed = false;
    }
  }
  if (!parsed && res.code !== 0) {
    errors.push((res.stderr || res.stdout || `lint exited ${res.code}`).slice(-500).trim());
  }
  return { ok: errors.length === 0, errors, warnings };
}

/** Parse `hyperframes inspect --json` into a flat list of actionable issues (overflow / clip / off-canvas). */
function parseInspect(res: SpawnResult): string[] {
  const issues: string[] = [];
  const jsonText = extractJson(res.stdout);
  if (jsonText) {
    try {
      const data = JSON.parse(jsonText) as Record<string, unknown>;
      const findings = (data.findings ?? data.issues ?? data.results) as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(findings)) {
        for (const f of findings) {
          const sev = String(f.severity ?? f.level ?? '').toLowerCase();
          if (sev === 'error' || sev === 'warning' || sev === 'fatal') {
            issues.push(String(f.message ?? f.code ?? f.detail ?? JSON.stringify(f)));
          }
        }
      }
    } catch {
      /* unparseable inspect output → surface no issues */
    }
  }
  return issues;
}

function buildAssetRefs(context: VideoEditContext, assetsDir: string, log: string[]): HyperframesAssetRef[] {
  const refs: HyperframesAssetRef[] = [];
  const seen = new Set<string>();
  for (const card of rewriteAssetCardUrlsToDisk(context.assetCards)) {
    if (card.type !== 'image' || !card.url) continue;
    const src = card.url; // disk path after rewrite
    if (!existsSync(src)) {
      log.push(`asset ${card.id}: source not found on disk (${src})`);
      continue;
    }
    const base = path.basename(src);
    if (seen.has(base)) continue;
    seen.add(base);
    try {
      copyFileSync(src, path.join(assetsDir, base));
      refs.push({ assetId: card.id, relPath: `./assets/${base}`, description: card.spatialDescription });
    } catch (err) {
      log.push(`asset ${card.id}: copy failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return refs;
}

/**
 * Produce a real-pixel ad by having the LLM (Doubao) author a HyperFrames composition,
 * then rendering it with the HyperFrames CLI. Scaffolds a temp project under getRenderDir(),
 * copies the matched REAL images into assets/, lints (self-heal ≤N), enforces honesty
 * (only real local assets), and renders. Never throws — returns a structured result.
 */
export async function hyperframesRenderFromContext(
  context: VideoEditContext,
  deps: HyperframesRenderDeps = {}
): Promise<HyperframesRenderResult> {
  const npxBin = deps.npxBin ?? 'npx';
  const pinned = deps.pinnedVersion ?? PINNED_HYPERFRAMES;
  const maxRevise = deps.maxHealAttempts ?? 3;
  const maxCriticRounds = deps.maxCriticRounds ?? 1;
  const renderTimeoutMs = deps.renderTimeoutMs ?? 8 * 60_000;
  const lintTimeoutMs = 90_000;

  const id = nanoid(10);
  const projectDir = path.join(getRenderDir(), `hf_${id}`);
  const assetsDir = path.join(projectDir, 'assets');
  const indexPath = path.join(projectDir, 'index.html');
  const outFile = path.join(projectDir, 'out.mp4');
  const log: string[] = [];

  const result: HyperframesRenderResult = {
    rendered: false,
    mediaUrl: null,
    projectDir,
    source: 'mock',
    lint: { ok: false, errors: [], warnings: [] },
    inspectIssues: [],
    assetCount: 0,
    log: '',
    html: ''
  };

  try {
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(path.join(projectDir, 'hyperframes.json'), JSON.stringify(HF_MANIFEST, null, 2), 'utf8');
    writeFileSync(
      path.join(projectDir, 'meta.json'),
      JSON.stringify({ id: `hf_${id}`, name: context.contentBrief.productName ?? 'ad', createdAt: new Date().toISOString() }, null, 2),
      'utf8'
    );

    const assetRefs = buildAssetRefs(context, assetsDir, log);
    result.assetCount = assetRefs.length;

    const input: HyperframesAuthorInput = {
      contentBrief: context.contentBrief,
      assetRefs,
      aspectRatio: context.constraints?.aspectRatio ?? '9:16',
      structureGraph: context.structureGraph,
      constraints: {
        allowAigc: context.constraints?.allowAigc,
        forbiddenClaims: context.constraints?.forbiddenClaims,
        allowedClaimSources: context.constraints?.allowedClaimSources
      }
    };

    let author = deps.author;
    if (!author) {
      try {
        author = createDoubaoHyperframesAuthor();
      } catch (err) {
        log.push(`no LLM author (${err instanceof Error ? err.message : String(err)}) → mock fallback`);
        author = undefined;
      }
    }

    // 1) LLM author with a REVISE loop: self-heal lint errors, then revise on `inspect` findings
    //    (caption overflow / clipped / off-canvas). The last lint-clean candidate is a safety net so a
    //    regressing revision never drops us to the mock.
    if (author && assetRefs.length > 0) {
      try {
        let candidate = ensureRootDuration(await author.authorComposition(input));
        let lastClean: { html: string; lint: HyperframesLintResult } | null = null;
        for (let attempt = 0; attempt <= maxRevise; attempt++) {
          const honesty = validateComposition(candidate, assetsDir);
          if (!honesty.ok) {
            log.push(`honesty gate failed (attempt ${attempt}): ${honesty.violations.join('; ')}`);
            break;
          }
          writeFileSync(indexPath, candidate, 'utf8');
          const lint = parseLint(await spawnHf(['lint', '.', '--json'], projectDir, npxBin, pinned, lintTimeoutMs));
          log.push(`lint attempt ${attempt}: ok=${lint.ok} errors=${lint.errors.length} warnings=${lint.warnings.length}${lint.errors.length ? ` :: ${lint.errors.join(' | ')}` : ''}`);
          if (!lint.ok) {
            if (attempt < maxRevise) {
              candidate = ensureRootDuration(await author.authorComposition(input, { html: candidate, issues: lint.errors }));
              continue;
            }
            break; // lint never clean
          }
          lastClean = { html: candidate, lint };
          const inspectIssues = parseInspect(await spawnHf(['inspect', '.', '--json', '--samples', '9'], projectDir, npxBin, pinned, lintTimeoutMs));
          log.push(`inspect attempt ${attempt}: ${inspectIssues.length} issue(s)`);
          if (inspectIssues.length === 0 || attempt === maxRevise) {
            result.html = candidate;
            result.source = 'llm';
            result.lint = lint;
            result.inspectIssues = inspectIssues;
            break;
          }
          candidate = ensureRootDuration(await author.authorComposition(input, { html: candidate, issues: inspectIssues }));
        }
        // Locked in nothing but had a lint-clean candidate → use it instead of the mock.
        if (result.source !== 'llm' && lastClean) {
          writeFileSync(indexPath, lastClean.html, 'utf8');
          result.html = lastClean.html;
          result.source = 'llm';
          result.lint = lastClean.lint;
        }
      } catch (err) {
        log.push(`LLM author failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 2) Deterministic fallback if the LLM path didn't yield a lint-clean, honest composition.
    if (result.source !== 'llm') {
      result.source = 'mock';
      const mock = ensureRootDuration(mockHyperframesComposition(input));
      result.html = mock;
      writeFileSync(indexPath, mock, 'utf8');
      result.lint = parseLint(await spawnHf(['lint', '.', '--json'], projectDir, npxBin, pinned, lintTimeoutMs));
      log.push(`mock lint: ok=${result.lint.ok} errors=${result.lint.errors.length}`);
    }

    // 3) Render (if lint clean), then an optional vision-critic pass that re-authors + re-renders once.
    if (result.lint.ok) {
      const renderProject = async (outName: string): Promise<boolean> => {
        const r = await spawnHf(
          ['render', '-c', 'index.html', '-o', outName, '--fps', '30', '--resolution', 'portrait', '--quality', 'high'],
          projectDir,
          npxBin,
          pinned,
          renderTimeoutMs
        );
        log.push(`render ${outName}: code=${r.code}`);
        log.push((r.stderr || r.stdout).slice(-300));
        return existsSync(path.join(projectDir, outName));
      };

      result.rendered = await renderProject('out.mp4');
      result.mediaUrl = result.rendered ? `/media/renders/hf_${id}/out.mp4` : null;

      // Aesthetic critic: a vision LLM scores rendered keyframes → concrete fixes → one re-author + re-render.
      if (result.rendered && result.source === 'llm' && author && maxCriticRounds > 0) {
        let critic = deps.critic;
        if (critic === undefined) {
          try {
            critic = createDoubaoCritic();
          } catch (err) {
            log.push(`critic unavailable (${err instanceof Error ? err.message : String(err)})`);
            critic = null;
          }
        }
        if (critic) {
          for (let round = 0; round < maxCriticRounds; round += 1) {
            let frames: string[] = [];
            try {
              frames = await extractFrames(path.join(projectDir, 'out.mp4'), projectDir, 5);
            } catch (err) {
              log.push(`frame extract failed: ${err instanceof Error ? err.message : String(err)}`);
              break;
            }
            if (frames.length === 0) break;
            let critique: CritiqueResult;
            try {
              critique = await critic.critique(frames, { contentBrief: context.contentBrief, inspectIssues: result.inspectIssues });
            } catch (err) {
              log.push(`critic skipped: ${err instanceof Error ? err.message : String(err)}`);
              break;
            }
            result.critique = critique;
            log.push(`critique round ${round}: verdict=${critique.verdict} score=${critique.score.toFixed(2)} issues=${critique.issues.length} fixes=${critique.fixes.length}`);
            if (critique.verdict !== 'revise' || (critique.fixes.length === 0 && critique.issues.length === 0)) break;

            const revised = ensureRootDuration(await author.authorComposition(input, { html: result.html, issues: [...critique.issues, ...critique.fixes] }));
            if (!validateComposition(revised, assetsDir).ok) {
              log.push('critic revision failed honesty gate; keeping prior render');
              break;
            }
            writeFileSync(indexPath, revised, 'utf8');
            const l2 = parseLint(await spawnHf(['lint', '.', '--json'], projectDir, npxBin, pinned, lintTimeoutMs));
            if (!l2.ok) {
              log.push('critic revision lint failed; reverting to prior render');
              writeFileSync(indexPath, result.html, 'utf8');
              break;
            }
            const revisedOut = `out_r${round + 1}.mp4`;
            if (!(await renderProject(revisedOut))) {
              log.push('critic re-render failed; keeping prior render');
              writeFileSync(indexPath, result.html, 'utf8');
              break;
            }
            // Regression guard: re-critique the revision; keep it ONLY if it scores >= the prior cut.
            try {
              const revisedFrames = await extractFrames(path.join(projectDir, revisedOut), projectDir, 5);
              const revisedCritique = await critic.critique(revisedFrames, { contentBrief: context.contentBrief, inspectIssues: [] });
              log.push(`re-critique: score=${revisedCritique.score.toFixed(2)} (prior ${critique.score.toFixed(2)})`);
              if (revisedCritique.score > critique.score) {
                result.html = revised;
                result.lint = l2;
                result.mediaUrl = `/media/renders/hf_${id}/${revisedOut}`;
                result.critique = revisedCritique;
                log.push('critic revision kept (strictly better than prior)');
              } else {
                writeFileSync(indexPath, result.html, 'utf8');
                log.push('critic revision not better → reverted to prior render');
              }
            } catch (err) {
              writeFileSync(indexPath, result.html, 'utf8');
              log.push(`re-critique failed (${err instanceof Error ? err.message : String(err)}); kept prior render`);
            }
            break; // one critic revision attempt
          }
        }
      }
    } else {
      log.push('lint not clean → render skipped');
    }
  } catch (err) {
    log.push(`hyperframes render error: ${err instanceof Error ? err.message : String(err)}`);
  }

  result.log = log.join('\n');
  return result;
}
