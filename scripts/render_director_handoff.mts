/**
 * THROWAWAY: render the director-agent handoff (.tmp/test) into a baseline real-footage MP4.
 *
 * The handoff IS an AuthoredTimeline (+ an extra per-beat `enhancement` block the executor ignores).
 * The only wiring needed (per the render-feasibility audit) is to remap each beat media.resolvedPath
 * — which points at a non-existent `tmp/iced_tea_small/<name>` — BY BASENAME to the real asset dir,
 * then feed the timeline straight to AuthoredFfmpegExecutor.render (no schema/canonicalizer).
 *
 * Honesty: every layer is tier:'real' footage; we fail loudly if any asset basename is missing
 * (never silently substitute). This produces the BASELINE cut only — no `enhancement` (hyperframes)
 * treatment, no audio, no text — see the report.
 *
 * Run:  cd apps/api && node --import tsx ../../scripts/render_director_handoff.mts
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuthoredTimeline } from '../packages/shared/src/index';
import { AuthoredFfmpegExecutor } from '../packages/render-executor/src/index';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = path.join(repoRoot, '.tmp', 'test');
const assetDir = path.join(testDir, 'kangshifu_iced_tea');
const handoffPath = path.join(testDir, 'director-agent-authored-handoff(1).json');
const outDir = path.join(testDir, 'out');
mkdirSync(outDir, { recursive: true });
const outputPath = path.join(outDir, 'director_baseline.mp4');

const timeline = JSON.parse(readFileSync(handoffPath, 'utf8')) as AuthoredTimeline;

// basename -> absolute path index of the real asset dir
const byBasename = new Map<string, string>();
for (const f of readdirSync(assetDir)) byBasename.set(f, path.join(assetDir, f).replace(/\\/g, '/'));

// remap every beat's media.resolvedPath by basename; collect any that don't resolve
const missing: string[] = [];
const mapping: Array<{ beat: string; role: string; secs: string; file: string }> = [];
for (const beat of timeline.beats) {
  for (const layer of beat.mediaLayers ?? []) {
    const rp = layer.media?.resolvedPath;
    if (!rp) continue;
    const base = path.basename(rp);
    const abs = byBasename.get(base);
    if (!abs || !existsSync(abs)) {
      missing.push(`${beat.id} -> ${base}`);
      continue;
    }
    layer.media.resolvedPath = abs;
    mapping.push({ beat: beat.id, role: beat.segmentRole, secs: `${beat.startSeconds}-${beat.endSeconds}`, file: base });
  }
}

console.log('=== beat -> asset mapping ===');
for (const m of mapping) console.log(`  ${m.secs.padEnd(16)} ${m.role.padEnd(13)} ${m.file}`);
if (missing.length) {
  console.error('\nABORT — unresolved assets (no basename match in asset dir):');
  for (const m of missing) console.error('  ' + m);
  process.exit(1);
}

console.log(`\nrendering ${timeline.beats.length} beats @ ${timeline.renderProfile.width}x${timeline.renderProfile.height}@${timeline.renderProfile.fps} -> ${outputPath}`);
const result = await new AuthoredFfmpegExecutor({ outputPath }).render(timeline);
console.log('=== RESULT ===');
console.log(JSON.stringify(
  {
    ok: result.ok,
    rendered: result.rendered,
    outputPath: result.outputPath,
    durationMs: result.durationMs,
    frameCount: result.frameCount,
    segmentCount: result.segmentCount,
    warnings: (result as { warnings?: string[] }).warnings ?? []
  },
  null,
  2
));
