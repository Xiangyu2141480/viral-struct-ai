import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetCard, AssetSupplyContext, ContentBrief, MissingMaterialBrief, ViralStructureGraph } from '@viral-struct/shared';
import { buildAssetSupplyContext } from '../apps/api/src/services/assetManager/assetSupplyContextBuilder';
import { normalizeAssetCards } from '../apps/api/src/services/assetManager/assetNormalizer';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = path.join(repoRoot, 'tmp');

const INPUTS = {
  structureGraph: 'seed_assets/analysis/macbook_neo/structure_graph.json',
  originalAssetCards: 'seed_assets/asset_libraries/kangshifu_demo/asset_cards.json',
  plainAssetCards: 'seed_assets/asset_libraries/kangshifu_plain_user_test/asset_cards.json'
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

interface ScenarioRun {
  scenario: string;
  context: AssetSupplyContext;
  outputPath: string;
}

function main(): void {
  mkdirSync(tmpDir, { recursive: true });
  const structureGraph = readJson<ViralStructureGraph>(INPUTS.structureGraph);
  const originalCards = normalizeAssetCards(readJson<AssetCard[]>(INPUTS.originalAssetCards));
  const plainCards = normalizeAssetCards(readJson<AssetCard[]>(INPUTS.plainAssetCards));
  const productImage = originalCards.find((asset) => asset.type === 'image') ?? originalCards[0];
  const aigcCards = buildAigcReadyCards(productImage);

  const runs: ScenarioRun[] = [{
    scenario: 'single image only',
    outputPath: OUTPUTS.singleImage,
    context: buildAssetSupplyContext({
      structureGraph,
      assetCards: productImage ? [productImage] : [],
      contentBrief,
      libraryId: 'scenario_single_image_only'
    })
  }, {
    scenario: 'partial real footage',
    outputPath: OUTPUTS.partialReal,
    context: buildAssetSupplyContext({
      structureGraph,
      assetCards: plainCards,
      contentBrief,
      libraryId: 'scenario_partial_real_footage'
    })
  }, {
    scenario: 'aigc ready / planned generation',
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
  writeText(OUTPUTS.report, buildReport(runs));

  console.log('Asset Manager scenario comparison complete.');
  for (const run of runs) {
    const summary = run.context.contextualCoverage?.coverageSummary;
    const scenario = run.context.materialScenario;
    console.log([
      `- ${run.scenario}:`,
      `scenarioType=${scenario?.scenarioType ?? 'unknown'}`,
      `evidence=${scenario?.evidenceCoverageScore ?? 0}`,
      `feasibility=${scenario?.completionFeasibilityScore ?? 0}`,
      `covered=${summary?.coveredSlots ?? 0}`,
      `weak=${summary?.weakSlots ?? 0}`,
      `insufficient=${summary?.insufficientSlots ?? 0}`,
      `missingBriefs=${run.context.missingMaterialBriefs?.length ?? 0}`,
      `mode=${scenario?.recommendedDownstreamMode ?? 'unknown'}`
    ].join(' '));
  }
  console.log(`Wrote ${OUTPUTS.singleImage}`);
  console.log(`Wrote ${OUTPUTS.partialReal}`);
  console.log(`Wrote ${OUTPUTS.aigcReady}`);
  console.log(`Wrote ${OUTPUTS.report}`);
}

function buildAigcReadyCards(productImage?: AssetCard): AssetCard[] {
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
    analysisSource: 'manual_text_brief',
    spatialDescription: 'Planned generation descriptor for a product reference; not real rendered output.',
    temporalDescription: 'Prompt-ready descriptor only. No external image or video generation has run.'
  };
  return normalizeAssetCards([reference]);
}

function buildReport(runs: ScenarioRun[]): string {
  const rows = runs.map((run) => {
    const coverage = run.context.contextualCoverage?.coverageSummary;
    const scenario = run.context.materialScenario;
    return [
      run.scenario,
      scenario?.evidenceCoverageScore ?? 0,
      scenario?.completionFeasibilityScore ?? 0,
      coverage?.coveredSlots ?? 0,
      coverage?.weakSlots ?? 0,
      coverage?.insufficientSlots ?? 0,
      run.context.missingMaterialBriefs?.length ?? 0,
      scenario?.recommendedDownstreamMode ?? 'unknown'
    ];
  });

  return `# Asset Manager Scenario Comparison Report

Generated by \`scripts/manual_test_asset_manager_scenarios.ts\`.

## Inputs

- Structure graph: \`${INPUTS.structureGraph}\`
- Product image library: \`${INPUTS.originalAssetCards}\`
- Plain user video library: \`${INPUTS.plainAssetCards}\`

## Scenario Summary

| scenario | evidenceCoverage | completionFeasibility | covered | weak | insufficient | missingBriefs | recommended downstream mode |
|---|---:|---:|---:|---:|---:|---:|---|
${rows.map((row) => `| ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} | ${row[4]} | ${row[5]} | ${row[6]} | ${row[7]} |`).join('\n')}

## Key Missing Material Briefs

${runs.map(formatBriefSection).join('\n\n')}

## Boundary

Asset Manager outputs evidence and handoff briefs only. It does not choose the final repair strategy, render fallback cards, generate real video, or compose MP4.
`;
}

function formatBriefSection(run: ScenarioRun): string {
  const briefs = (run.context.missingMaterialBriefs ?? []).slice(0, 5);
  if (!briefs.length) return `### ${run.scenario}\n\nNo missing material briefs.`;
  return `### ${run.scenario}

${briefs.map(formatBrief).join('\n')}`;
}

function formatBrief(brief: MissingMaterialBrief): string {
  const channels = brief.channelEligibility
    .filter((channel) => channel.eligible)
    .map((channel) => channel.channel)
    .join(', ');
  return `- \`${brief.affectedSlotId}\` (${brief.slotRole}): ${brief.manualShootBrief?.title ?? 'material brief'}; channels=${channels}; prompt=${brief.aigcGenerationBrief?.prompt.slice(0, 120) ?? 'n/a'}...`;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;
}

function writeJson(relativePath: string, value: unknown): void {
  writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(relativePath: string, value: string): void {
  const absolutePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, value, 'utf8');
}

main();
