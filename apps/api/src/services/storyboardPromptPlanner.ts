import type {
  AssetCard,
  ContentBrief,
  GapRepair,
  MaterialGap,
  SlotMatch,
  StoryboardFrame,
  StoryboardFrameType,
  StoryboardImagePrompt,
  TimelineItem,
  ViralStructureGraph
} from '@viral-struct/shared';
import { renderStoryboardPlaceholder } from './storyboardPlaceholderRenderer';
import { checkVisualPromptSafety } from './visualSafetyChecker';

export interface StoryboardPlanInput {
  timeline?: TimelineItem[];
  structureGraph?: ViralStructureGraph | null;
  contentBrief?: ContentBrief;
  assetCards?: AssetCard[];
  slotMatches?: SlotMatch[];
  materialGaps?: MaterialGap[];
  repairs?: GapRepair[];
}

export interface StoryboardPlanResult {
  frames: StoryboardFrame[];
  source: 'storyboard_prompt_planner';
  warnings: string[];
}

type FrameCandidate = {
  frameType: StoryboardFrameType;
  item: TimelineItem;
  rationale: string;
};

const defaultBrief: ContentBrief = {
  productName: 'New product',
  targetAudience: 'target audience',
  scenario: 'usage scenario',
  sellingPoints: ['main benefit'],
  cta: 'Clear next action'
};

export function planStoryboardFrames(input: StoryboardPlanInput): StoryboardPlanResult {
  const timeline = input.timeline ?? [];
  if (!timeline.length) {
    return {
      frames: [],
      source: 'storyboard_prompt_planner',
      warnings: ['Timeline is empty; storyboard prompt planner skipped.']
    };
  }

  const contentBrief = input.contentBrief ?? defaultBrief;
  const candidates = pickCandidates({
    timeline,
    structureGraph: input.structureGraph ?? null,
    materialGaps: input.materialGaps ?? [],
    repairs: input.repairs ?? []
  }).slice(0, 5);

  const frames = candidates.map((candidate, index) =>
    buildFrame({
      candidate,
      index,
      contentBrief,
      structureGraph: input.structureGraph ?? null,
      assetCards: input.assetCards ?? [],
      slotMatches: input.slotMatches ?? [],
      materialGaps: input.materialGaps ?? [],
      repairs: input.repairs ?? []
    })
  );

  return {
    frames,
    source: 'storyboard_prompt_planner',
    warnings: ['No image API is called; frames use prompt-ready placeholder SVGs.']
  };
}

function pickCandidates(input: {
  timeline: TimelineItem[];
  structureGraph: ViralStructureGraph | null;
  materialGaps: MaterialGap[];
  repairs: GapRepair[];
}): FrameCandidate[] {
  const result: FrameCandidate[] = [];

  addCandidate(result, 'opening_hook', findBy(input, (item, slot) =>
    item.segmentRole === 'hook' || slot?.role === 'opening_attention'
  ) ?? input.timeline[0], 'Prioritized because it anchors the first 3 seconds and hook transfer.');

  addCandidate(result, 'product_closeup', findBy(input, (item, slot) =>
    slot?.role === 'product_closeup' || item.segmentRole === 'selling_point' || /产品|瓶身|特写|product/i.test(`${item.script} ${item.visualAction}`)
  ), 'Prioritized to make the new product visually inspectable.');

  addCandidate(result, 'benefit_usage', findBy(input, (item, slot) =>
    item.segmentRole === 'usage' || item.segmentRole === 'selling_point' || slot?.role === 'usage_demo' || slot?.role === 'benefit_visual'
  ), 'Prioritized to translate the sample benefit/usage structure into the new brief.');

  addCandidate(result, 'gap_repair', findBy(input, (item) =>
    Boolean(item.repair) || input.materialGaps.some((gap) => gap.slotId === item.slotId) || input.repairs.some((repair) => repair.slotId === item.slotId)
  ), 'Prioritized because it exposes how missing material is repaired.');

  addCandidate(result, 'cta_cover', findBy(input, (item, slot) =>
    item.segmentRole === 'cta' || slot?.role === 'cta_visual'
  ) ?? input.timeline.at(-1), 'Prioritized to show final CTA or cover-ready frame.');

  if (result.length < 3) {
    for (const item of input.timeline) {
      addCandidate(result, inferFrameType(item, input.structureGraph), item, 'Added as fallback to reach a useful 3-frame storyboard draft.');
      if (result.length >= Math.min(3, input.timeline.length)) break;
    }
  }

  return result;
}

function addCandidate(
  result: FrameCandidate[],
  frameType: StoryboardFrameType,
  item: TimelineItem | undefined,
  rationale: string
): void {
  if (!item) return;
  if (result.some((candidate) => candidate.frameType === frameType)) return;
  result.push({ frameType, item, rationale });
}

function buildFrame(input: {
  candidate: FrameCandidate;
  index: number;
  contentBrief: ContentBrief;
  structureGraph: ViralStructureGraph | null;
  assetCards: AssetCard[];
  slotMatches: SlotMatch[];
  materialGaps: MaterialGap[];
  repairs: GapRepair[];
}): StoryboardFrame {
  const { candidate, index, contentBrief, structureGraph } = input;
  const item = candidate.item;
  const slot = structureGraph?.shotSlots.find((shotSlot) => shotSlot.id === item.slotId);
  const segment = structureGraph?.segments.find((sourceSegment) => sourceSegment.id === item.sourceSegmentId || sourceSegment.id === slot?.segmentId);
  const slotMatch = input.slotMatches.find((match) => match.slotId === item.slotId);
  const matchedAsset = input.assetCards.find((asset) => asset.id === (item.assetId ?? slotMatch?.assetId));
  const materialGap = input.materialGaps.find((gap) => gap.slotId === item.slotId);
  const repair = item.repair ?? input.repairs.find((entry) => entry.slotId === item.slotId);
  const acceptanceCriteria = acceptanceExamples(slot, item);
  const structureIntent = slot?.intent?.purpose ?? segment?.purpose ?? item.visualAction;
  const sourceInstance = sourceInstanceText(slot, segment);
  const title = frameTitle(candidate.frameType, contentBrief, item);
  const promptId = `prompt_${index + 1}_${candidate.frameType}`;
  const imagePrompt = buildPrompt({
    frameType: candidate.frameType,
    title,
    item,
    contentBrief,
    structureIntent,
    sourceInstance,
    acceptanceCriteria,
    matchedAsset,
    materialGap,
    repair,
    aspectRatio: structureGraph?.meta.aspectRatio ?? 'unknown',
    styleHints: styleHints(structureGraph, item, contentBrief)
  });
  const safetyStatus = checkVisualPromptSafety({
    positivePrompt: imagePrompt.positivePrompt,
    negativePrompt: imagePrompt.negativePrompt,
    contentBrief
  });
  const id = `storyboard_frame_${index + 1}_${candidate.frameType}_${safeId(item.id)}`;
  const generatedVisualAsset = renderStoryboardPlaceholder({
    id,
    promptId,
    frameType: candidate.frameType,
    productName: contentBrief.productName,
    title,
    summary: item.visualAction,
    safetyStatus
  });

  return {
    id,
    frameIndex: index,
    frameType: candidate.frameType,
    title,
    timelineItemId: item.id,
    slotId: item.slotId,
    structureIntent,
    sourceInstance,
    acceptanceCriteria,
    matchedAsset: matchedAsset ? compactAsset(matchedAsset) : undefined,
    slotMatch: slotMatch ? compactMatch(slotMatch) : undefined,
    materialGap: materialGap ? compactGap(materialGap) : undefined,
    repair,
    imagePrompt,
    generatedVisualAsset,
    safetyStatus,
    rationale: candidate.rationale
  };
}

function findBy(
  input: {
    timeline: TimelineItem[];
    structureGraph: ViralStructureGraph | null;
  },
  predicate: (item: TimelineItem, slot: ViralStructureGraph['shotSlots'][number] | undefined) => boolean
): TimelineItem | undefined {
  return input.timeline.find((item) => {
    const slot = input.structureGraph?.shotSlots.find((shotSlot) => shotSlot.id === item.slotId);
    return predicate(item, slot);
  });
}

function inferFrameType(item: TimelineItem, structureGraph: ViralStructureGraph | null): StoryboardFrameType {
  const slot = structureGraph?.shotSlots.find((shotSlot) => shotSlot.id === item.slotId);
  if (item.segmentRole === 'hook' || slot?.role === 'opening_attention') return 'opening_hook';
  if (slot?.role === 'product_closeup') return 'product_closeup';
  if (item.repair) return 'gap_repair';
  if (item.segmentRole === 'cta' || slot?.role === 'cta_visual') return 'cta_cover';
  return 'benefit_usage';
}

function frameTitle(frameType: StoryboardFrameType, contentBrief: ContentBrief, item: TimelineItem): string {
  const labels: Record<StoryboardFrameType, string> = {
    opening_hook: '开场抓停分镜',
    product_closeup: '产品特写分镜',
    benefit_usage: '卖点/场景分镜',
    gap_repair: '缺口补全分镜',
    cta_cover: 'CTA / 封面分镜'
  };
  return `${labels[frameType]} · ${contentBrief.productName} · ${truncate(item.script, 28)}`;
}

function buildPrompt(input: {
  frameType: StoryboardFrameType;
  title: string;
  item: TimelineItem;
  contentBrief: ContentBrief;
  structureIntent: string;
  sourceInstance: string;
  acceptanceCriteria: string[];
  matchedAsset?: AssetCard;
  materialGap?: MaterialGap;
  repair?: GapRepair;
  aspectRatio: StoryboardImagePrompt['aspectRatio'];
  styleHints: string[];
}): StoryboardImagePrompt {
  const sellingPoints = input.contentBrief.sellingPoints.slice(0, 3).join('、');
  const assetDescription = input.matchedAsset
    ? firstNonEmpty([
      input.matchedAsset.spatialDescription,
      input.matchedAsset.temporalDescription,
      input.matchedAsset.detectedObjects.join(', '),
      input.matchedAsset.id
    ])
    : '';
  const assetHint = input.matchedAsset
    ? `Matched asset: ${assetDescription}.`
    : 'Matched asset: Not available; rely on layout and packaging draft.';
  const repairHint = input.repair
    ? `Repair strategy: ${input.repair.strategy}; ${input.repair.explanation}.`
    : input.materialGap
      ? `Material gap: ${input.materialGap.reason}; show a prompt-only draft for repair planning.`
      : 'No repair required.';

  return {
    positivePrompt: [
      `Prompt-ready commercial storyboard still for ${input.contentBrief.productName}.`,
      `Frame type: ${input.frameType}.`,
      `New content mapping: ${input.contentBrief.scenario}; selling points: ${sellingPoints}.`,
      `Visual action: ${input.item.visualAction}.`,
      `Script line: ${input.item.script}.`,
      `Source structure intent to transfer: ${input.structureIntent}.`,
      `Source instance abstraction: ${input.sourceInstance}.`,
      `Acceptance criteria: ${input.acceptanceCriteria.join(' / ')}.`,
      assetHint,
      repairHint,
      `Packaging: ${input.item.packaging.cardType ?? 'none'}, ${input.item.packaging.transition ?? 'none'}, ${input.item.packaging.motion ?? 'none'}.`,
      'Use clean product advertising composition, crisp lighting, readable but not text-heavy layout, storyboard draft only.'
    ].join(' '),
    negativePrompt: [
      '不要照搬源片商品',
      '不要混入其他品牌',
      '不要医疗功效承诺',
      '不要夸张前后对比',
      '不要名人肖像或真实人物身份仿冒',
      '不要错误商标或密集错字',
      '不要暗示这已经是真实生成图片'
    ].join('，'),
    aspectRatio: input.aspectRatio,
    styleHints: input.styleHints,
    promptSource: 'storyboard_prompt_planner'
  };
}

function acceptanceExamples(slot: ViralStructureGraph['shotSlots'][number] | undefined, item: TimelineItem): string[] {
  const examples = slot?.acceptanceCriteria?.anyOf.flatMap((criterion) => [
    ...criterion.examples,
    criterion.motionType,
    criterion.compositionType
  ].filter((value): value is string => Boolean(value))) ?? [];
  const fallback = [
    slot?.requiredAsset.subject,
    item.visualAction,
    item.packaging.motion ? `motion:${item.packaging.motion}` : undefined,
    item.packaging.transition ? `transition:${item.packaging.transition}` : undefined
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set([...examples, ...fallback])).slice(0, 5);
}

function sourceInstanceText(
  slot: ViralStructureGraph['shotSlots'][number] | undefined,
  segment: ViralStructureGraph['segments'][number] | undefined
): string {
  if (slot?.sourceInstance) {
    return [
      slot.sourceInstance.productInSource,
      slot.sourceInstance.specificAction,
      slot.sourceInstance.colorSignature
    ].filter(Boolean).join(' · ');
  }

  return segment?.transferRule ?? 'Not available';
}

function styleHints(
  structureGraph: ViralStructureGraph | null,
  item: TimelineItem,
  contentBrief: ContentBrief
): string[] {
  return [
    contentBrief.stylePreference,
    structureGraph?.packaging.titleStyle,
    structureGraph?.packaging.coverStyle,
    item.packaging.captionStyle,
    item.packaging.cardType,
    item.packaging.motion
  ].filter((value): value is string => Boolean(value));
}

function compactAsset(asset: AssetCard): StoryboardFrame['matchedAsset'] {
  return {
    id: asset.id,
    type: asset.type,
    url: asset.url,
    text: asset.text,
    spatialDescription: asset.spatialDescription,
    temporalDescription: asset.temporalDescription,
    qualityScore: asset.qualityScore
  };
}

function compactMatch(match: SlotMatch): StoryboardFrame['slotMatch'] {
  return {
    slotId: match.slotId,
    assetId: match.assetId,
    score: match.score,
    status: match.status,
    reason: match.reason,
    alignmentSource: match.alignmentSource
  };
}

function compactGap(gap: MaterialGap): StoryboardFrame['materialGap'] {
  return {
    slotId: gap.slotId,
    role: gap.role,
    type: gap.type,
    severity: gap.severity,
    reason: gap.reason,
    impact: gap.impact,
    gapSpecSource: gap.gapSpecSource
  };
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}

function firstNonEmpty(values: Array<string | undefined>): string {
  return values.find((value) => Boolean(value?.trim())) ?? 'Not available';
}
