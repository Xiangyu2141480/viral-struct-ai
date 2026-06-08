import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetCard, ContentBrief, ViralStructureGraph } from '@viral-struct/shared';
import { buildAssetSupplyContext } from '../apps/api/src/services/assetManager/assetSupplyContextBuilder';
import { normalizeAssetCards } from '../apps/api/src/services/assetManager/assetNormalizer';
import {
  buildScenarioComparisonReport,
  summarizeScenarioRun,
  type ScenarioRun
} from '../apps/api/src/services/assetManager/scenarioBenchmarkReporter';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = path.join(repoRoot, 'tmp');

const INPUTS = {
  structureGraph: 'seed_assets/analysis/macbook_neo/structure_graph.json',
  originalAssetCards: 'seed_assets/asset_libraries/kangshifu_demo/asset_cards.json',
  plainAssetCards: 'seed_assets/asset_libraries/kangshifu_plain_user_test/asset_cards.json',
  aigcSampleDescriptor: 'docs/examples/scenario-aigc-ready.sample.json'
} as const;

const OUTPUTS = {
  singleImage: 'tmp/asset-supply-single-image.json',
  partialReal: 'tmp/asset-supply-partial-real.json',
  aigcReady: 'tmp/asset-supply-aigc-ready.json',
  report: 'tmp/asset-manager-scenario-comparison-report.md'
} as const;

const contentBrief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏天通勤、聚餐、户外活动中的年轻消费者',
  scenario: '炎热天气、饭后解腻、朋友聚会时需要冰爽饮品',
  sellingPoints: ['冰爽解腻', '柠檬茶香', '适合聚餐分享', '冰镇后口感更清爽'],
  cta: '现在就来一瓶康师傅冰红茶',
  stylePreference: '普通用户真实素材，轻包装，重点验证素材缺口识别和补全输入简报'
};

function main(): void {
  mkdirSync(tmpDir, { recursive: true });
  const structureGraph = readJson<ViralStructureGraph>(INPUTS.structureGraph);
  const originalCards = normalizeAssetCards(readJson<AssetCard[]>(INPUTS.originalAssetCards));
  const plainCards = normalizeAssetCards(readJson<AssetCard[]>(INPUTS.plainAssetCards));
  const productImage = originalCards.find((asset) => asset.type === 'image') ?? originalCards[0];
  const aigcCards = buildAigcReadyCards(productImage, readOptionalAigcDescriptor());

  const runs: ScenarioRun[] = [{
    scenario: 'single_image_only',
    outputPath: OUTPUTS.singleImage,
    context: buildAssetSupplyContext({
      structureGraph,
      assetCards: productImage ? [productImage] : [],
      contentBrief,
      libraryId: 'scenario_single_image_only'
    })
  }, {
    scenario: 'partial_real_footage',
    outputPath: OUTPUTS.partialReal,
    context: buildAssetSupplyContext({
      structureGraph,
      assetCards: plainCards,
      contentBrief,
      libraryId: 'scenario_partial_real_footage'
    })
  }, {
    scenario: 'aigc_ready',
    outputPath: OUTPUTS.aigcReady,
    context: buildAssetSupplyContext({
      structureGraph,
      assetCards: aigcCards,
      contentBrief,
      libraryId: 'scenario_aigc_ready',
      options: { userCanGenerate: true }
    })
  }];

  for (const run of runs) {
    writeJson(run.outputPath, run.context);
  }
  writeText(OUTPUTS.report, buildScenarioComparisonReport(runs, INPUTS));

  console.log('Asset Manager scenario comparison complete.');
  for (const run of runs) {
    const summary = summarizeScenarioRun(run);
    console.log([
      `- ${run.scenario}:`,
      `evidence=${summary.evidenceCoverage}`,
      `feasibility=${summary.completionFeasibility}`,
      `covered=${summary.covered}`,
      `weak=${summary.weak}`,
      `insufficient=${summary.insufficient}`,
      `observations=${summary.observations}`,
      `missingBriefs=${summary.missingBriefs}`,
      `mode=${summary.downstreamMode}`
    ].join(' '));
  }
  console.log(`Wrote ${OUTPUTS.singleImage}`);
  console.log(`Wrote ${OUTPUTS.partialReal}`);
  console.log(`Wrote ${OUTPUTS.aigcReady}`);
  console.log(`Wrote ${OUTPUTS.report}`);
}

function buildAigcReadyCards(productImage?: AssetCard, sampleDescriptor?: string): AssetCard[] {
  const reference: AssetCard = {
    ...(productImage ?? {
      id: 'asset_product_reference',
      type: 'image',
      detectedObjects: ['beverage bottle', 'product'],
      suitableSlots: ['product_closeup'],
      qualityScore: 0.75
    }),
    id: 'planned_aigc_product_reference',
    url: undefined,
    analysisSource: 'planned_generation',
    spatialDescription: [
      'Planned generation descriptor for a product reference; not real rendered output.',
      sampleDescriptor ? `Descriptor source: ${sampleDescriptor}` : undefined
    ].filter(Boolean).join(' '),
    temporalDescription: 'Prompt-ready descriptor only. No external image or video generation has run.'
  };
  return normalizeAssetCards([reference]);
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;
}

function readOptionalAigcDescriptor(): string | undefined {
  const absolutePath = path.join(repoRoot, INPUTS.aigcSampleDescriptor);
  if (!existsSync(absolutePath)) return undefined;
  const descriptor = readJson<{ materialScenario?: { scenarioType?: string; recommendedDownstreamMode?: string } }>(INPUTS.aigcSampleDescriptor);
  const scenarioType = descriptor.materialScenario?.scenarioType;
  const mode = descriptor.materialScenario?.recommendedDownstreamMode;
  return [scenarioType, mode].filter(Boolean).join(' / ') || INPUTS.aigcSampleDescriptor;
}

function writeJson(relativePath: string, value: unknown): void {
  writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(relativePath: string, value: string): void {
  const absolutePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, value, 'utf8');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
