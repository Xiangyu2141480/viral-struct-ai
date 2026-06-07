import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetCard, AssetSupplyContext, ContentBrief, ViralStructureGraph } from '@viral-struct/shared';
import { buildAssetSupplyContext } from '../apps/api/src/services/assetManager/assetSupplyContextBuilder';
import { normalizeAssetCards } from '../apps/api/src/services/assetManager/assetNormalizer';
import {
  buildAssetMarginalContributionReport,
  buildIncrementalContributionStep,
  buildLeaveOneOutContribution,
  summarizePerAssetContribution,
  type AssetMarginalContributionReport,
  type CoverageSnapshot,
  type IncrementalContributionStep,
  type LeaveOneOutContribution,
  type PerAssetContributionSummary
} from '../apps/api/src/services/assetManager/assetSupplyContextDiff';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = path.join(repoRoot, 'tmp');

const INPUTS = {
  structureGraph: 'seed_assets/analysis/macbook_neo/structure_graph.json',
  plainAssetCards: 'seed_assets/asset_libraries/kangshifu_plain_user_test/asset_cards.json'
} as const;

const OUTPUTS = {
  json: 'tmp/asset-marginal-contribution.json',
  markdown: 'tmp/asset-manager-marginal-contribution-report.md'
} as const;

const contentBrief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏天通勤、聚餐、户外活动中的年轻消费者',
  scenario: '炎热天气、饭后解腻、朋友聚会时需要冰爽饮品',
  sellingPoints: ['冰爽解腻', '柠檬茶香', '适合聚餐分享', '冰镇后口感更清爽'],
  cta: '现在就来一瓶康师傅冰红茶',
  stylePreference: '普通用户真实素材，轻包装，重点验证素材缺口识别'
};

function main(): void {
  mkdirSync(tmpDir, { recursive: true });

  const structureGraph = readJson<ViralStructureGraph>(INPUTS.structureGraph);
  const assetCards = normalizeAssetCards(readJson<AssetCard[]>(INPUTS.plainAssetCards));
  const baselineContext = buildContext([], 'kangshifu_plain_user_test_empty', structureGraph);
  const fullContext = buildContext(assetCards, 'kangshifu_plain_user_test_full', structureGraph);

  const incrementalSteps = buildIncrementalSteps(assetCards, structureGraph);
  const leaveOneOut = buildLeaveOneOut(assetCards, fullContext, structureGraph);
  const perAssetSummary = summarizePerAssetContribution({
    assetCards,
    incrementalSteps,
    leaveOneOut
  });
  const report = buildAssetMarginalContributionReport({
    libraryId: 'kangshifu_plain_user_test',
    structureGraphId: 'macbook_neo',
    baselineContext,
    fullContext,
    incrementalSteps,
    leaveOneOut,
    perAssetSummary,
    warnings: [
      'Asset Manager marginal contribution is evidence-only. It does not produce downstream repair, render, gap, or timeline decision artifacts.',
      'Coverage is slot-based, not asset-count-based; redundant assets can be useful references without changing the overall score.'
    ]
  });

  writeJson(OUTPUTS.json, report);
  writeText(OUTPUTS.markdown, buildMarkdownReport(report, assetCards));
  printConsoleSummary(report);
}

function buildIncrementalSteps(assetCards: AssetCard[], structureGraph: ViralStructureGraph): IncrementalContributionStep[] {
  const steps: IncrementalContributionStep[] = [];
  let previousCards: AssetCard[] = [];
  let previousContext = buildContext(previousCards, 'incremental_step_000', structureGraph);

  assetCards.forEach((asset, index) => {
    const nextCards = assetCards.slice(0, index + 1);
    const nextContext = buildContext(nextCards, `incremental_step_${String(index + 1).padStart(3, '0')}`, structureGraph);
    steps.push(buildIncrementalContributionStep({
      addedAsset: asset,
      previousContext,
      nextContext
    }));
    previousCards = nextCards;
    previousContext = nextContext;
  });

  return steps;
}

function buildLeaveOneOut(
  assetCards: AssetCard[],
  fullContext: AssetSupplyContext,
  structureGraph: ViralStructureGraph
): LeaveOneOutContribution[] {
  return assetCards.map((asset) => {
    const without = assetCards.filter((candidate) => candidate.id !== asset.id);
    return buildLeaveOneOutContribution({
      removedAsset: asset,
      fullContext,
      withoutAssetContext: buildContext(without, `without_${asset.id}`, structureGraph)
    });
  });
}

function buildContext(assetCards: AssetCard[], libraryId: string, structureGraph: ViralStructureGraph): AssetSupplyContext {
  return buildAssetSupplyContext({
    structureGraph,
    assetCards,
    contentBrief,
    libraryId
  });
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

function buildMarkdownReport(report: AssetMarginalContributionReport, assetCards: AssetCard[]): string {
  return `# Asset Manager Marginal Contribution Report

Generated by \`scripts/manual_test_asset_marginal_contribution.ts\`.

## Inputs

- Structure graph: \`${INPUTS.structureGraph}\`
- Plain user asset library: \`${INPUTS.plainAssetCards}\`

## Output Files

- JSON report: \`${OUTPUTS.json}\`
- Markdown report: \`${OUTPUTS.markdown}\`

## 1. Asset Set

${formatAssetSet(assetCards)}

## 2. Incremental Contribution

${formatIncremental(report.incrementalSteps)}

## 3. Per Asset Contribution

${formatPerAsset(report.perAssetSummary)}

## 4. Leave One Out

${formatLeaveOneOut(report.leaveOneOut)}

## 5. Why Some Assets Did Not Increase Coverage

${formatWhyNoIncrease(report.perAssetSummary)}

## 6. Actionable Next Assets

- \`open_cap\`: useful only when it clearly shows cap opening and product label; generic hand motion may stay weak.
- \`drink_neck_down\`: helps hook / benefit / usage evidence when product and drinking action are both visible.
- \`pour_to_cup\`: most useful for usage_demo and benefit proof slots that still need pouring or liquid-motion evidence.
- \`lineup_or_compare\`: needed for comparison slots; product closeups do not satisfy before/after or lineup evidence.
- \`bad_dark_shaky\`: keep as quality-test material so the analyzer can prove weak/insufficient handling.

## 7. Interpretation for Video Agent

- \`core_material\`: removing it reduces coverage or covered slot count; prioritize it for final timeline or video-agent references.
- \`supporting_material\`: improves ingredients or replaceable evidence; useful as a reference, crop/zoom source, or secondary clip.
- \`redundant_material\`: overlaps stronger assets and does not change coverage; keep as backup/reference.
- \`quality_test_material\`: useful for proving safety and quality gates, not for final generation.
- \`reference_only\`: no current graph-aligned contribution; keep only if it helps future templates.

## Boundary

- Asset Manager remains evidence-only.
- This report does not output downstream repair cards, repair plans, final gap objects, final repair objects, or timeline decisions.
- Coverage is not adjusted here; this report explains the existing deterministic coverage result.
`;
}

function formatAssetSet(assetCards: AssetCard[]): string {
  if (assetCards.length === 0) return 'No assets are present in the plain user test library.';
  const header = '| order | asset | media type | roles | quality |\n| ---: | --- | --- | --- | ---: |';
  const rows = assetCards.map((asset, index) => {
    const roles = primaryRoles(asset).join(', ') || 'none';
    const quality = asset.analysis?.quality.overallScore ?? asset.qualityScore ?? 0;
    return `| ${index + 1} | \`${asset.id}\` | ${asset.type} | ${escapeTable(roles)} | ${quality} |`;
  });
  return `${header}\n${rows.join('\n')}`;
}

function formatIncremental(steps: IncrementalContributionStep[]): string {
  if (steps.length === 0) return 'No incremental steps were generated.';
  const header = '| step | added asset | coverage | covered | weak | insufficient | observations | main changes |\n| ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |';
  const rows = steps.map((step, index) => {
    const next = step.nextSnapshot;
    const changes = [
      deltaLabel('score', step.delta.coverageScoreDelta),
      deltaLabel('covered', step.delta.coveredSlotsDelta),
      step.changedSlots.length ? `${step.changedSlots.length} slot change(s)` : undefined,
      step.ingredientDeltas.some((delta) => delta.change === 'resolved' || delta.change === 'weakened')
        ? `${unique(step.ingredientDeltas.filter((delta) => delta.change === 'resolved' || delta.change === 'weakened').map((delta) => delta.slotId)).length} ingredient-improved slot(s)`
        : undefined,
      step.interpretation[0]
    ].filter(Boolean).join('; ');
    return `| ${index + 1} | \`${step.addedAssetId}\` | ${next.coverageScore} | ${next.coveredSlots} | ${next.weakSlots} | ${next.insufficientSlots} | ${next.observationsCount} | ${escapeTable(changes)} |`;
  });
  return `${header}\n${rows.join('\n')}`;
}

function formatPerAsset(summaries: PerAssetContributionSummary[]): string {
  if (summaries.length === 0) return 'No asset contribution summaries were generated.';
  const header = '| asset | recommended use | unique contribution | improved slots | status changed slots | ingredient improved slots | no-gain reasons |\n| --- | --- | --- | --- | --- | --- | --- |';
  const rows = summaries.map((summary) => {
    return `| \`${summary.assetId}\` | ${summary.recommendedUse} | ${summary.uniqueContribution ? 'yes' : 'no'} | ${formatList(summary.improvedSlots)} | ${formatList(summary.statusChangedSlots)} | ${formatList(summary.ingredientImprovedSlots)} | ${escapeTable(summary.noGainReasons.join('; ') || 'none')} |`;
  });
  return `${header}\n${rows.join('\n')}`;
}

function formatLeaveOneOut(rows: LeaveOneOutContribution[]): string {
  if (rows.length === 0) return 'No leave-one-out rows were generated.';
  const header = '| removed asset | coverage delta | covered delta | affected slots | interpretation |\n| --- | ---: | ---: | --- | --- |';
  const body = rows.map((row) => {
    const affected = row.affectedSlots.slice(0, 4).map((slot) => `${slot.slotId} ${slot.previousStatus}->${slot.nextStatus}`).join(', ') || 'none';
    return `| \`${row.removedAssetId}\` | ${row.deltaIfRemoved.coverageScoreDelta} | ${row.deltaIfRemoved.coveredSlotsDelta} | ${escapeTable(affected)} | ${escapeTable(row.interpretation.join('; '))} |`;
  });
  return `${header}\n${body.join('\n')}`;
}

function formatWhyNoIncrease(summaries: PerAssetContributionSummary[]): string {
  const noGain = summaries.filter((summary) => summary.directCoverageGain.coverageScoreDelta <= 0);
  if (noGain.length === 0) {
    return 'Every asset increased the coverage score in this run.';
  }

  return noGain.map((summary) => {
    const reasons = summary.noGainReasons.length
      ? summary.noGainReasons
      : ['It likely supports weak evidence only, overlaps existing candidates, or lacks a critical ingredient required by the current source graph.'];
    return `- \`${summary.assetId}\`: ${reasons.map((reason) => escapeInline(reason)).join(' ')}`;
  }).join('\n');
}

function printConsoleSummary(report: AssetMarginalContributionReport): void {
  console.log('Asset Manager marginal contribution report complete.');
  console.log(`- baseline: coverage=${report.baseline.coverageScore} covered=${report.baseline.coveredSlots} weak=${report.baseline.weakSlots} insufficient=${report.baseline.insufficientSlots}`);
  console.log(`- full set: coverage=${report.fullSet.coverageScore} covered=${report.fullSet.coveredSlots} weak=${report.fullSet.weakSlots} insufficient=${report.fullSet.insufficientSlots}`);
  console.log('- per asset recommended use:');
  for (const summary of report.perAssetSummary) {
    console.log(`  - ${summary.assetId}: ${summary.recommendedUse}, unique=${summary.uniqueContribution}, directScoreDelta=${summary.directCoverageGain.coverageScoreDelta}`);
  }
  console.log(`Wrote ${OUTPUTS.json}`);
  console.log(`Wrote ${OUTPUTS.markdown}`);
}

function primaryRoles(asset: AssetCard): string[] {
  return unique([
    ...(asset.analysis?.slotAffordance?.primaryRoles?.map((role) => role.role) ?? []),
    ...(asset.suitableSlots ?? [])
  ]).slice(0, 5);
}

function formatList(values: string[]): string {
  return values.length ? values.slice(0, 4).map((value) => `\`${value}\``).join(', ') : 'none';
}

function deltaLabel(label: string, value: number): string | undefined {
  if (value === 0) return undefined;
  return `${label} ${value > 0 ? '+' : ''}${value}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function escapeInline(value: string): string {
  return value.replace(/\n/g, ' ');
}

main();
