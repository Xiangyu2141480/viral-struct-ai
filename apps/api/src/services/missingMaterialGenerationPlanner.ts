import type {
  ContentBrief,
  GapRepair,
  MaterialGap,
  MissingMaterialGenerationJob,
  MissingMaterialGenerationRequest,
  StoryboardFrame,
  TimelineItem
} from '@viral-struct/shared';
import { mockExternalGenerationAdapter } from './externalGenerationAdapters/mockAdapter';
import { checkVisualPromptSafety } from './visualSafetyChecker';
import { compactMissingMaterialPrompt } from './promptCompactor';

export interface MissingMaterialGenerationPlanResult {
  jobs: MissingMaterialGenerationJob[];
  source: 'missing_material_generation_planner';
  warnings: string[];
}

const fallbackBrief: ContentBrief = {
  productName: 'New product',
  targetAudience: 'target audience',
  scenario: 'usage scenario',
  sellingPoints: ['main benefit'],
  cta: 'Clear next action'
};

export function planMissingMaterialGenerationJobs(
  request: MissingMaterialGenerationRequest
): MissingMaterialGenerationPlanResult {
  const materialGaps = request.materialGaps ?? [];
  const contentBrief = request.contentBrief ?? fallbackBrief;
  const repairs = request.repairs ?? [];
  const timeline = request.timeline ?? [];
  const storyboardFrames = request.storyboardFrames ?? [];
  const aspectRatio = request.aspectRatio ?? inferAspectRatio(storyboardFrames);

  const jobs = materialGaps
    .filter((gap) => gap.severity === 'high' || gap.severity === 'medium')
    .map((gap, index) => buildJob({
      gap,
      index,
      repair: repairs.find((entry) => entry.slotId === gap.slotId),
      timelineItem: timeline.find((item) => item.slotId === gap.slotId),
      storyboardFrame: storyboardFrames.find((frame) => frame.slotId === gap.slotId),
      contentBrief,
      aspectRatio
    }))
    .map((job) => mockExternalGenerationAdapter.annotateJob(job));

  return {
    jobs,
    source: 'missing_material_generation_planner',
    warnings: [
      'No external video generation is submitted; jobs are Seedance-ready planning specs only and not submitted.',
      `${jobs.length} high/medium material gap job(s) planned or blocked.`
    ]
  };
}

function buildJob(input: {
  gap: MaterialGap;
  index: number;
  repair?: GapRepair;
  timelineItem?: TimelineItem;
  storyboardFrame?: StoryboardFrame;
  contentBrief: ContentBrief;
  aspectRatio: MissingMaterialGenerationJob['aspectRatio'];
}): MissingMaterialGenerationJob {
  const mode = input.storyboardFrame ? 'image_to_video' : 'text_to_video';
  const durationSec = clampDuration(input.timelineItem ? input.timelineItem.end - input.timelineItem.start : undefined);
  const repairSpec = input.repair?.gapSpec ?? input.gap.gapSpec;
  const shotSpec = [
    repairSpec?.ideal,
    repairSpec?.minimalAcceptable,
    repairSpec?.alternativeIfNoShoot,
    input.repair?.generatedAssetHint,
    input.repair?.explanation,
    input.gap.reason,
    input.gap.impact
  ].filter(Boolean).join(' | ');
  const rawPositivePrompt = buildPositivePrompt(input, shotSpec);
  const rawNegativePrompt = buildNegativePrompt(input.storyboardFrame);
  const compacted = compactMissingMaterialPrompt({
    rawPositivePrompt,
    negativePrompt: rawNegativePrompt,
    shotSpec,
    gap: input.gap,
    repair: input.repair,
    timelineItem: input.timelineItem,
    storyboardFrame: input.storyboardFrame,
    contentBrief: input.contentBrief,
    aspectRatio: input.aspectRatio
  });
  const safetyStatus = checkVisualPromptSafety({
    positivePrompt: `${compacted.positivePrompt} ${rawPositivePrompt} ${shotSpec}`,
    negativePrompt: compacted.negativePrompt,
    contentBrief: input.contentBrief
  });
  const status = safetyStatus.status === 'blocked' ? 'blocked' : 'planned';

  return {
    id: `missing_job_${input.index + 1}_${safeId(input.gap.slotId)}`,
    gapId: input.gap.slotId,
    repairId: input.repair ? `${input.repair.slotId}:${input.repair.strategy}` : undefined,
    timelineItemId: input.timelineItem?.id ?? input.storyboardFrame?.timelineItemId,
    provider: 'mock',
    providerLabel: 'Dry-run adapter / Seedance-ready spec',
    mode,
    status,
    durationSec,
    aspectRatio: input.aspectRatio,
    positivePrompt: compacted.positivePrompt,
    negativePrompt: compacted.negativePrompt,
    shotSpec: shotSpec || 'Not available',
    gapType: input.gap.type,
    gapSeverity: input.gap.severity,
    repairStrategy: input.repair?.strategy,
    storyboardFrameId: input.storyboardFrame?.id,
    promptMetadata: compacted.metadata,
    safetyStatus,
    blockedReason: status === 'blocked' ? `Blocked by brand safety: ${safetyStatus.reasons.join(' / ')}` : undefined,
    disclaimer: 'External generation plan, not current core output. No Seedance or external video model was called.'
  };
}

function buildPositivePrompt(input: {
  gap: MaterialGap;
  repair?: GapRepair;
  timelineItem?: TimelineItem;
  storyboardFrame?: StoryboardFrame;
  contentBrief: ContentBrief;
}, shotSpec: string): string {
  const framePrompt = input.storyboardFrame?.imagePrompt.positivePrompt;
  const sellingPoints = input.contentBrief.sellingPoints.slice(0, 3).join('、');
  return [
    `External missing-material video generation plan for ${input.contentBrief.productName}.`,
    `Gap type: ${input.gap.type ?? input.gap.role}; severity: ${input.gap.severity}.`,
    `Scenario: ${input.contentBrief.scenario}; selling points: ${sellingPoints}.`,
    `Timeline visual action: ${input.timelineItem?.visualAction ?? 'Not available'}.`,
    `Repair strategy: ${input.repair?.strategy ?? 'Not available'}; ${input.repair?.explanation ?? input.gap.reason}.`,
    framePrompt ? `Storyboard image reference prompt: ${framePrompt}` : 'No storyboard image reference; use text-to-video shot planning.',
    `Shot spec: ${shotSpec || input.gap.reason}.`,
    'Generate a short commercial-style support clip only; keep product identity consistent and packaging-readable.'
  ].join(' ');
}

function buildNegativePrompt(storyboardFrame?: StoryboardFrame): string {
  return [
    storyboardFrame?.imagePrompt.negativePrompt,
    '不要声称已生成视频',
    '不要真实提交外部生成任务',
    '不要混入其他品牌',
    '不要医疗功效承诺',
    '不要名人肖像或真实人物身份仿冒',
    '不要照搬源片商品'
  ].filter(Boolean).join('，');
}

function clampDuration(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 4;
  return Math.min(15, Math.max(2, Number((value ?? 4).toFixed(1))));
}

function inferAspectRatio(storyboardFrames: StoryboardFrame[]): MissingMaterialGenerationJob['aspectRatio'] {
  return storyboardFrames.find((frame) => frame.imagePrompt.aspectRatio !== 'unknown')?.imagePrompt.aspectRatio ?? '9:16';
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}
