import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AssetAnalysisProfile,
  AssetCard,
  AssetSupplyContext,
  ContentBrief,
  CreativeIngredientType,
  MaterialCoverageObservation,
  ShotSlotRole,
  ViralStructureGraph,
  VisualStyleTag
} from '@viral-struct/shared';
import { buildAssetSupplyContext } from '../apps/api/src/services/assetManager/assetSupplyContextBuilder';
import { normalizeAssetCards } from '../apps/api/src/services/assetManager/assetNormalizer';
import { probeVideo } from '../apps/api/src/services/assetManager/mediaProbeService';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = path.join(repoRoot, 'tmp');
const plainUploadDir = 'seed_assets/user_test/kangshifu_plain_uploads';
const videoExtensions = new Set(['.mp4', '.mov', '.webm', '.m4v']);

const INPUTS = {
  structureGraph: 'seed_assets/analysis/macbook_neo/structure_graph.json',
  originalAssetCards: 'seed_assets/asset_libraries/kangshifu_demo/asset_cards.json',
  plainAssetCards: 'seed_assets/asset_libraries/kangshifu_plain_user_test/asset_cards.json'
} as const;

const OUTPUTS = {
  originalContext: 'tmp/asset-supply-original.json',
  plainContext: 'tmp/asset-supply-plain.json',
  report: 'tmp/asset-manager-comparison-report.md'
} as const;

const contentBrief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏天通勤、聚餐、户外活动中的年轻消费者',
  scenario: '炎热天气、饭后解腻、朋友聚会时需要冰爽饮品',
  sellingPoints: ['冰爽解腻', '柠檬茶香', '适合聚餐分享', '冰镇后口感更清爽'],
  cta: '现在就来一瓶康师傅冰红茶',
  stylePreference: '普通用户真实素材，轻包装，重点验证素材缺口识别'
};

interface LibraryRun {
  label: string;
  libraryId: string;
  inputPath: string;
  context: AssetSupplyContext;
}

interface LibrarySummary {
  label: string;
  assetCount: number;
  videoAssetCount: number;
  coverageScore: number;
  coveredSlots: number;
  weakSlots: number;
  insufficientSlots: number;
  usageDemoStatus: string;
  productCloseupStatus: string;
  ctaStatus: string;
  observationCount: number;
}

async function main(): Promise<void> {
  mkdirSync(tmpDir, { recursive: true });

  const structureGraph = readJson<ViralStructureGraph>(INPUTS.structureGraph);
  const originalCards = readAssetCards(INPUTS.originalAssetCards);
  const scannedPlainCards = await scanPlainUploadVideos();
  const plainCards = scannedPlainCards.length > 0
    ? scannedPlainCards
    : readAssetCards(INPUTS.plainAssetCards);

  if (scannedPlainCards.length > 0) {
    writeJson(INPUTS.plainAssetCards, scannedPlainCards);
  }

  const original = runLibrary({
    label: 'original image library',
    libraryId: 'kangshifu_demo',
    inputPath: INPUTS.originalAssetCards,
    structureGraph,
    assetCards: originalCards
  });
  const plain = runLibrary({
    label: 'plain user video library',
    libraryId: 'kangshifu_plain_user_test',
    inputPath: INPUTS.plainAssetCards,
    structureGraph,
    assetCards: plainCards
  });

  writeJson(OUTPUTS.originalContext, original.context);
  writeJson(OUTPUTS.plainContext, plain.context);
  writeText(OUTPUTS.report, buildMarkdownReport(original, plain));

  const summaries = [summarize(original), summarize(plain)];
  printConsoleSummary(summaries);
  if (scannedPlainCards.length > 0) {
    console.log(`Scanned ${scannedPlainCards.length} video asset(s) from ${plainUploadDir}`);
    console.log(`Updated ${INPUTS.plainAssetCards}`);
  } else {
    console.log(`No video files found in ${plainUploadDir}; using existing ${INPUTS.plainAssetCards}`);
  }
}

function readJson<T = unknown>(relativePath: string): T {
  const absolutePath = path.join(repoRoot, relativePath);
  return JSON.parse(readFileSync(absolutePath, 'utf8')) as T;
}

function readAssetCards(relativePath: string): AssetCard[] {
  return normalizeAssetCards(readJson<AssetCard[]>(relativePath));
}

async function scanPlainUploadVideos(): Promise<AssetCard[]> {
  const absoluteUploadDir = path.join(repoRoot, plainUploadDir);
  if (!existsSync(absoluteUploadDir)) return [];

  const files = readdirSync(absoluteUploadDir)
    .filter((name) => videoExtensions.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  const cards: AssetCard[] = [];
  for (const filename of files) {
    const absolutePath = path.join(absoluteUploadDir, filename);
    const repoPath = toRepoPath(absolutePath);
    const probe = await probeVideo(absolutePath, { originalName: filename });
    if (probe.media.aspectRatio === '16:9' || probe.media.aspectRatio === '1:1') {
      continue;
    }
    const hints = inferPlainVideoHints(filename, probe.media.durationSec ?? 0);
    const qualityScore = inferQualityScore(filename, probe.fallbackUsed, probe.media.width, probe.media.height);
    const fileStat = statSync(absolutePath);
    const media = {
      ...probe.media,
      sourceUrl: repoPath,
      fileSizeBytes: fileStat.size,
      keyframes: []
    };
    const warnings = [
      ...probe.warnings,
      ...hints.warnings,
      ...(qualityScore < 0.5 ? ['Filename suggests this clip is low quality; keep it as weak evidence only.'] : [])
    ];

    const card = normalizeAssetCards([{
      id: safeAssetId(path.basename(filename, path.extname(filename))),
      type: 'video',
      url: repoPath,
      spatialDescription: hints.spatialDescription,
      temporalDescription: buildTemporalDescription(filename, media.durationSec, media.fps, media.width, media.height, media.hasAudio),
      detectedObjects: hints.detectedObjects,
      suitableSlots: hints.suitableSlots,
      qualityScore,
      detectedIngredients: hints.detectedIngredients,
      humanPresence: hints.humanPresence,
      visualStyleTags: hints.visualStyleTags,
      motionPotential: {
        isStill: false,
        implicitMotion: hints.motionStrength,
        canSimulateMotion: ['trim_to_highlight', 'crop_to_vertical', 'stabilize_if_needed'],
        canSimulateDurationMs: [1200, Math.max(1800, Math.min(4200, Math.round((media.durationSec ?? 2) * 1000)))]
      },
      analysisSource: 'deterministic',
      analysis: {
        media,
        warnings,
        fallbackUsed: probe.fallbackUsed || warnings.length > probe.warnings.length,
        source: 'deterministic',
        semantic: {
          summary: hints.spatialDescription,
          detectedObjects: hints.detectedObjects,
          detectedIngredients: hints.detectedIngredients,
          visualStyleTags: hints.visualStyleTags,
          humanPresence: hints.humanPresence,
          motionPotential: {
            isStill: false,
            implicitMotion: hints.motionStrength,
            canSimulateMotion: ['trim_to_highlight', 'crop_to_vertical', 'stabilize_if_needed']
          }
        },
        quality: {
          overallScore: qualityScore,
          resolution: media.width && media.height ? qualityScore : 0.4,
          sharpness: hints.isBadClip ? 0.35 : qualityScore,
          brightness: hints.isBadClip ? 0.32 : qualityScore,
          contrast: hints.isBadClip ? 0.38 : qualityScore,
          clarity: hints.isBadClip ? 0.36 : qualityScore,
          composition: qualityScore,
          lighting: hints.isBadClip ? 0.3 : qualityScore,
          subjectProminence: qualityScore,
          productFocus: hints.detectedObjects.includes('beverage bottle') ? Math.max(0.62, qualityScore) : 0.45,
          textSafeArea: hints.suitableSlots.includes('cta_visual') ? 0.72 : 0.58,
          formatFit: media.aspectRatio === '9:16' ? 0.92 : media.aspectRatio === '16:9' ? 0.72 : 0.68,
          issues: hints.isBadClip
            ? [{ type: 'low_quality', severity: 'medium', message: 'Filename marks this as dark or shaky test footage.' }]
            : []
        }
      } as Partial<AssetAnalysisProfile> as AssetAnalysisProfile
    }])[0];

    cards.push(card);
  }

  return cards;
}

function runLibrary(input: {
  label: string;
  libraryId: string;
  inputPath: string;
  structureGraph: ViralStructureGraph;
  assetCards: AssetCard[];
}): LibraryRun {
  const context = buildAssetSupplyContext({
    structureGraph: input.structureGraph,
    assetCards: input.assetCards,
    contentBrief,
    libraryId: input.libraryId
  });

  return {
    label: input.label,
    libraryId: input.libraryId,
    inputPath: input.inputPath,
    context
  };
}

function summarize(run: LibraryRun): LibrarySummary {
  const coverage = run.context.contextualCoverage?.coverageSummary;

  return {
    label: run.label,
    assetCount: run.context.libraryProfile.assetCount,
    videoAssetCount: run.context.libraryProfile.byType.video ?? 0,
    coverageScore: coverage?.coverageScore ?? 0,
    coveredSlots: coverage?.coveredSlots ?? 0,
    weakSlots: coverage?.weakSlots ?? 0,
    insufficientSlots: coverage?.insufficientSlots ?? 0,
    usageDemoStatus: aggregateContextualStatus(run, ['usage_demo']),
    productCloseupStatus: aggregateContextualStatus(run, ['product_closeup']),
    ctaStatus: aggregateContextualStatus(run, ['cta_visual']),
    observationCount: run.context.contextualCoverage?.observations.length ?? 0
  };
}

function aggregateContextualStatus(run: LibraryRun, roles: ShotSlotRole[]): string {
  const rows = run.context.contextualCoverage?.slotCoverages.filter((coverage) => roles.includes(coverage.slotRole as ShotSlotRole)) ?? [];
  if (!rows.length) return 'not_present';
  if (rows.every((row) => row.coverageStatus === 'covered')) return 'covered';
  if (rows.some((row) => row.coverageStatus === 'covered' || row.coverageStatus === 'weak')) return 'weak';
  return 'missing';
}

function buildMarkdownReport(original: LibraryRun, plain: LibraryRun): string {
  const originalSummary = summarize(original);
  const plainSummary = summarize(plain);
  const rows: Array<[string, string | number, string | number, string]> = [
    ['coverage score', originalSummary.coverageScore, plainSummary.coverageScore, diffNumber(plainSummary.coverageScore, originalSummary.coverageScore)],
    ['covered slots', originalSummary.coveredSlots, plainSummary.coveredSlots, diffNumber(plainSummary.coveredSlots, originalSummary.coveredSlots)],
    ['weak slots', originalSummary.weakSlots, plainSummary.weakSlots, diffNumber(plainSummary.weakSlots, originalSummary.weakSlots)],
    ['insufficient slots', originalSummary.insufficientSlots, plainSummary.insufficientSlots, diffNumber(plainSummary.insufficientSlots, originalSummary.insufficientSlots)],
    ['usage_demo status', originalSummary.usageDemoStatus, plainSummary.usageDemoStatus, diffStatus(plainSummary.usageDemoStatus, originalSummary.usageDemoStatus)],
    ['product_closeup status', originalSummary.productCloseupStatus, plainSummary.productCloseupStatus, diffStatus(plainSummary.productCloseupStatus, originalSummary.productCloseupStatus)],
    ['cta status', originalSummary.ctaStatus, plainSummary.ctaStatus, diffStatus(plainSummary.ctaStatus, originalSummary.ctaStatus)],
    ['observations', originalSummary.observationCount, plainSummary.observationCount, diffNumber(plainSummary.observationCount, originalSummary.observationCount)]
  ];

  return `# Asset Manager Manual Comparison Report

Generated by \`scripts/manual_test_asset_manager.ts\`.

## Inputs

- Structure graph: \`${INPUTS.structureGraph}\`
- Original image library: \`${INPUTS.originalAssetCards}\`
- Plain user video library: \`${INPUTS.plainAssetCards}\`

## Output Files

- Original AssetSupplyContext: \`${OUTPUTS.originalContext}\`
- Plain AssetSupplyContext: \`${OUTPUTS.plainContext}\`
- Markdown report: \`${OUTPUTS.report}\`

## Summary

| metric | original image library | plain user video library | change |
| --- | ---: | ---: | --- |
${rows.map(([metric, a, b, change]) => `| ${metric} | ${a} | ${b} | ${change} |`).join('\n')}

## Per-role Breakdown

${formatRoleBreakdown(original, plain)}

## Original Image Library Observations

${formatObservations(original.context.contextualCoverage?.observations ?? [])}

## Plain User Video Library Observations

${formatObservations(plain.context.contextualCoverage?.observations ?? [])}

## Interpretation

- Asset Manager remains evidence-only: it reports coverage and observations, but does not create repair strategies or fallback cards.
- If the plain user library has no real video assets, usage and motion-heavy source slots should remain insufficient.
- Once ordinary user videos are added, \`usage_demo\` should improve only when clips contain real hand pickup, cap opening, drinking, pouring, or similar motion evidence.
- Bad or dark/shaky clips should increase warnings or weak coverage rather than being treated as strong final material.
`;
}

function formatRoleBreakdown(original: LibraryRun, plain: LibraryRun): string {
  const roles: Array<[string, ShotSlotRole[]]> = [
    ['opening_hook', ['opening_attention']],
    ['product_closeup', ['product_closeup']],
    ['usage_demo', ['usage_demo']],
    ['benefit_proof', ['benefit_visual']],
    ['comparison', ['comparison']],
    ['cta', ['cta_visual']],
    ['cover', []]
  ];
  const header = '| role | original image library | plain user video library |\n| --- | --- | --- |';
  const body = roles.map(([label, mappedRoles]) => {
    return `| ${label} | ${formatRoleStatus(original, mappedRoles)} | ${formatRoleStatus(plain, mappedRoles)} |`;
  }).join('\n');
  return `${header}\n${body}`;
}

function formatRoleStatus(run: LibraryRun, roles: ShotSlotRole[]): string {
  const rows = run.context.contextualCoverage?.slotCoverages.filter((coverage) => roles.includes(coverage.slotRole as ShotSlotRole)) ?? [];
  if (rows.length === 0) return 'not present in graph';
  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.coverageStatus] = (acc[row.coverageStatus] ?? 0) + 1;
    return acc;
  }, {});
  return ['covered', 'weak', 'insufficient']
    .filter((status) => counts[status])
    .map((status) => `${status}:${counts[status]}`)
    .join(', ');
}

function formatObservations(observations: MaterialCoverageObservation[]): string {
  if (observations.length === 0) return 'No weak or insufficient coverage observations.';

  const header = '| slot | role | observation | severity | missing / weak evidence | potential impact |\n| --- | --- | --- | --- | --- | --- |';
  const body = observations.slice(0, 12).map((observation) => {
    const evidence = [
      ...observation.missingIngredients,
      ...observation.availableButWeakIngredients
    ]
      .slice(0, 3)
      .map((item) => item.label)
      .join('; ') || 'none';
    const impact = observation.potentialImpact
      .map((item) => `${item.type}: ${item.description}`)
      .join('; ') || 'none';
    return `| \`${observation.affectedSlotId}\` | \`${observation.slotRole}\` | ${observation.observationType} | ${observation.severityEstimate} | ${escapeTable(evidence)} | ${escapeTable(impact)} |`;
  }).join('\n');
  const footer = observations.length > 12 ? `\n\nShowing 12 of ${observations.length} observations.` : '';

  return `${header}\n${body}${footer}`;
}

function diffNumber(value: number, baseline: number): string {
  const diff = Number((value - baseline).toFixed(2));
  if (diff > 0) return `+${diff}`;
  return String(diff);
}

function diffStatus(value: string, baseline: string): string {
  return value === baseline ? 'no change' : `${baseline} -> ${value}`;
}

function writeJson(relativePath: string, value: unknown): void {
  writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(relativePath: string, value: string): void {
  const absolutePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, value, 'utf8');
}

function toRepoPath(absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
}

function safeAssetId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'plain_video_asset';
}

function inferPlainVideoHints(filename: string, durationSec: number): {
  spatialDescription: string;
  detectedObjects: string[];
  suitableSlots: ShotSlotRole[];
  detectedIngredients: CreativeIngredientType[];
  visualStyleTags: VisualStyleTag[];
  humanPresence: AssetCard['humanPresence'];
  motionStrength: 'low' | 'medium' | 'high';
  warnings: string[];
  isBadClip: boolean;
} {
  const lower = filename.toLowerCase();
  const hasHandAction = /hand|pickup|pick_up|open|cap|drink|pour|cup|use|usage/.test(lower);
  const hasPourOrDrink = /drink|pour|cup/.test(lower);
  const hasComparison = /compare|comparison|lineup|before|after|multi|series|pack/.test(lower);
  const hasCleanEnd = /clean|end|frame|cta/.test(lower);
  const hasPanOrProduct = /table|product|pan|bottle|pack|label/.test(lower);
  const isBadClip = /bad|dark|shaky|blur|low/.test(lower);
  const supportsCtaSurface = hasCleanEnd || (hasPanOrProduct && !hasHandAction && !isBadClip);
  const suitableSlots: ShotSlotRole[] = uniqueRoles([
    ...(hasHandAction ? ['usage_demo' as const] : []),
    ...(hasPourOrDrink ? ['benefit_visual' as const] : []),
    ...(hasComparison ? ['comparison' as const] : []),
    ...(supportsCtaSurface ? ['cta_visual' as const] : []),
    ...(hasPanOrProduct ? ['product_closeup' as const] : []),
    'product_closeup'
  ]);
  const detectedIngredients: CreativeIngredientType[] = uniqueIngredients([
    'product_closeup_trait',
    ...(hasHandAction ? ['hand_demo' as const, 'human_presence' as const] : []),
    ...(hasPourOrDrink ? ['lifestyle_context' as const] : []),
    ...(hasComparison ? ['lifestyle_context' as const] : []),
    ...(hasCleanEnd ? ['clean_background' as const] : []),
    ...(isBadClip ? ['unknown' as const] : [])
  ]);
  const detectedObjects = uniqueStrings([
    'beverage bottle',
    'product',
    ...(hasHandAction ? ['hand', 'usage scene'] : []),
    ...(hasPourOrDrink ? ['cup', 'liquid'] : []),
    ...(hasComparison ? ['product lineup'] : []),
    ...(hasCleanEnd ? ['clean end frame'] : [])
  ]);

  return {
    spatialDescription: buildPlainDescription(filename, durationSec, hasHandAction, hasPourOrDrink, hasCleanEnd, isBadClip),
    detectedObjects,
    suitableSlots,
    detectedIngredients,
    visualStyleTags: uniqueStyleTags([
      ...(hasCleanEnd ? ['clean_background' as const] : []),
      ...(hasPourOrDrink ? ['lifestyle_context' as const] : []),
      ...(isBadClip ? [] : ['clean_background' as const])
    ]),
    humanPresence: {
      hasHuman: hasHandAction,
      actions: hasHandAction ? ['holding_product'] : undefined
    },
    motionStrength: hasHandAction || hasPourOrDrink ? 'high' : 'medium',
    warnings: isBadClip ? ['Filename indicates a bad/dark/shaky test clip.'] : [],
    isBadClip
  };
}

function buildPlainDescription(
  filename: string,
  durationSec: number,
  hasHandAction: boolean,
  hasPourOrDrink: boolean,
  hasCleanEnd: boolean,
  isBadClip: boolean
): string {
  const phrases = [`Plain user-shot Kangshifu iced tea video (${filename})`];
  if (hasHandAction) phrases.push('contains hand or usage-action cues');
  if (hasPourOrDrink) phrases.push('contains drink/pour/cup cues');
  if (hasCleanEnd) phrases.push('may support a clean CTA end frame');
  if (isBadClip) phrases.push('intentionally marked as dark/shaky or low quality');
  if (durationSec > 0) phrases.push(`${Number(durationSec.toFixed(2))}s duration`);
  return `${phrases.join('; ')}.`;
}

function buildTemporalDescription(
  filename: string,
  durationSec?: number,
  fps?: number,
  width?: number,
  height?: number,
  hasAudio?: boolean
): string {
  return [
    `Local plain user test video: ${filename}`,
    durationSec ? `${durationSec}s` : 'duration unknown',
    fps ? `${fps}fps` : 'fps unknown',
    width && height ? `${width}x${height}` : 'resolution unknown',
    hasAudio ? 'audio present' : 'no audio detected'
  ].join('; ');
}

function inferQualityScore(filename: string, fallbackUsed: boolean, width?: number, height?: number): number {
  const lower = filename.toLowerCase();
  if (/bad|dark|shaky|blur|low/.test(lower)) return 0.38;
  if (fallbackUsed) return 0.55;
  if (!width || !height) return 0.5;
  const pixels = width * height;
  if (pixels >= 1080 * 1920 || pixels >= 1920 * 1080) return 0.82;
  if (pixels >= 720 * 1280 || pixels >= 1280 * 720) return 0.74;
  return 0.62;
}

function uniqueRoles(values: ShotSlotRole[]): ShotSlotRole[] {
  return Array.from(new Set(values));
}

function uniqueIngredients(values: CreativeIngredientType[]): CreativeIngredientType[] {
  return Array.from(new Set(values));
}

function uniqueStyleTags(values: VisualStyleTag[]): VisualStyleTag[] {
  return Array.from(new Set(values));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function printConsoleSummary(summaries: LibrarySummary[]): void {
  console.log('Asset Manager manual comparison complete.');
  for (const summary of summaries) {
    console.log([
      `- ${summary.label}:`,
      `coverage=${summary.coverageScore}`,
      `covered=${summary.coveredSlots}`,
      `weak=${summary.weakSlots}`,
      `insufficient=${summary.insufficientSlots}`,
      `usage_demo=${summary.usageDemoStatus}`,
      `product_closeup=${summary.productCloseupStatus}`,
      `cta=${summary.ctaStatus}`,
      `observations=${summary.observationCount}`
    ].join(' '));
  }
  console.log(`Wrote ${OUTPUTS.originalContext}`);
  console.log(`Wrote ${OUTPUTS.plainContext}`);
  console.log(`Wrote ${OUTPUTS.report}`);
}

main().catch((error) => {
  console.error(formatScriptError(error));
  process.exit(1);
});

function formatScriptError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return String(error);
  }
}
