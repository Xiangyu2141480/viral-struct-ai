import type {
  ContentBrief,
  GapRepair,
  MaterialGap,
  MissingMaterialPromptMetadata,
  StoryboardFrame,
  TimelineItem
} from '@viral-struct/shared';

export interface CompactMissingMaterialPromptInput {
  rawPositivePrompt: string;
  shotSpec: string;
  negativePrompt: string;
  gap: MaterialGap;
  repair?: GapRepair;
  timelineItem?: TimelineItem;
  storyboardFrame?: StoryboardFrame;
  contentBrief: ContentBrief;
  aspectRatio: '9:16' | '16:9' | '1:1' | 'unknown';
  targetMaxCharacters?: number;
}

export interface CompactMissingMaterialPromptResult {
  positivePrompt: string;
  negativePrompt: string;
  metadata: MissingMaterialPromptMetadata;
}

const DEFAULT_MAX_CHARACTERS = 500;

export function compactMissingMaterialPrompt(
  input: CompactMissingMaterialPromptInput
): CompactMissingMaterialPromptResult {
  const targetMaxCharacters = Math.max(260, Math.min(input.targetMaxCharacters ?? DEFAULT_MAX_CHARACTERS, 700));
  const visualGoal = pickVisualGoal(input);
  const sellingPoints = input.contentBrief.sellingPoints.slice(0, 3).join(', ');
  const storyboardHint = input.storyboardFrame
    ? `Use storyboard reference: ${appendSentence(stripEvidenceMarkers(input.storyboardFrame.title || input.storyboardFrame.frameType))}`
    : undefined;
  const motion = input.timelineItem?.visualAction && !looksLikeRepairMeta(input.timelineItem.visualAction)
    ? `Motion: ${appendSentence(stripEvidenceMarkers(input.timelineItem.visualAction))}`
    : undefined;

  const compactPrompt = truncateAtSentenceBoundary(compactWhitespace([
    `${input.aspectRatio} short commercial support clip for ${input.contentBrief.productName}.`,
    `Shot goal: ${appendSentence(visualGoal)}`,
    `Scene: ${appendSentence(input.contentBrief.scenario)}`,
    sellingPoints ? `Benefits to express: ${appendSentence(sellingPoints)}` : undefined,
    motion,
    storyboardHint,
    'Keep product packaging readable, clean lighting, natural motion, no other brands, no celebrity likeness, no medical or absolute claims.'
  ].filter(Boolean).join(' ')), targetMaxCharacters);

  const compactNegativePrompt = compactNegative(input.negativePrompt);
  const warnings: string[] = [];
  if (input.rawPositivePrompt.length > compactPrompt.length) {
    warnings.push('positivePrompt compacted for external image/video generation; detailed evidence remains in shotSpec.');
  }
  if (compactPrompt.length >= targetMaxCharacters) {
    warnings.push(`positivePrompt truncated to ${targetMaxCharacters} characters.`);
  }

  return {
    positivePrompt: compactPrompt,
    negativePrompt: compactNegativePrompt,
    metadata: {
      source: 'prompt_compactor',
      originalPositivePromptLength: input.rawPositivePrompt.length,
      compactPositivePromptLength: compactPrompt.length,
      targetMaxCharacters,
      shotSpecPreserved: input.shotSpec.trim().length > 0,
      warnings
    }
  };
}

function pickVisualGoal(input: CompactMissingMaterialPromptInput): string {
  const repairSpec = input.repair?.gapSpec ?? input.gap.gapSpec;
  return stripEvidenceMarkers(
    repairSpec?.ideal
    ?? repairSpec?.minimalAcceptable
    ?? input.repair?.generatedAssetHint
    ?? defaultGoalForGap(input.gap)
    ?? input.gap.reason
    ?? 'Create a missing support shot for the migrated structure.'
  );
}

function defaultGoalForGap(gap: MaterialGap): string {
  switch (gap.type) {
    case 'missing_opening_visual':
      return 'Bold opening hook: chilled bottle push-in, summer refresh energy, clean title space, product label visible';
    case 'missing_product_closeup':
      return 'Readable product-label close-up with condensation, centered bottle, clean background, premium lighting';
    case 'missing_usage_demo':
      return 'Natural hand-use shot: hold, open, pour, or use the product while keeping the label visible';
    case 'missing_scene_style':
      return 'Clean summer product beauty shot matching the source rhythm, with fresh ice-tea color and readable packaging';
    case 'missing_human_host':
      return 'Hands-only lifestyle demo shot with no identifiable face, product centered, simple CTA-friendly background';
    case 'missing_comparison':
      return 'Simple side-by-side comparison setup using neutral props and clear product visibility, no exaggerated claims';
    case 'missing_cta_visual':
      return 'Clean final CTA product shot with bottle centered, readable label, and negative space for call-to-action text';
    default:
      return 'Commercial support shot for the missing structure slot, product-centered and packaging-readable';
  }
}

function stripEvidenceMarkers(value: string): string {
  return value
    .replace(/External missing-material video generation plan[^.。]*[.。]?/gi, '')
    .replace(/Storyboard image reference prompt:/gi, '')
    .replace(/Source structure intent to transfer:[\s\S]*$/gi, '')
    .replace(/Matched asset:[\s\S]*$/gi, '')
    .replace(/Repair strategy:/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeRepairMeta(value: string): boolean {
  return /补全策略|repair strategy|caption_rewrite|text_card|crop_zoom|style_filter|ask_user/i.test(value);
}

function appendSentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.。!?！？]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function compactNegative(value: string): string {
  const parts = value
    .split(/[，,]/)
    .map((part) => compactWhitespace(part))
    .filter(Boolean);
  return Array.from(new Set(parts)).join('，');
}

function truncateAtSentenceBoundary(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;
  const clipped = value.slice(0, maxCharacters);
  const boundary = Math.max(
    clipped.lastIndexOf('. '),
    clipped.lastIndexOf('。'),
    clipped.lastIndexOf('; ')
  );
  if (boundary >= Math.floor(maxCharacters * 0.65)) {
    return clipped.slice(0, boundary + 1).trim();
  }
  return `${clipped.replace(/\s+\S*$/, '').trim()}.`;
}

function compactWhitespace(value: string): string {
  return value
    .replace(/\.{2,}/g, '.')
    .replace(/。+\./g, '。')
    .replace(/\s+/g, ' ')
    .trim();
}
