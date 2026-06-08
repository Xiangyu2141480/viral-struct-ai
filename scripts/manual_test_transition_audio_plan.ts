import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AssetSupplyContext,
  AudioCue,
  AudioGenerationJobCard,
  AudioTrackPlan,
  BeatSyncMap,
  ContentBrief,
  MotifContext,
  SoundGap,
  TargetCategory,
  TimelineItem,
  TransitionRecipe,
  ViralStructureGraph
} from '../packages/shared/src/types';
import {
  generateAudioPlan,
  type AudioPlanGenerationResult
} from '../apps/api/src/services/audio/audioPlanGenerator';
import { generateTransitionRecipes } from '../apps/api/src/services/transitions/transitionRecipeGenerator';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = path.join(repoRoot, 'tmp');

const INPUTS = {
  structureGraph: 'seed_assets/analysis/macbook_neo/structure_graph.json',
  plainAssetSupply: 'tmp/asset-supply-plain.json',
  motifAwareBrief: 'docs/examples/motif-aware-brief-slot-block-004.sample.json'
} as const;

const OUTPUTS = {
  generic: 'tmp/transition-audio-plan-generic.json',
  beverage: 'tmp/transition-audio-plan-beverage-demo.json',
  report: 'tmp/transition-audio-plan-report.md'
} as const;

export interface ManualTransitionAudioScenarioOutput {
  scenario: 'generic_product' | 'beverage_kangshifu_demo';
  generatedAt: string;
  sourceFiles: Record<string, { path: string; exists: boolean }>;
  targetCategory: TargetCategory;
  variant: 'high_click' | 'high_conversion' | 'premium';
  productBrief: ContentBrief;
  timeline: TimelineItem[];
  transitionRecipes: TransitionRecipe[];
  audio: {
    audioTrackPlan: AudioTrackPlan;
    cues: AudioCue[];
    beatSyncMap: BeatSyncMap;
    soundGaps: SoundGap[];
    audioGenerationJobs: AudioGenerationJobCard[];
  };
  warnings: string[];
  rendererHandoff: {
    status: 'plan_only';
    transitionRecipes: TransitionRecipe[];
    audioPlan: AudioTrackPlan;
    audioCues: AudioCue[];
    audioWarnings: string[];
    transitionFields: string[];
    audioFields: string[];
    notes: string[];
  };
}

export interface ManualTransitionAudioPlanResult {
  generatedAt: string;
  inputs: typeof INPUTS;
  outputs: typeof OUTPUTS;
  generic: ManualTransitionAudioScenarioOutput;
  beverage: ManualTransitionAudioScenarioOutput;
}

export async function buildManualTransitionAudioPlanPayloads(): Promise<ManualTransitionAudioPlanResult> {
  const generatedAt = new Date().toISOString();
  const structureGraph = readOptionalJson<ViralStructureGraph>(INPUTS.structureGraph);
  const plainAssetSupply = readOptionalJson<AssetSupplyContext>(INPUTS.plainAssetSupply);
  const motifBriefExists = existsInRepo(INPUTS.motifAwareBrief);
  const motifContext = buildKineticAssemblyMotifContext(structureGraph, motifBriefExists);

  const generic = buildScenarioOutput({
    scenario: 'generic_product',
    generatedAt,
    targetCategory: 'generic',
    variant: 'premium',
    productBrief: genericProductBrief,
    timeline: genericTimeline,
    motifContext: undefined,
    assetSupplyContext: undefined
  });

  const beverage = buildScenarioOutput({
    scenario: 'beverage_kangshifu_demo',
    generatedAt,
    targetCategory: 'beverage',
    variant: 'high_click',
    productBrief: beverageProductBrief,
    timeline: beverageTimeline,
    motifContext,
    assetSupplyContext: plainAssetSupply
  });

  return {
    generatedAt,
    inputs: INPUTS,
    outputs: OUTPUTS,
    generic,
    beverage
  };
}

export function buildTransitionAudioMarkdownReport(result: ManualTransitionAudioPlanResult): string {
  const scenarioSummaries = [result.generic, result.beverage];
  const recipeRows = scenarioSummaries.flatMap((scenario) => scenario.transitionRecipes.map((recipe) => [
    scenario.targetCategory,
    describeShot(recipe.beforeShotId, scenario.timeline),
    describeShot(recipe.afterShotId, scenario.timeline),
    recipe.name,
    recipe.transitionFunction,
    recipe.implementationMode,
    recipe.requiredAssets.map((asset) => asset.label).slice(0, 3).join(', '),
    recipe.missingAssetFallback.mode
  ]));
  const cueRows = scenarioSummaries.flatMap((scenario) => scenario.audio.cues.map((cue) => [
    scenario.targetCategory,
    `${cue.startTime.toFixed(1)}s`,
    cue.cueType,
    cue.syncTarget,
    cue.soundDescription,
    cue.fallback ?? 'plan-only audio job card',
    summarizeVariantBehavior(cue)
  ]));

  return [
    '# Transition & Audio Plan Manual Report',
    '',
    '## 1. Generic Product Result',
    '',
    buildScenarioSummary(result.generic),
    '',
    '## 2. Beverage Demo Result',
    '',
    buildScenarioSummary(result.beverage),
    '',
    '## 3. Transition Recipes',
    '',
    markdownTable(
      ['category', 'from', 'to', 'recipe', 'function', 'implementationMode', 'requiredAssets', 'fallback'],
      recipeRows
    ),
    '',
    '## 4. Audio Cues',
    '',
    markdownTable(
      ['category', 'time', 'cue', 'sync target', 'sound', 'fallback', 'variant behavior'],
      cueRows
    ),
    '',
    '## 5. 15s Audio-Visual Timeline',
    '',
    '### Generic',
    '',
    buildTimelineTable(result.generic),
    '',
    '### Beverage Demo',
    '',
    buildTimelineTable(result.beverage),
    '',
    '## 6. Missing Assets / Warnings',
    '',
    buildWarningsSection(result),
    '',
    '## 7. Renderer Handoff',
    '',
    '- Video Agent / renderer should consume `transitionRecipes[].beforeShotId`, `afterShotId`, `transitionAction`, `motionGrammar`, `implementationMode`, `storyboardPrompt`, `videoPrompt`, and `missingAssetFallback`.',
    '- Audio planning consumers should read `audio.audioTrackPlan`, `audio.cues`, `audio.beatSyncMap`, `audio.soundGaps`, and `audio.audioGenerationJobs`.',
    '- This script does not render MP4, generate audio, mix audio into video, or call external models. It only produces plan-ready handoff data.',
    '- If a renderer is absent, the expected behavior is to keep these plans as reviewable handoff cards.'
  ].join('\n');
}

export async function runManualTransitionAudioPlanTest(): Promise<void> {
  mkdirSync(tmpDir, { recursive: true });
  const result = await buildManualTransitionAudioPlanPayloads();

  writeJson(OUTPUTS.generic, result.generic);
  writeJson(OUTPUTS.beverage, result.beverage);
  writeText(OUTPUTS.report, buildTransitionAudioMarkdownReport(result));

  console.log('Transition & Audio manual plan complete.');
  console.log(formatConsoleSummary('generic', result.generic));
  console.log(formatConsoleSummary('beverage', result.beverage));
  console.log(`Wrote ${OUTPUTS.generic}`);
  console.log(`Wrote ${OUTPUTS.beverage}`);
  console.log(`Wrote ${OUTPUTS.report}`);
}

function buildScenarioOutput(input: {
  scenario: ManualTransitionAudioScenarioOutput['scenario'];
  generatedAt: string;
  targetCategory: string;
  variant: 'high_click' | 'high_conversion' | 'premium';
  productBrief: ContentBrief;
  timeline: TimelineItem[];
  motifContext?: MotifContext;
  assetSupplyContext?: AssetSupplyContext;
}): ManualTransitionAudioScenarioOutput {
  const transitionRecipes = generateTransitionRecipes({
    timeline: input.timeline,
    motifContext: input.motifContext,
    assetSupplyContext: input.assetSupplyContext,
    targetCategory: input.targetCategory,
    productBrief: { ...input.productBrief },
    variant: input.variant
  });
  const audio = generateAudioPlan({
    timeline: input.timeline,
    transitionRecipes,
    targetCategory: input.targetCategory,
    productBrief: { ...input.productBrief },
    variant: input.variant,
    durationSec: 15
  });

  const targetCategory = transitionRecipes[0]?.targetCategory ?? audio.audioTrackPlan.targetCategory;
  return {
    scenario: input.scenario,
    generatedAt: input.generatedAt,
    sourceFiles: buildSourceFileStatus(),
    targetCategory,
    variant: input.variant,
    productBrief: input.productBrief,
    timeline: input.timeline,
    transitionRecipes,
    audio: {
      audioTrackPlan: audio.audioTrackPlan,
      cues: audio.cues,
      beatSyncMap: audio.beatSyncMap,
      soundGaps: audio.soundGaps,
      audioGenerationJobs: audio.audioGenerationJobs
    },
    warnings: buildScenarioWarnings(input, audio),
    rendererHandoff: {
      status: 'plan_only',
      transitionRecipes,
      audioPlan: audio.audioTrackPlan,
      audioCues: audio.cues,
      audioWarnings: audio.warnings,
      transitionFields: [
        'transitionRecipes[].beforeShotId',
        'transitionRecipes[].afterShotId',
        'transitionRecipes[].transitionAction',
        'transitionRecipes[].motionGrammar',
        'transitionRecipes[].implementationMode',
        'transitionRecipes[].storyboardPrompt',
        'transitionRecipes[].videoPrompt',
        'transitionRecipes[].missingAssetFallback'
      ],
      audioFields: [
        'audio.audioTrackPlan.mode',
        'audio.cues[].startTime',
        'audio.cues[].cueType',
        'audio.cues[].syncTarget',
        'audio.cues[].soundDescription',
        'audio.beatSyncMap.beats',
        'audio.soundGaps',
        'audio.audioGenerationJobs'
      ],
      notes: [
        'Plan-only output. No renderer is required for this benchmark.',
        'No real video, audio, or external model output is generated.',
        'External generation modes are future handoff paths, not current rendered assets.'
      ]
    }
  };
}

function buildScenarioWarnings(
  input: { assetSupplyContext?: AssetSupplyContext },
  audio: AudioPlanGenerationResult
): string[] {
  const warnings = new Set<string>([
    ...audio.warnings,
    'No real audio assets were provided; output remains an audio plan with generation job cards.',
    'No renderer is invoked; transition recipes remain plan-only handoff data.'
  ]);

  if (!input.assetSupplyContext) {
    warnings.add('No AssetSupplyContext was provided for this scenario; transition implementation modes rely on preset fallback policy.');
  }
  return [...warnings];
}

function buildSourceFileStatus(): ManualTransitionAudioScenarioOutput['sourceFiles'] {
  return {
    structureGraph: { path: INPUTS.structureGraph, exists: existsInRepo(INPUTS.structureGraph) },
    plainAssetSupply: { path: INPUTS.plainAssetSupply, exists: existsInRepo(INPUTS.plainAssetSupply) },
    motifAwareBrief: { path: INPUTS.motifAwareBrief, exists: existsInRepo(INPUTS.motifAwareBrief) }
  };
}

function buildKineticAssemblyMotifContext(
  structureGraph: ViralStructureGraph | undefined,
  motifBriefExists: boolean
): MotifContext {
  return {
    motifAnnotationId: 'manual_motif_kinetic_assembly',
    motifType: 'kinetic_assembly_reveal',
    motionTokens: [
      'dynamic_entry',
      'component_cascade',
      'chaos_to_order',
      'assembly_completion',
      'interaction_activation',
      'spectacle_burst',
      'cta_reveal'
    ],
    missingMotionTokens: ['spectacle_burst', 'cta_reveal'],
    sanitizedIntent: 'Dynamic target-native ingredient cascade, interaction activation, spectacle burst, and CTA reveal.',
    targetMotifHints: ['category-native objects', 'activation beat', 'clean CTA lock-up'],
    confidence: structureGraph ? 0.82 : 0.72,
    evidence: [
      structureGraph ? 'Read source structure graph for motif benchmark context.' : 'Source structure graph missing; using deterministic fallback motif context.',
      motifBriefExists ? 'Motif-aware brief sample exists and is included as context.' : 'Motif-aware brief sample missing; using preset-safe motif context.'
    ]
  };
}

const genericProductBrief: ContentBrief = {
  productName: 'Modular Desk Lamp',
  targetAudience: 'remote workers and small-space creators',
  scenario: 'evening workspace reset before focused work',
  sellingPoints: ['foldable design', 'warm-to-focus lighting', 'small desk footprint'],
  cta: 'Set up your focus corner today',
  stylePreference: 'clean generic product demo with plan-only transitions'
};

const beverageProductBrief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: 'summer commuters, students, and young shoppers',
  scenario: 'hot outdoor commute, convenience store stop, lunch break refresh',
  sellingPoints: ['ice-cold refresh', 'lemon tea taste', 'easy grab-and-go bottle'],
  cta: '现在就来一瓶',
  stylePreference: 'bright summer beverage demo with honest plan-only transition and audio handoff'
};

const genericTimeline: TimelineItem[] = [
  {
    id: 'generic_hook',
    start: 0,
    end: 3,
    segmentRole: 'hook',
    sourceSegmentId: 'generic_segment_hook',
    slotId: 'generic_slot_hook',
    script: 'Messy desk, focus starts with one clean switch.',
    subtitles: ['Focus starts with one clean switch'],
    visualAction: 'workspace clutter resolves into a lit product reveal',
    packaging: { captionStyle: 'bold', cardType: 'title_card', transition: 'quick_cut', motion: 'push_in' }
  },
  {
    id: 'generic_product',
    start: 3,
    end: 7,
    segmentRole: 'selling_point',
    sourceSegmentId: 'generic_segment_product',
    slotId: 'generic_slot_product',
    script: 'Fold, rotate, and aim the light exactly where work happens.',
    subtitles: ['Fold Rotate Aim'],
    visualAction: 'product components align into a clean desk setup',
    packaging: { captionStyle: 'clean', cardType: 'selling_point_card', transition: 'fade', motion: 'pan' }
  },
  {
    id: 'generic_usage',
    start: 7,
    end: 11,
    segmentRole: 'usage',
    sourceSegmentId: 'generic_segment_usage',
    slotId: 'generic_slot_usage',
    script: 'Warm mode for reading, focus mode for deep work.',
    subtitles: ['Warm mode Focus mode'],
    visualAction: 'lighting temperature shifts across desk details',
    packaging: { captionStyle: 'clean', transition: 'fade', motion: 'push_in' }
  },
  {
    id: 'generic_cta',
    start: 11,
    end: 15,
    segmentRole: 'cta',
    sourceSegmentId: 'generic_segment_cta',
    slotId: 'generic_slot_cta',
    script: 'Build a better desk rhythm today.',
    subtitles: ['Build a better desk rhythm'],
    visualAction: 'minimal end frame with product and CTA',
    packaging: { captionStyle: 'bold', cardType: 'cta_card', transition: 'quick_cut', motion: 'static' }
  }
];

const beverageTimeline: TimelineItem[] = [
  {
    id: 'beverage_heat_hook',
    start: 0,
    end: 2.5,
    segmentRole: 'hook',
    sourceSegmentId: 'beverage_segment_hook',
    slotId: 'beverage_slot_hook',
    script: '热浪上头，冰爽先冲出来。',
    subtitles: ['热浪上头 冰爽先到'],
    visualAction: 'heat haze breaks into cold refresh objects',
    packaging: { captionStyle: 'bold', cardType: 'title_card', transition: 'quick_cut', motion: 'push_in' }
  },
  {
    id: 'beverage_ingredient_cascade',
    start: 2.5,
    end: 5.5,
    segmentRole: 'usage',
    sourceSegmentId: 'beverage_segment_ingredient',
    slotId: 'beverage_slot_ingredient',
    script: '冰块、柠檬和红茶水滴聚拢成清爽画面。',
    subtitles: ['冰块 柠檬 红茶水滴'],
    visualAction: 'ice cubes, lemon slices, and tea droplets converge toward the product',
    packaging: { captionStyle: 'clean', transition: 'fade', motion: 'pan' }
  },
  {
    id: 'beverage_product_closeup',
    start: 5.5,
    end: 8.5,
    segmentRole: 'selling_point',
    sourceSegmentId: 'beverage_segment_product',
    slotId: 'beverage_slot_product',
    assetId: 'plain_001_table_product_pan',
    script: '瓶身冷凝，柠檬茶感和冰爽卖点提前出现。',
    subtitles: ['冰爽 柠檬茶感'],
    visualAction: 'product closeup with condensation and brand lock-up',
    packaging: { captionStyle: 'clean', cardType: 'selling_point_card', transition: 'fade', motion: 'push_in' }
  },
  {
    id: 'beverage_usage_proof',
    start: 8.5,
    end: 12,
    segmentRole: 'proof',
    sourceSegmentId: 'beverage_segment_proof',
    slotId: 'beverage_slot_proof',
    assetId: 'plain_002_hand_pickup',
    script: '拿起、开盖、入口前的冷感细节形成证明。',
    subtitles: ['拿起 开盖 冷感证明'],
    visualAction: 'hand pickup, cap pop, and cold detail proof',
    packaging: { captionStyle: 'clean', transition: 'push', motion: 'pan' }
  },
  {
    id: 'beverage_cta',
    start: 12,
    end: 15,
    segmentRole: 'cta',
    sourceSegmentId: 'beverage_segment_cta',
    slotId: 'beverage_slot_cta',
    assetId: 'plain_001_table_product_pan',
    script: '现在就来一瓶，给夏天降温。',
    subtitles: ['现在就来一瓶'],
    visualAction: 'clean product end frame with CTA lock-up',
    packaging: { captionStyle: 'bold', cardType: 'cta_card', transition: 'quick_cut', motion: 'static' }
  }
];

function buildScenarioSummary(scenario: ManualTransitionAudioScenarioOutput): string {
  return [
    `- category: ${scenario.targetCategory}`,
    `- variant: ${scenario.variant}`,
    `- product: ${scenario.productBrief.productName}`,
    `- transition recipes: ${scenario.transitionRecipes.length}`,
    `- audio cues: ${scenario.audio.cues.length}`,
    `- audio mode: ${scenario.audio.audioTrackPlan.mode}`,
    `- renderable audio: ${scenario.audio.audioTrackPlan.hasRenderableAudio ? 'yes' : 'no, plan-only'}`,
    `- warnings: ${scenario.warnings.length}`
  ].join('\n');
}

function buildTimelineTable(scenario: ManualTransitionAudioScenarioOutput): string {
  const rows = scenario.timeline.map((item) => {
    const relatedRecipe = scenario.transitionRecipes.find((recipe) => recipe.beforeShotId === item.id || recipe.afterShotId === item.id);
    const relatedCue = scenario.audio.cues.find((cue) => cue.startTime >= item.start && cue.startTime < item.end);
    return [
      `${item.start.toFixed(1)}-${item.end.toFixed(1)}s`,
      item.segmentRole,
      item.script,
      relatedRecipe?.name ?? 'cut / hold',
      relatedCue?.soundDescription ?? 'no cue in this window'
    ];
  });
  return markdownTable(['time', 'role', 'visual/script', 'transition', 'audio cue'], rows);
}

function buildWarningsSection(result: ManualTransitionAudioPlanResult): string {
  const lines: string[] = [];
  for (const scenario of [result.generic, result.beverage]) {
    lines.push(`### ${scenario.targetCategory}`);
    lines.push('');
    for (const warning of scenario.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function markdownTable(headers: string[], rows: Array<Array<string | number | boolean | undefined>>): string {
  const normalizedRows = rows.length > 0 ? rows : [headers.map(() => 'Not available')];
  return [
    `| ${headers.map(escapeMarkdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...normalizedRows.map((row) => `| ${row.map((cell) => escapeMarkdownCell(String(cell ?? 'Not available'))).join(' | ')} |`)
  ].join('\n');
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

function describeShot(id: string, timeline: TimelineItem[]): string {
  const item = timeline.find((candidate) => candidate.id === id);
  if (!item) {
    return id;
  }
  return `${item.segmentRole} ${item.start.toFixed(1)}-${item.end.toFixed(1)}s`;
}

function summarizeVariantBehavior(cue: AudioCue): string {
  const behavior = cue.variantBehavior;
  if (!behavior) {
    return 'default';
  }
  return [
    behavior.high_click ? `high_click: ${behavior.high_click}` : undefined,
    behavior.high_conversion ? `high_conversion: ${behavior.high_conversion}` : undefined,
    behavior.premium ? `premium: ${behavior.premium}` : undefined
  ].filter(Boolean).join('; ') || 'default';
}

function formatConsoleSummary(label: string, scenario: ManualTransitionAudioScenarioOutput): string {
  return [
    `- ${label}:`,
    `category=${scenario.targetCategory}`,
    `recipes=${scenario.transitionRecipes.length}`,
    `audioCues=${scenario.audio.cues.length}`,
    `mode=${scenario.audio.audioTrackPlan.mode}`,
    `renderableAudio=${scenario.audio.audioTrackPlan.hasRenderableAudio}`
  ].join(' ');
}

function readOptionalJson<T>(relativePath: string): T | undefined {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(absolutePath, 'utf8')) as T;
}

function existsInRepo(relativePath: string): boolean {
  return existsSync(path.join(repoRoot, relativePath));
}

function writeJson(relativePath: string, value: unknown): void {
  writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(relativePath: string, value: string): void {
  writeFileSync(path.join(repoRoot, relativePath), value, 'utf8');
}

const directRunPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (directRunPath === fileURLToPath(import.meta.url)) {
  runManualTransitionAudioPlanTest().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
