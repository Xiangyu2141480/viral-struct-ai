import type {
  ContentBrief,
  GapRepair,
  ScriptSegment,
  StoryboardShot,
  TimelineItem,
  ViralStructureGraph,
  SlotMatch
} from '@viral-struct/shared';

export async function generateTimelineMock(input: {
  structureGraph: ViralStructureGraph;
  newContent: ContentBrief;
  matches: SlotMatch[];
  repairs: GapRepair[];
}): Promise<{
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
}> {
  const { structureGraph, newContent, matches, repairs } = input;

  const lineByRole: Record<string, string> = {
    hook: `${newContent.scenario}，你是不是也遇到过这个问题？`,
    pain_point: `普通选择不方便，还影响体验。`,
    selling_point: `${newContent.productName}，${newContent.sellingPoints.slice(0, 2).join('，')}。`,
    comparison: `对比普通方案，它更适合${newContent.targetAudience}。`,
    cta: newContent.cta
  };

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
        captionStyle: 'large_bottom_bold',
        cardType: cardTypeByRole(seg.role),
        transition: index === 0 ? 'zoom_in' : 'quick_cut',
        motion: repair?.strategy === 'crop_zoom' ? 'crop_zoom' : 'static'
      },
      repair
    };
  });

  return { script, storyboard, timeline };
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
