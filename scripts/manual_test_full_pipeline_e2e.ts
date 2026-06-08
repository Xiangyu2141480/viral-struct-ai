import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AssetCard,
  AssetSupplyContext,
  AudioCue,
  ContentBrief,
  GapRepair,
  MaterialGap,
  MotifContext,
  SlotMatch,
  TimelineItem,
  TransitionRecipe,
  ViralStructureGraph
} from '../packages/shared/src/types';
import { buildAssetSupplyContext } from '../apps/api/src/services/assetManager/assetSupplyContextBuilder';
import { normalizeAssetCards } from '../apps/api/src/services/assetManager/assetNormalizer';
import { buildDeterministicPreset, type CategoryPreset } from '../apps/api/src/services/motifs/categoryPresetProvider';
import { buildMotifContext, extractViralMotifAnnotation } from '../apps/api/src/services/motifs/viralMotifExtractor';
import { matchSlots } from '../apps/api/src/services/slotMatcher';
import { planGapRepairs } from '../apps/api/src/services/gapRepairPlanner';
import { generateTimelineMock } from '../apps/api/src/services/timelineGenerator';
import { generateTransitionRecipes } from '../apps/api/src/services/transitions/transitionRecipeGenerator';
import { generateAudioPlan } from '../apps/api/src/services/audio/audioPlanGenerator';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = path.join(repoRoot, 'tmp');

const INPUTS = {
  structureGraph: 'seed_assets/analysis/macbook_neo/structure_graph.json',
  originalAssetCards: 'seed_assets/asset_libraries/kangshifu_demo/asset_cards.json',
  plainAssetCards: 'seed_assets/asset_libraries/kangshifu_plain_user_test/asset_cards.json'
} as const;

const OUTPUTS = {
  json: 'tmp/full-pipeline-e2e.json',
  report: 'tmp/full-pipeline-e2e-report.md'
} as const;

const beverageBrief: ContentBrief = {
  productName: '康师傅冰红茶',
  category: 'beverage',
  targetAudience: '夏天通勤、聚餐、户外活动中的年轻消费者',
  scenario: '炎热天气、饭后解腻、朋友聚会时需要冰爽饮品',
  sellingPoints: ['冰爽解腻', '柠檬茶香', '适合聚餐分享', '冰镇后口感更清爽'],
  cta: '现在就来一瓶康师傅冰红茶',
  stylePreference: '普通用户真实素材，轻包装，重点验证素材缺口识别和补全输入简报'
};

type ScenarioId = 'single_image_only' | 'partial_real_footage' | 'beverage_motif_transfer';

interface ScenarioOutput {
  scenarioId: ScenarioId;
  targetCategory: string;
  coverage: number;
  assetSupplyContext: AssetSupplyContext;
  matches: SlotMatch[];
  materialGaps: MaterialGap[];
  missingMaterialBriefs: NonNullable<AssetSupplyContext['missingMaterialBriefs']>;
  gapRepairs: GapRepair[];
  timeline: TimelineItem[];
  transitionRecipes: TransitionRecipe[];
  audioCues: AudioCue[];
  evidenceRows: Array<Record<string, unknown>>;
  warnings: string[];
  verdict: 'passed' | 'needs_review';
}

interface FullPipelineE2EOutput {
  generatedAt: string;
  inputs: typeof INPUTS;
  outputs: typeof OUTPUTS;
  scenarios: ScenarioOutput[];
  slotBlock004Trace: Record<string, unknown>;
  validation: {
    noSourceLeakageInTargetFields: boolean;
    externalGenerationBoundary: 'job_card_only';
    audioBoundary: 'plan_only_not_generated';
    transitionBoundary: 'plan_only_not_rendered';
    noFakeCtr: boolean;
  };
}

async function main(): Promise<void> {
  mkdirSync(tmpDir, { recursive: true });
  const result = await buildFullPipelineE2E();
  writeJson(OUTPUTS.json, result);
  writeText(OUTPUTS.report, buildMarkdownReport(result));

  console.log('Full pipeline E2E complete.');
  for (const scenario of result.scenarios) {
    console.log([
      `- ${scenario.scenarioId}:`,
      `coverage=${scenario.coverage}`,
      `missingBriefs=${scenario.missingMaterialBriefs.length}`,
      `gapRepairs=${scenario.gapRepairs.length}`,
      `transitions=${scenario.transitionRecipes.length}`,
      `audioCues=${scenario.audioCues.length}`,
      `evidenceRows=${scenario.evidenceRows.length}`,
      `verdict=${scenario.verdict}`
    ].join(' '));
  }
  console.log(`slot_block_004 leakage=${JSON.stringify(result.slotBlock004Trace['leakageCheck'])}`);
  console.log(`Wrote ${OUTPUTS.json}`);
  console.log(`Wrote ${OUTPUTS.report}`);
}

export async function buildFullPipelineE2E(): Promise<FullPipelineE2EOutput> {
  const structureGraph = readJson<ViralStructureGraph>(INPUTS.structureGraph);
  const originalCards = normalizeAssetCards(readJson<AssetCard[]>(INPUTS.originalAssetCards));
  const plainCards = normalizeAssetCards(readJson<AssetCard[]>(INPUTS.plainAssetCards));
  const productImage = originalCards.find((asset) => asset.type === 'image') ?? originalCards[0];
  const beveragePreset = buildDeterministicPreset({
    category: 'beverage',
    availableAssets: plainCards.map((asset) => asset.id)
  });

  const scenarios = await Promise.all([
    runScenario({
      scenarioId: 'single_image_only',
      structureGraph,
      assetCards: productImage ? [productImage] : [],
      contentBrief: beverageBrief,
      categoryPreset: beveragePreset,
      options: { userCanGenerate: false }
    }),
    runScenario({
      scenarioId: 'partial_real_footage',
      structureGraph,
      assetCards: plainCards,
      contentBrief: beverageBrief,
      categoryPreset: beveragePreset,
      options: { userCanGenerate: false }
    }),
    runScenario({
      scenarioId: 'beverage_motif_transfer',
      structureGraph,
      assetCards: plainCards,
      contentBrief: beverageBrief,
      categoryPreset: beveragePreset,
      options: { userCanGenerate: true }
    })
  ]);

  const motifScenario = scenarios.find((scenario) => scenario.scenarioId === 'beverage_motif_transfer')!;
  const slotBlock004Trace = buildSlotBlock004Trace(structureGraph, beveragePreset, motifScenario);

  return {
    generatedAt: new Date().toISOString(),
    inputs: INPUTS,
    outputs: OUTPUTS,
    scenarios,
    slotBlock004Trace,
    validation: {
      noSourceLeakageInTargetFields: Boolean((slotBlock004Trace['leakageCheck'] as { passed?: boolean }).passed),
      externalGenerationBoundary: 'job_card_only',
      audioBoundary: 'plan_only_not_generated',
      transitionBoundary: 'plan_only_not_rendered',
      noFakeCtr: true
    }
  };
}

async function runScenario(input: {
  scenarioId: ScenarioId;
  structureGraph: ViralStructureGraph;
  assetCards: AssetCard[];
  contentBrief: ContentBrief;
  categoryPreset: CategoryPreset;
  options?: { userCanGenerate?: boolean };
}): Promise<ScenarioOutput> {
  const assetSupplyContext = buildAssetSupplyContext({
    structureGraph: input.structureGraph,
    assetCards: input.assetCards,
    contentBrief: input.contentBrief,
    libraryId: input.scenarioId,
    categoryPreset: input.categoryPreset,
    options: input.options
  });
  const matchResult = matchSlots(input.structureGraph, assetSupplyContext.assets);
  const materialGaps = mergeGapMotifContext(matchResult.gaps, assetSupplyContext);
  const gapRepairs = planGapRepairs(materialGaps, assetSupplyContext.assets, input.contentBrief);
  const generated = await generateTimelineMock({
    structureGraph: input.structureGraph,
    newContent: input.contentBrief,
    matches: matchResult.matches,
    repairs: gapRepairs,
    variant: input.scenarioId === 'beverage_motif_transfer' ? 'high_click' : 'high_conversion'
  });
  const slotBlock004Context = findCoverageMotifContext(assetSupplyContext, 'slot_block_004_asset_001');
  const transitionRecipes = generateTransitionRecipes({
    timeline: generated.timeline,
    motifContext: slotBlock004Context,
    assetSupplyContext,
    targetCategory: input.categoryPreset.category,
    productBrief: input.contentBrief,
    variant: input.scenarioId === 'beverage_motif_transfer' ? 'high_click' : 'high_conversion'
  });
  const audio = generateAudioPlan({
    timeline: generated.timeline,
    transitionRecipes,
    targetCategory: input.categoryPreset.category,
    productBrief: input.contentBrief,
    variant: input.scenarioId === 'beverage_motif_transfer' ? 'high_click' : 'high_conversion',
    durationSec: 15
  });
  const evidenceRows = buildEvidenceRows(assetSupplyContext, materialGaps, gapRepairs, generated.timeline, transitionRecipes, audio.cues);
  const warnings = Array.from(new Set([
    ...assetSupplyContext.warnings,
    ...audio.warnings,
    'TransitionRecipe is plan-only; no video effect is rendered here.',
    'AudioPlan is plan-only; no BGM/SFX is generated or mixed here.',
    'External generation remains job-card/future-adapter only.'
  ]));

  return {
    scenarioId: input.scenarioId,
    targetCategory: input.categoryPreset.category,
    coverage: assetSupplyContext.contextualCoverage?.coverageSummary.coverageScore ?? 0,
    assetSupplyContext,
    matches: matchResult.matches,
    materialGaps,
    missingMaterialBriefs: assetSupplyContext.missingMaterialBriefs ?? [],
    gapRepairs,
    timeline: generated.timeline,
    transitionRecipes,
    audioCues: audio.cues,
    evidenceRows,
    warnings,
    verdict: evidenceRows.length && transitionRecipes.length && audio.cues.length ? 'passed' : 'needs_review'
  };
}

function mergeGapMotifContext(gaps: MaterialGap[], context: AssetSupplyContext): MaterialGap[] {
  return gaps.map((gap) => {
    const coverageContext = findCoverageMotifContext(context, gap.slotId);
    return {
      ...gap,
      motifContext: coverageContext ?? gap.motifContext
    };
  });
}

function findCoverageMotifContext(context: AssetSupplyContext, slotId: string): MotifContext | undefined {
  return context.contextualCoverage?.slotCoverages.find((coverage) => coverage.slotId === slotId)?.motifContext;
}

function buildSlotBlock004Trace(
  graph: ViralStructureGraph,
  categoryPreset: CategoryPreset,
  scenario: ScenarioOutput
): Record<string, unknown> {
  const sourceSlot = graph.shotSlots.find((slot) => slot.id === 'slot_block_004_asset_001');
  const motifAnnotation = sourceSlot
    ? extractViralMotifAnnotation({ slot: sourceSlot, targetCategory: 'beverage', preset: categoryPreset })
    : undefined;
  const motifContext = motifAnnotation ? buildMotifContext(motifAnnotation) : undefined;
  const missingMaterialBrief = scenario.missingMaterialBriefs.find((brief) => brief.affectedSlotId === 'slot_block_004_asset_001');
  const gapRepairEvidence = scenario.gapRepairs.find((repair) => repair.slotId === 'slot_block_004_asset_001');
  const timelineItem = scenario.timeline.find((item) => item.slotId === 'slot_block_004_asset_001');
  const transitionRecipe = scenario.transitionRecipes.find((recipe) =>
    recipe.beforeShotId === timelineItem?.id || recipe.afterShotId === timelineItem?.id
  ) ?? scenario.transitionRecipes[0];
  const audioCues = scenario.audioCues.slice(0, 6);
  const migrationEvidenceRow = scenario.evidenceRows.find((row) => row['slotId'] === 'slot_block_004_asset_001');
  const leakageCheck = checkLeakage([
    missingMaterialBrief?.aigcGenerationBrief?.prompt,
    missingMaterialBrief?.hyperframesBrief?.visualElements.join(' '),
    transitionRecipe?.storyboardPrompt,
    transitionRecipe?.videoPrompt,
    transitionRecipe?.transitionAction
  ]);

  return {
    sourceSlot,
    motifAnnotation,
    motifContext,
    categoryPreset: {
      category: categoryPreset.category,
      source: categoryPreset.source,
      objects: categoryPreset.objects,
      actions: categoryPreset.actions,
      motifEquivalents: categoryPreset.motifEquivalents.kinetic_assembly_reveal
    },
    missingMaterialBrief,
    gapRepairEvidence,
    timelineItem: timelineItem
      ? {
          ...timelineItem,
          motifAwareVisualAction: [
            timelineItem.visualAction,
            motifContext ? `motif-aware: ${motifContext.sanitizedIntent}` : undefined,
            missingMaterialBrief?.hyperframesBrief?.visualElements.length
              ? `target mapping: ${missingMaterialBrief.hyperframesBrief.visualElements.slice(0, 5).join(' / ')}`
              : undefined
          ].filter(Boolean).join(' | ')
        }
      : undefined,
    transitionRecipe,
    audioCues,
    migrationEvidenceRow,
    leakageCheck
  };
}

function buildEvidenceRows(
  context: AssetSupplyContext,
  gaps: MaterialGap[],
  repairs: GapRepair[],
  timeline: TimelineItem[],
  transitions: TransitionRecipe[],
  audioCues: AudioCue[]
): Array<Record<string, unknown>> {
  return (context.contextualCoverage?.slotCoverages ?? []).map((coverage) => {
    const missingBrief = context.missingMaterialBriefs?.find((brief) => brief.affectedSlotId === coverage.slotId);
    const gap = gaps.find((entry) => entry.slotId === coverage.slotId);
    const repair = repairs.find((entry) => entry.slotId === coverage.slotId);
    const item = timeline.find((entry) => entry.slotId === coverage.slotId);
    const transition = transitions.find((entry) => entry.beforeShotId === item?.id || entry.afterShotId === item?.id);
    return {
      slotId: coverage.slotId,
      sourceMotif: coverage.motifContext?.motifType,
      abstractGrammar: coverage.motifContext?.sanitizedIntent,
      targetMapping: coverage.motifContext?.targetMotifHints,
      coverageStatus: coverage.coverageStatus,
      missingIngredients: coverage.missingIngredients.map((ingredient) => ingredient.label),
      missingMaterialBrief: missingBrief
        ? {
            manualShootBrief: missingBrief.manualShootBrief?.mustCapture,
            aigcPromptBrief: missingBrief.aigcGenerationBrief?.prompt,
            hyperframesBrief: missingBrief.hyperframesBrief?.visualElements,
            ownership: missingBrief.ownership
          }
        : undefined,
      materialGap: gap
        ? { severity: gap.severity, reason: gap.reason, motifType: gap.motifContext?.motifType }
        : undefined,
      gapRepairEvidence: repair
        ? { strategy: repair.strategy, explanation: repair.explanation }
        : undefined,
      timelineItem: item
        ? { id: item.id, visualAction: item.visualAction, repair: item.repair?.strategy }
        : undefined,
      transitionPlan: transition
        ? { name: transition.name, function: transition.transitionFunction, implementationMode: transition.implementationMode }
        : undefined,
      sonicPlan: audioCues.length
        ? audioCues.slice(0, 3).map((cue) => ({ cueType: cue.cueType, soundDescription: cue.soundDescription }))
        : undefined,
      boundary: 'handoff only; no real external generation, audio generation, or MP4 export'
    };
  });
}

function checkLeakage(values: Array<string | undefined>): { passed: boolean; checkedFields: number; bannedTerms: string[]; hits: string[] } {
  const bannedTerms = ['keyboard', 'laptop', 'trackpad', 'rocket', 'hardware', '键盘', '笔记本', '触控板', '火箭', '硬件功能'];
  const text = values.filter(Boolean).join('\n').toLowerCase();
  const hits = bannedTerms.filter((term) => text.includes(term.toLowerCase()));
  return {
    passed: hits.length === 0,
    checkedFields: values.filter(Boolean).length,
    bannedTerms,
    hits
  };
}

function buildMarkdownReport(result: FullPipelineE2EOutput): string {
  return [
    '# Full Pipeline E2E Report',
    '',
    '## 1. Scenario Summary',
    '',
    markdownTable(
      ['scenario', 'coverage', 'missingBriefs', 'gapRepairs', 'transitions', 'audioCues', 'evidenceRows', 'verdict'],
      result.scenarios.map((scenario) => [
        scenario.scenarioId,
        String(scenario.coverage),
        String(scenario.missingMaterialBriefs.length),
        String(scenario.gapRepairs.length),
        String(scenario.transitionRecipes.length),
        String(scenario.audioCues.length),
        String(scenario.evidenceRows.length),
        scenario.verdict
      ])
    ),
    '',
    '## 2. slot_block_004 Trace',
    '',
    '- sourceSlot -> motifAnnotation -> categoryPreset -> missingMaterialBrief -> gapRepairEvidence -> timelineItem -> transitionRecipe -> audioPlan -> migrationEvidenceRow',
    `- motifType: ${valueAt(result.slotBlock004Trace, 'motifAnnotation.motifType')}`,
    `- motionTokens: ${(valueAt(result.slotBlock004Trace, 'motifAnnotation.motionTokens') as string[] | undefined)?.join(', ') ?? 'n/a'}`,
    `- target mapping: ${(valueAt(result.slotBlock004Trace, 'categoryPreset.motifEquivalents') as string[] | undefined)?.join(', ') ?? 'n/a'}`,
    `- gap repair: ${valueAt(result.slotBlock004Trace, 'gapRepairEvidence.explanation') ?? 'n/a'}`,
    `- timeline visual action: ${valueAt(result.slotBlock004Trace, 'timelineItem.motifAwareVisualAction') ?? 'n/a'}`,
    `- transition recipe: ${valueAt(result.slotBlock004Trace, 'transitionRecipe.name') ?? 'n/a'}`,
    `- audio cues: ${((result.slotBlock004Trace['audioCues'] as AudioCue[] | undefined) ?? []).map((cue) => cue.soundDescription).join(' / ') || 'n/a'}`,
    '',
    '## 3. Source Semantics Sanitization',
    '',
    `- leakage result: ${JSON.stringify(result.slotBlock004Trace['leakageCheck'])}`,
    '- Source terms may remain in sourceSlot / bannedSourceTerms / negativePrompt only.',
    '- Target prompt, visualElements, transition prompt, and audio prompt are checked for keyboard/laptop/rocket/hardware leakage.',
    '',
    '## 4. Category Preset Usage',
    '',
    '- Generic fallback: available through deterministic CategoryPreset when target category is unknown/generic.',
    '- Beverage preset: used for the ice tea demo case only.',
    '- Core flow passes categoryPreset into contextual coverage and missing-material handoff briefs.',
    '',
    '## 5. Transition / Audio Handoff',
    '',
    '- TransitionRecipe objects are plan-only and carry implementationMode, requiredAssets, missingAssetFallback, storyboardPrompt and videoPrompt.',
    '- AudioPlan objects are plan-only and carry cues, beat sync, sound gaps and job cards.',
    '',
    '## 6. Renderer / UI Handoff',
    '',
    '- Renderer/UI can consume evidenceRows, transitionRecipes and audioCues from this JSON.',
    '- This script does not render MP4, generate audio, or call external image/video/audio models.',
    '',
    '## 7. Competition Scoring Mapping',
    '',
    '- 素材缺口识别: slot-level coverage + observations + missingIngredients.',
    '- 素材缺口补全: manualShootBrief / AIGC prompt brief / HyperFrames brief as handoff inputs.',
    '- 迁移过程可视化: source motif -> abstract grammar -> target mapping -> transition/audio plan.',
    '- 最终展示: timeline + transition/audio handoff evidence, without overclaiming renderer output.',
    '- 真实素材适配: single image and partial real footage scenarios stay distinct.',
    '',
    '## 8. Warnings and Limits',
    '',
    '- no real external generation',
    '- no real audio generated',
    '- no MP4 claim',
    '- job-card / plan-only boundaries'
  ].join('\n');
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' |')} |`,
    `| ${headers.map(() => '---').join(' |')} |`,
    ...rows.map((row) => `| ${row.map(escapeCell).join(' |')} |`)
  ].join('\n');
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '/').replace(/\n/g, ' ');
}

function valueAt(obj: Record<string, unknown>, pathExpression: string): unknown {
  return pathExpression.split('.').reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[key];
  }, obj);
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

if (process.argv[1] && existsSync(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
