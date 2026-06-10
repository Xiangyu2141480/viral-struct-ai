/**
 * RUNNER — Director handoff → Wan2.7 AIGC generation → stitched MP4.
 *
 * Reads a Director `OrchestratedTimeline` JSON + the asset library + a global product reference image, routes
 * each beat to the right Wan2.7 model (aigcHelper), generates the gap/partial beats concurrently, and stitches
 * everything (generated clips + matched real clips) in timeline order — keeping each beat's own audio (P1).
 *
 * Run (from repo root, needs .env with DASHSCOPE_API_KEY / WAN_WORKSPACE_ID, plus ffmpeg):
 *   node --import tsx scripts/render_director_aigc.mts \
 *     ORCHESTRATED_TIMELINE=path/to/orchestrated_timeline.json \
 *     ASSET_CARDS=path/to/asset_cards.json \
 *     PRODUCT_IMAGE=seed_assets/demo_assets/kangshifu_iced_tea/kangshifu-iced-tea-product-shot.png \
 *     OUT=tmp/director_aigc.mp4
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetCard, OrchestratedTimeline } from '@viral-struct/shared';
import { planAigcBeats } from '@viral-struct/video-agent';
import { renderAigcTimeline } from '../apps/api/src/services/videoAgent/aigcRenderer';
import { wanConfigFromEnv } from '../apps/api/src/services/videoAgent/wanVideoClient';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(match[1]! in process.env)) process.env[match[1]!] = value;
  }
}

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : process.env[name] ?? fallback;
}

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(path.isAbsolute(p) ? p : path.join(repoRoot, p), 'utf8')) as T;
}

async function main(): Promise<void> {
  loadEnv(path.join(repoRoot, '.env'));

  const timelinePath = arg('ORCHESTRATED_TIMELINE');
  const assetsPath = arg('ASSET_CARDS');
  const productImage = arg('PRODUCT_IMAGE');
  const out = arg('OUT', 'tmp/director_aigc.mp4')!;
  const productName = arg('PRODUCT_NAME');
  const concurrency = Number(arg('CONCURRENCY', '4'));

  if (!timelinePath || !assetsPath) {
    console.error('Required: ORCHESTRATED_TIMELINE=<json> ASSET_CARDS=<json> [PRODUCT_IMAGE=<img>] [OUT=<mp4>]');
    process.exit(1);
  }

  const timeline = readJson<OrchestratedTimeline>(timelinePath);
  const assetCards = readJson<AssetCard[]>(assetsPath);
  const productImageUrl = productImage ? (path.isAbsolute(productImage) ? productImage : path.join(repoRoot, productImage)) : undefined;

  const plans = planAigcBeats({
    timeline,
    assetCards,
    productImageUrl,
    productName: productName ?? timeline.meta.productName,
    resolution: '720P'
  });

  console.log(`Planned ${plans.length} beats:`);
  for (const p of plans) {
    console.log(
      p.kind === 'real_clip'
        ? `  #${p.index} real_clip  ${path.basename(p.clipUrl)}`
        : `  #${p.index} generate   ${p.job.model}  dur=${p.job.parameters.duration}s  media=${p.job.media.length}`
    );
  }

  const cfg = wanConfigFromEnv();
  const outputPath = path.isAbsolute(out) ? out : path.join(repoRoot, out);
  const workDir = path.join(repoRoot, 'tmp', 'aigc_beats');

  console.log(`\nGenerating (concurrency=${concurrency}) … this calls real Wan2.7 and costs quota.`);
  const result = await renderAigcTimeline({ plans, outputPath, cfg, workDir, concurrency }, {});

  console.log('\nBeat outcomes:');
  for (const b of result.beats) console.log(`  #${b.index} ${b.source}${b.error ? `  (${b.error})` : ''}`);
  if (result.warnings.length) console.log('Warnings:\n  ' + result.warnings.join('\n  '));
  console.log(`\n${result.rendered ? 'DONE ->' : 'NOT RENDERED ->'} ${result.outputPath}`);
  process.exit(result.rendered ? 0 : 1);
}

await main();
