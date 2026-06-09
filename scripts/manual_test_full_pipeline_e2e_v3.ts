/**
 * Full pipeline E2E v3 — proves the ③ video-agent SEAM end-to-end with NO LLM.
 *
 * This is the migration-direction counterpart to manual_test_full_pipeline_e2e.ts (which drives
 * ①'s middle: planGapRepairs → generateTimelineMock → TimelineItem). This v3 script drives ③:
 *
 *     ② buildAssetSupplyContext (kept — asset scan / coverage)
 *     + ① matchSlots            (kept — shared slot matcher → slotMatches + materialGaps)
 *        → VideoEditContext
 *        → ③ planGapFills        (deterministic, no LLM)
 *        → ③ authorTimeline      (mock author — no LLM key injected)  → AuthoredTimeline
 *        → ③ AuthoredFfmpegExecutor.render (best-effort real MP4)
 *
 * Purpose: prove the seam that has never been exercised end-to-end. The AuthoredTimeline proof
 * ALWAYS runs (offline, deterministic). The MP4 render is best-effort: it runs only when ffmpeg
 * is on PATH, resolves each media layer's path to absolute, and prunes layers whose source file is
 * absent (those beats render as the executor's honest colour/substitute card). A missing ffmpeg or
 * a render error never fails the seam proof — it is reported as skipped.
 *
 * Run (uses the api package's tsx; the script's own imports resolve from its file location):
 *   pnpm --filter @viral-struct/api exec node --import tsx ../../scripts/manual_test_full_pipeline_e2e_v3.ts
 *
 * Root scripts are not part of any package's tsconfig, so (like the v1 e2e) this imports workspace
 * code via RELATIVE source paths and never via a bare `@viral-struct/*` specifier (the repo root has
 * no such symlink). Bare specifiers INSIDE the imported packages resolve via their own node_modules.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetCard, ContentBrief, ViralStructureGraph, AuthoredTimeline } from '../packages/shared/src/index';
import { buildAssetSupplyContext } from '../apps/api/src/services/assetManager/assetSupplyContextBuilder';
import { normalizeAssetCards } from '../apps/api/src/services/assetManager/assetNormalizer';
import { buildDeterministicPreset } from '../apps/api/src/services/motifs/categoryPresetProvider';
import { matchSlots } from '../apps/api/src/services/slotMatcher';
import { planGapFills, authorTimeline } from '../packages/video-agent/src/index';
import type { VideoEditContext, EditConstraints } from '../packages/video-agent/src/context/VideoEditContext';
import { AuthoredFfmpegExecutor } from '../packages/render-executor/src/index';
import type { RenderResult } from '../packages/render-executor/src/RenderContract';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = path.join(repoRoot, 'tmp');

const INPUTS = {
  structureGraph: 'seed_assets/analysis/macbook_neo/structure_graph.json',
  plainAssetCards: 'seed_assets/asset_libraries/kangshifu_plain_user_test/asset_cards.json'
} as const;

const OUTPUTS = {
  json: 'tmp/full-pipeline-e2e-v3.json',
  report: 'tmp/full-pipeline-e2e-v3-report.md',
  mp4: 'tmp/full-pipeline-e2e-v3.mp4'
} as const;

const beverageBrief: ContentBrief = {
  productName: '康师傅冰红茶',
  category: 'beverage',
  targetAudience: '夏天通勤、聚餐、户外活动中的年轻消费者',
  scenario: '炎热天气、饭后解腻、朋友聚会时需要冰爽饮品',
  sellingPoints: ['冰爽解腻', '柠檬茶香', '适合聚餐分享', '冰镇后口感更清爽'],
  cta: '现在就来一瓶康师傅冰红茶',
  stylePreference: '普通用户真实素材，验证 ③ video-agent 端到端拼接（mock author，无 LLM）'
};

interface RenderOutcome {
  rendered: boolean;
  reason?: string;
  result?: RenderResult;
}

interface E2Ev3Output {
  generatedAt: string;
  inputs: typeof INPUTS;
  outputs: typeof OUTPUTS;
  assetCount: number;
  coverageScore: number;
  slotMatches: { total: number; matched: number; partial: number; missing: number };
  materialGaps: number;
  gapFills: {
    total: number;
    byMethod: Record<string, number>;
    resolved: number;
    unresolved: number;
  };
  authoredTimeline: {
    source: 'llm' | 'mock';
    beatCount: number;
    beatsWithRealMedia: number;
    honestSubstituteBeats: number;
    trace: Record<string, unknown>;
  };
  render: RenderOutcome;
  seamAssertions: { name: string; passed: boolean; detail: string }[];
  verdict: 'passed' | 'failed';
}

async function main(): Promise<void> {
  mkdirSync(tmpDir, { recursive: true });
  const result = await buildE2Ev3();
  writeText(OUTPUTS.json, `${JSON.stringify(result, null, 2)}\n`);
  writeText(OUTPUTS.report, buildReport(result));

  console.log('Full pipeline E2E v3 (③ video-agent seam) complete.');
  console.log(`- assets=${result.assetCount} coverage=${result.coverageScore}`);
  console.log(`- slotMatches matched/partial/missing=${result.slotMatches.matched}/${result.slotMatches.partial}/${result.slotMatches.missing}`);
  console.log(`- gapFills=${result.gapFills.total} (resolved=${result.gapFills.resolved} unresolved=${result.gapFills.unresolved}) byMethod=${JSON.stringify(result.gapFills.byMethod)}`);
  console.log(`- authoredTimeline source=${result.authoredTimeline.source} beats=${result.authoredTimeline.beatCount} realMedia=${result.authoredTimeline.beatsWithRealMedia} substitutes=${result.authoredTimeline.honestSubstituteBeats}`);
  console.log(`- render rendered=${result.render.rendered}${result.render.reason ? ` (${result.render.reason})` : ''}${result.render.result ? ` → ${result.render.result.outputPath}` : ''}`);
  for (const a of result.seamAssertions) console.log(`  ${a.passed ? 'PASS' : 'FAIL'} ${a.name}: ${a.detail}`);
  console.log(`- verdict=${result.verdict}`);
  console.log(`Wrote ${OUTPUTS.json}`);
  console.log(`Wrote ${OUTPUTS.report}`);

  if (result.verdict !== 'passed') process.exitCode = 1;
}

export async function buildE2Ev3(): Promise<E2Ev3Output> {
  const structureGraph = readJson<ViralStructureGraph>(INPUTS.structureGraph);
  const plainCards = normalizeAssetCards(readJson<AssetCard[]>(INPUTS.plainAssetCards));
  const beveragePreset = buildDeterministicPreset({
    category: 'beverage',
    availableAssets: plainCards.map((asset) => asset.id)
  });

  // ② kept: asset scan / contextual coverage. We feed its enriched assets forward (per the agreed
  // "keep ②'s scan/gap/match, hand to ③" decision).
  const assetSupplyContext = buildAssetSupplyContext({
    structureGraph,
    assetCards: plainCards,
    contentBrief: beverageBrief,
    libraryId: 'e2e_v3_seam',
    categoryPreset: beveragePreset,
    options: { userCanGenerate: false }
  });

  // ① kept: shared slot matcher → the slotMatches + materialGaps that VideoEditContext requires.
  const matchResult = matchSlots(structureGraph, assetSupplyContext.assets);
  const matched = matchResult.matches.filter((m) => m.status === 'matched').length;
  const partial = matchResult.matches.filter((m) => m.status === 'partial').length;
  const missing = matchResult.matches.length - matched - partial;

  const constraints: EditConstraints = {
    aspectRatio: (structureGraph.meta?.aspectRatio as EditConstraints['aspectRatio']) ?? '9:16',
    allowAigc: true,
    allowHumanGeneration: false,
    allowedClaimSources: beverageBrief.sellingPoints,
    forbiddenClaims: []
  };

  const context: VideoEditContext = {
    projectId: 'e2e_v3_kangshifu',
    structureGraph,
    contentBrief: beverageBrief,
    assetCards: assetSupplyContext.assets,
    slotMatches: matchResult.matches,
    materialGaps: matchResult.gaps,
    constraints
  };

  // ③ gap planner (deterministic, no LLM) — validates each plan against GapFillPlanSchema internally.
  const gapFills = planGapFills(context);
  const byMethod: Record<string, number> = {};
  for (const plan of gapFills) byMethod[plan.method] = (byMethod[plan.method] ?? 0) + 1;
  const unresolved = gapFills.filter((p) => p.resolutionStatus === 'unresolved').length;

  // ③ author (mock — no LLM key injected) → schema-valid AuthoredTimeline.
  const authored = await authorTimeline(context);
  const beatsWithRealMedia = authored.timeline.beats.filter((b) => (b.mediaLayers?.length ?? 0) > 0).length;
  const honestSubstituteBeats = authored.timeline.beats.filter((b) => Boolean((b as { unresolvedReason?: string }).unresolvedReason)).length;

  // ③ render bridge — best-effort real MP4.
  const render = await tryRender(authored.timeline, path.join(repoRoot, OUTPUTS.mp4));

  const seamAssertions = [
    {
      name: 'author_is_offline_mock',
      passed: authored.source === 'mock',
      detail: `authorTimeline source=${authored.source} (expected mock with no LLM injected)`
    },
    {
      name: 'authored_timeline_non_empty',
      passed: authored.timeline.beats.length > 0,
      detail: `${authored.timeline.beats.length} beat(s) authored from ${structureGraph.segments.length} segment(s)`
    },
    {
      name: 'gap_fills_cover_all_gaps',
      passed: gapFills.length === matchResult.gaps.length,
      detail: `${gapFills.length} gap-fill plan(s) for ${matchResult.gaps.length} material gap(s)`
    },
    {
      name: 'real_assets_composited',
      passed: beatsWithRealMedia > 0,
      detail: `${beatsWithRealMedia} beat(s) carry a real matched media layer`
    }
  ];
  const verdict: 'passed' | 'failed' = seamAssertions.every((a) => a.passed) ? 'passed' : 'failed';

  return {
    generatedAt: new Date().toISOString(),
    inputs: INPUTS,
    outputs: OUTPUTS,
    assetCount: assetSupplyContext.assets.length,
    coverageScore: assetSupplyContext.contextualCoverage?.coverageSummary.coverageScore ?? 0,
    slotMatches: { total: matchResult.matches.length, matched, partial, missing },
    materialGaps: matchResult.gaps.length,
    gapFills: { total: gapFills.length, byMethod, resolved: gapFills.length - unresolved, unresolved },
    authoredTimeline: {
      source: authored.source,
      beatCount: authored.timeline.beats.length,
      beatsWithRealMedia,
      honestSubstituteBeats,
      trace: authored.trace as Record<string, unknown>
    },
    render,
    seamAssertions,
    verdict
  };
}

/**
 * Best-effort render. Resolves each media layer's resolvedPath to an absolute path and prunes layers
 * whose source file is absent so the executor falls back to its honest colour/substitute card for
 * those beats. Skips cleanly (never throws) when ffmpeg is missing or rendering fails.
 */
async function tryRender(timeline: AuthoredTimeline, outputPath: string): Promise<RenderOutcome> {
  if (!ffmpegAvailable()) return { rendered: false, reason: 'ffmpeg not on PATH; AuthoredTimeline proven without MP4 render' };
  try {
    const resolved = resolveMediaPaths(timeline);
    const executor = new AuthoredFfmpegExecutor({ outputPath });
    const result = await executor.render(resolved);
    return { rendered: true, result };
  } catch (error) {
    return { rendered: false, reason: `render error (seam still proven by AuthoredTimeline): ${String(error)}` };
  }
}

function ffmpegAvailable(): boolean {
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return probe.status === 0;
}

function resolveMediaPaths(timeline: AuthoredTimeline): AuthoredTimeline {
  const beats = timeline.beats.map((beat) => {
    const mediaLayers = (beat.mediaLayers ?? [])
      .map((layer) => {
        const rp = layer.media?.resolvedPath;
        if (!rp) return layer;
        const abs = path.isAbsolute(rp) ? rp : path.join(repoRoot, rp);
        if (!existsSync(abs)) return null; // prune → beat renders as colour/substitute card
        return { ...layer, media: { ...layer.media, resolvedPath: abs } };
      })
      .filter((layer): layer is NonNullable<typeof layer> => layer !== null);
    return { ...beat, mediaLayers };
  });
  return { ...timeline, beats };
}

function buildReport(result: E2Ev3Output): string {
  const r = result.render;
  return [
    '# Full Pipeline E2E v3 — ③ video-agent seam (mock author, no LLM)',
    '',
    `Generated: ${result.generatedAt}`,
    '',
    '## Seam',
    '',
    '```',
    '② buildAssetSupplyContext + ① matchSlots',
    '  → VideoEditContext',
    '  → ③ planGapFills (no LLM)',
    '  → ③ authorTimeline (mock author, no LLM)  → AuthoredTimeline',
    '  → ③ AuthoredFfmpegExecutor.render (best-effort MP4)',
    '```',
    '',
    '## Result summary',
    '',
    markdownTable(
      ['metric', 'value'],
      [
        ['assets', String(result.assetCount)],
        ['② coverage score', String(result.coverageScore)],
        ['slot matches (matched/partial/missing)', `${result.slotMatches.matched}/${result.slotMatches.partial}/${result.slotMatches.missing}`],
        ['material gaps', String(result.materialGaps)],
        ['③ gap-fill plans (resolved/unresolved)', `${result.gapFills.resolved}/${result.gapFills.unresolved}`],
        ['③ gap-fill methods', JSON.stringify(result.gapFills.byMethod)],
        ['③ authored timeline source', result.authoredTimeline.source],
        ['③ beats (real media / honest substitute)', `${result.authoredTimeline.beatsWithRealMedia} / ${result.authoredTimeline.honestSubstituteBeats} of ${result.authoredTimeline.beatCount}`],
        ['render', r.rendered ? `MP4 → ${r.result?.outputPath}` : `skipped (${r.reason})`]
      ]
    ),
    '',
    '## Seam assertions',
    '',
    markdownTable(
      ['assertion', 'passed', 'detail'],
      result.seamAssertions.map((a) => [a.name, a.passed ? 'yes' : 'NO', a.detail])
    ),
    '',
    r.rendered && r.result
      ? [
          '## Render manifest',
          '',
          markdownTable(
            ['beat', 'source', 'frames', 'unresolved'],
            r.result.manifest.map((m) => [m.id, m.source, String(m.frames), String(m.unresolvedEvidence)])
          ),
          '',
          `- durationMs: ${r.result.durationMs}`,
          `- segmentCount: ${r.result.segmentCount}`,
          `- warnings: ${r.result.warnings.join(' / ') || 'none'}`
        ].join('\n')
      : '## Render\n\nMP4 render skipped or failed; the AuthoredTimeline seam proof above is authoritative.',
    '',
    `## Verdict: ${result.verdict.toUpperCase()}`,
    '',
    '- This script renders an MP4 only as best-effort proof; ① is not touched. No LLM is called.'
  ].join('\n');
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((c) => c.replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')} |`)
  ].join('\n');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;
}

function writeText(relativePath: string, value: string): void {
  const absolutePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, value, 'utf8');
}

if (process.argv[1] && existsSync(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
