import type {
  ContentBrief,
  GapRepair,
  ScriptSegment,
  StoryboardShot,
  TimelineItem,
  ViralStructureGraph,
  SlotMatch
} from '@viral-struct/shared';

type GenerationVariant = 'high_click' | 'high_conversion' | 'premium';

export async function generateTimelineMock(input: {
  structureGraph: ViralStructureGraph;
  newContent: ContentBrief;
  matches: SlotMatch[];
  repairs: GapRepair[];
  variant?: GenerationVariant;
}): Promise<{
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
}> {
  const { structureGraph, newContent, matches, repairs } = input;
  const variant = input.variant ?? 'high_click';

  const lineByRole = buildLinesByRole(newContent, variant);

  const script: ScriptSegment[] = structureGraph.segments.map((seg) => ({
    segmentId: seg.id,
    role: seg.role,
    start: seg.start,
    end: seg.end,
    text: lineByRole[seg.role] ?? `${newContent.productName} 的卖点展示`,
    evidence: ['content_brief']
  }));

  const storyboard: StoryboardShot[] = structureGraph.shotSlots.map((slot, index) => {
    const seg = structureGraph.segments.find((s) => s.id === slot.segmentId)!;
    const match = matches.find((m) => m.slotId === slot.id);
    const repair = repairs.find((r) => r.slotId === slot.id);
    return {
      id: `story_${index + 1}`,
      start: seg.start,
      end: seg.end,
      visual: match?.status === 'matched'
        ? `使用素材 ${match.assetId} 表达 ${slot.role}`
        : `使用补全策略 ${repair?.strategy ?? 'caption_rewrite'} 表达 ${slot.role}`,
      narration: lineByRole[seg.role] ?? newContent.productName,
      packaging: repair?.strategy ?? 'selling_point_card'
    };
  });

  const timeline: TimelineItem[] = structureGraph.shotSlots.map((slot, index) => {
    const seg = structureGraph.segments.find((s) => s.id === slot.segmentId)!;
    const match = matches.find((m) => m.slotId === slot.id);
    const repair = repairs.find((r) => r.slotId === slot.id);
    const text = lineByRole[seg.role] ?? newContent.productName;

    return {
      id: `tl_${index + 1}`,
      start: seg.start,
      end: seg.end,
      segmentRole: seg.role,
      sourceSegmentId: seg.id,
      slotId: slot.id,
      assetId: match?.assetId,
      script: text,
      subtitles: splitSubtitle(text),
      visualAction: match?.status === 'matched'
        ? 'use_matched_asset'
        : `repair_with_${repair?.strategy ?? 'caption_rewrite'}`,
      packaging: {
        captionStyle: captionStyleForVariant(variant),
        cardType: cardTypeByRole(seg.role),
        transition: transitionForVariant(variant, index),
        motion: motionForVariant(variant, repair)
      },
      repair
    };
  });

  return { script, storyboard, timeline };
}

function buildLinesByRole(newContent: ContentBrief, variant: GenerationVariant): Record<string, string> {
  if (variant === 'premium') {
    return {
      hook: `${newContent.productName}，把${newContent.scenario}里的质感细节先立住。`,
      pain_point: `普通选择容易打断体验，也很难显得精致。`,
      selling_point: `${newContent.sellingPoints.slice(0, 2).join('，')}，用更克制的画面表达。`,
      comparison: `对比普通方案，它更适合追求稳定体验的${newContent.targetAudience}。`,
      cta: `${newContent.cta} 保持简洁、有质感的收束。`
    };
  }

  if (variant === 'high_conversion') {
    return {
      hook: `${newContent.productName}先给结论：${newContent.sellingPoints[0] ?? '核心卖点明确'}。`,
      pain_point: `普通选择不方便，还会影响${newContent.targetAudience}的真实使用体验。`,
      selling_point: `${newContent.productName}，${newContent.sellingPoints.join('，')}。`,
      comparison: `把普通方案和新方案直接对比，降低决策成本。`,
      cta: `立即行动：${newContent.cta}`
    };
  }

  return {
    hook: `3 秒看懂：${newContent.scenario}，你是不是也遇到过这个问题？`,
    pain_point: `普通选择不方便，还影响体验。`,
    selling_point: `${newContent.productName}，${newContent.sellingPoints.slice(0, 2).join('，')}。`,
    comparison: `对比普通方案，它更适合${newContent.targetAudience}。`,
    cta: newContent.cta
  };
}

function splitSubtitle(text: string): string[] {
  if (text.length <= 12) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 12) {
    chunks.push(text.slice(i, i + 12));
  }
  return chunks;
}

function cardTypeByRole(role: string): TimelineItem['packaging']['cardType'] {
  if (role === 'hook') return 'title_card';
  if (role === 'comparison') return 'comparison_card';
  if (role === 'cta') return 'cta_card';
  return 'selling_point_card';
}

function captionStyleForVariant(variant: GenerationVariant): string {
  if (variant === 'premium') return 'premium_center_light';
  if (variant === 'high_conversion') return 'conversion_large_bottom_bold';
  return 'click_large_bottom_bold';
}

function transitionForVariant(
  variant: GenerationVariant,
  index: number
): NonNullable<TimelineItem['packaging']['transition']> {
  if (variant === 'premium') return 'fade';
  if (variant === 'high_conversion') return index === 0 ? 'push' : 'quick_cut';
  return 'quick_cut';
}

function motionForVariant(
  variant: GenerationVariant,
  repair: GapRepair | undefined
): NonNullable<TimelineItem['packaging']['motion']> {
  if (repair?.strategy === 'crop_zoom') return 'crop_zoom';
  if (variant === 'premium') return 'push_in';
  if (variant === 'high_click') return 'push_in';
  return 'static';
}
