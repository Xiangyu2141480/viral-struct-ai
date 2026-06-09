import { z } from 'zod';
import type {
  AssetCard,
  Boundary,
  ContentBrief,
  GapRepair,
  ScriptSegment,
  SegmentNode,
  SlotTreatmentSpec,
  StoryboardShot,
  TimelineItem,
  ViralStructureGraph,
  SlotMatch
} from '@viral-struct/shared';
import { createOpenAICompatibleClient } from './llmProvider';

type GenerationVariant = 'high_click' | 'high_conversion' | 'premium';

export async function generateTimelineMock(input: {
  structureGraph: ViralStructureGraph;
  newContent: ContentBrief;
  matches: SlotMatch[];
  repairs: GapRepair[];
  variant?: GenerationVariant;
  boundaries?: Boundary[];
}): Promise<{
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
}> {
  const { structureGraph, newContent, matches, repairs, boundaries } = input;
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
      subtitles: splitSubtitle(text, variant),
      visualAction: visualActionForVariant(variant, match, repair),
      packaging: {
        captionStyle: captionStyleForVariant(variant),
        cardType: cardTypeByRole(seg.role, variant),
        transition: transitionFromBoundary(seg.id, boundaries)
          ?? transitionForVariant(variant, index),
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

function splitSubtitle(text: string, variant: GenerationVariant): string[] {
  const maxChars = variant === 'premium' ? 18 : variant === 'high_click' ? 8 : 12;
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    chunks.push(text.slice(i, i + maxChars));
  }
  return chunks;
}

function cardTypeByRole(role: string, variant: GenerationVariant): TimelineItem['packaging']['cardType'] {
  if (role === 'hook') return 'title_card';
  if (role === 'comparison') return 'comparison_card';
  if (role === 'cta') return 'cta_card';
  if (variant === 'premium') return undefined;
  return 'selling_point_card';
}

function visualActionForVariant(
  variant: GenerationVariant,
  match: SlotMatch | undefined,
  repair: GapRepair | undefined
): string {
  const base = match?.status === 'matched'
    ? `使用匹配素材 ${match.assetId ?? 'asset'}`
    : `使用补全策略 ${repair?.strategy ?? 'caption_rewrite'}`;

  if (variant === 'high_click') {
    return `${base}，快节奏推近，前 3 秒强化冲突和停留。`;
  }
  if (variant === 'high_conversion') {
    return `${base}，商品和核心卖点提前，画面服务购买理由。`;
  }
  return `${base}，克制推近和留白构图，弱化强字幕干扰。`;
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

function transitionFromBoundary(
  segmentId: string,
  boundaries: Boundary[] | undefined
): NonNullable<TimelineItem['packaging']['transition']> | null {
  if (!boundaries?.length) return null;
  // Find the boundary whose 'from' is this segment (i.e., this segment ENDS at the boundary).
  const b = boundaries.find((x) => x.from === segmentId);
  if (!b) return null;
  return mapBoundaryTypeToPackagingTransition(b.transitionType);
}

function mapBoundaryTypeToPackagingTransition(
  type: Boundary['transitionType']
): NonNullable<TimelineItem['packaging']['transition']> {
  switch (type) {
    case 'fade':
    case 'dissolve':
      return 'fade';
    case 'morph':
    case 'wipe':
      return 'push';
    case 'cut':
    default:
      return 'quick_cut';
  }
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

// ---------------------------------------------------------------------------
// LLM script generator — per-segment call.
// source-of-truth prompt at prompts/migration/script_generation_v0.md
// ---------------------------------------------------------------------------

const SCRIPT_SYSTEM_PROMPT = `你是一个短视频脚本与分镜的资深创作者。

你将看到一个 segment 内部的全部 timelineItem（1-3 条），每条 item 已经被对齐到具体素材或补全策略，并附带：
- segment.intent：这一段要达成什么意图（可迁移层面）
- segment.role：这一段的叙事角色
- 该 item 对齐到的素材的 visualContent / motionPotential（如果有）
- 该 item 的 treatmentSpec（已经决定好怎么处理素材）
- 该 item 上下文的转场约束（borderTransition）
- ContentBrief：产品名、目标人群、场景、卖点、CTA
- 风格变体：high_click / high_conversion / premium

创作原则：
1. 必须利用素材的真实视觉细节（splash → "冰爆"，hand_demo → "手部入画"）。
2. 必须利用 treatmentSpec.captionOverlay 作为字幕主线索（如有）。
3. 段内连贯：3 条 item 的脚本要能串成一段流畅叙事，不要每句都重复产品名。
4. 不同 variant 真不同：high_click 钩子前置、节奏快；high_conversion 先结论后理由、强 CTA；premium 克制、留白多。
5. subtitles 按语义切，每行 6-14 字，不要把短语劈成两半。
6. 不要写"3 秒看懂"、"你是不是也遇到过"这类俗套模板。
7. 只输出 JSON，不要 Markdown，不要解释。`;

const ScriptItemResponseSchema = z.object({
  itemId: z.string(),
  script: z.string().min(1),
  visualAction: z.string().min(1),
  captionStyle: z.string().min(1),
  cardType: z.union([
    z.enum(['title_card', 'selling_point_card', 'comparison_card', 'cta_card']),
    z.null()
  ]).optional(),
  subtitles: z.array(z.string().min(1)).min(1)
});

const ScriptSegmentResponseSchema = z.object({
  items: z.array(ScriptItemResponseSchema).min(1)
});

interface SegmentSkeleton {
  segment: SegmentNode;
  items: SkeletonItem[];
  borderTransition?: Boundary;
}

interface SkeletonItem {
  itemId: string;
  slotId: string;
  match?: SlotMatch;
  repair?: GapRepair;
  matchedAsset?: AssetCard;
  treatmentSpec?: SlotTreatmentSpec;
  start: number;
  end: number;
}

function buildSegmentSkeleton(
  graph: ViralStructureGraph,
  matches: SlotMatch[],
  repairs: GapRepair[],
  assets: AssetCard[],
  boundaries: Boundary[] | undefined
): SegmentSkeleton[] {
  const assetIndex = new Map(assets.map((a) => [a.id, a]));
  const matchIndex = new Map(matches.map((m) => [m.slotId, m]));
  const repairIndex = new Map(repairs.map((r) => [r.slotId, r]));

  return graph.segments.map((segment) => {
    const slotsInSeg = graph.shotSlots.filter((s) => s.segmentId === segment.id);
    const items: SkeletonItem[] = slotsInSeg.map((slot, index) => {
      const match = matchIndex.get(slot.id);
      const repair = repairIndex.get(slot.id);
      const matchedAsset = match?.assetId ? assetIndex.get(match.assetId) : undefined;
      return {
        itemId: `tl_${segment.id}_${index + 1}`,
        slotId: slot.id,
        match,
        repair,
        matchedAsset,
        treatmentSpec: match?.treatmentSpec,
        start: segment.start,
        end: segment.end
      };
    });
    const borderTransition = boundaries?.find((b) => b.from === segment.id);
    return { segment, items, borderTransition };
  });
}

function buildScriptUserPrompt(
  variant: GenerationVariant,
  brief: ContentBrief,
  skeleton: SegmentSkeleton
): string {
  const itemsForPrompt = skeleton.items.map((item) => ({
    itemId: item.itemId,
    slotId: item.slotId,
    assetId: item.matchedAsset?.id ?? null,
    matchedAsset: item.matchedAsset
      ? {
          primarySubject: item.matchedAsset.visualContent?.primarySubject,
          kinematicElements: item.matchedAsset.visualContent?.kinematicElements,
          implicitMotion: item.matchedAsset.motionPotential?.implicitMotion
        }
      : null,
    treatmentSpec: item.treatmentSpec ?? null,
    repairStrategy: item.repair?.strategy ?? null
  }));

  return `风格变体：${variant}

ContentBrief:
${JSON.stringify(brief, null, 2)}

Segment 上下文：
${JSON.stringify({
    segmentId: skeleton.segment.id,
    role: skeleton.segment.role,
    purpose: skeleton.segment.purpose,
    transferRule: skeleton.segment.transferRule,
    importance: skeleton.segment.importance
  }, null, 2)}

本段的 timelineItem 清单（已对齐）：
${JSON.stringify(itemsForPrompt, null, 2)}

转场约束（仅供参考）：
${JSON.stringify(skeleton.borderTransition ?? null, null, 2)}

请输出 JSON：

{
  "items": [
    {
      "itemId": "<对应 timelineItem 的 id>",
      "script": "≤40 字单句。",
      "visualAction": "≤30 字中文。",
      "captionStyle": "click_large_bottom_bold | premium_minimal_top | conversion_bold_red | clean_subtitle_only",
      "cardType": "title_card | selling_point_card | comparison_card | cta_card | null",
      "subtitles": ["按语义切的字幕行"]
    }
  ]
}

约束：
- items 长度必须等于输入清单长度；
- itemId 必须严格对应输入；
- script 不超过 40 字；subtitles 每行 6-14 字；
- captionStyle 必须从枚举中选。

只输出 JSON 本体。`;
}

function stripFenceTimeline(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  }
  return trimmed;
}

type Client = ReturnType<typeof createOpenAICompatibleClient>;

export interface GenerateTimelineLLMOptions {
  structureGraph: ViralStructureGraph;
  newContent: ContentBrief;
  matches: SlotMatch[];
  repairs: GapRepair[];
  assets: AssetCard[];
  variant?: GenerationVariant;
  boundaries?: Boundary[];
  clientFactory?: () => Client;
  model?: string;
}

export async function generateTimelineLLM(opts: GenerateTimelineLLMOptions): Promise<{
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
}> {
  const { structureGraph, newContent, matches, repairs, assets, boundaries, clientFactory, model } = opts;
  const variant = opts.variant ?? 'high_click';

  const client = (clientFactory ?? createOpenAICompatibleClient)();
  const modelId = model ?? process.env.LLM_MODEL;
  if (!modelId) {
    throw new Error('LLM_MODEL is required for generateTimelineLLM.');
  }

  const skeletons = buildSegmentSkeleton(structureGraph, matches, repairs, assets, boundaries);

  const script: ScriptSegment[] = [];
  const storyboard: StoryboardShot[] = [];
  const timeline: TimelineItem[] = [];
  let storyIdx = 0;
  let tlIdx = 0;

  for (const skel of skeletons) {
    const response = await client.chat.completions.create({
      model: modelId,
      messages: [
        { role: 'system', content: SCRIPT_SYSTEM_PROMPT },
        { role: 'user', content: buildScriptUserPrompt(variant, newContent, skel) }
      ],
      temperature: 0.5,
      // no response_format: this Ark/Doubao endpoint 400s on json_object; prompt + JSON parser handle it.
    });
    const raw = response.choices[0]?.message?.content ?? '';
    const parsed = JSON.parse(stripFenceTimeline(raw));
    const validated = ScriptSegmentResponseSchema.parse(parsed);

    if (validated.items.length !== skel.items.length) {
      throw new Error(
        `Segment ${skel.segment.id}: LLM returned ${validated.items.length} items, expected ${skel.items.length}`
      );
    }

    const byItemId = new Map(validated.items.map((i) => [i.itemId, i]));

    // Segment-level aggregate script line (first item's text — segment summary)
    const firstResp = byItemId.get(skel.items[0].itemId);
    script.push({
      segmentId: skel.segment.id,
      role: skel.segment.role,
      start: skel.segment.start,
      end: skel.segment.end,
      text: firstResp?.script ?? '',
      evidence: ['llm_script_generation']
    });

    for (const item of skel.items) {
      const resp = byItemId.get(item.itemId);
      if (!resp) {
        throw new Error(`Segment ${skel.segment.id}: missing item ${item.itemId} in LLM response`);
      }

      storyIdx += 1;
      storyboard.push({
        id: `story_${storyIdx}`,
        start: item.start,
        end: item.end,
        visual: resp.visualAction,
        narration: resp.script,
        packaging: item.repair?.strategy ?? 'selling_point_card'
      });

      tlIdx += 1;
      const transition = transitionFromBoundary(skel.segment.id, boundaries) ?? transitionForVariant(variant, tlIdx - 1);
      const treatmentMotion = item.treatmentSpec?.motion;
      timeline.push({
        id: `tl_${tlIdx}`,
        start: item.start,
        end: item.end,
        segmentRole: skel.segment.role,
        sourceSegmentId: skel.segment.id,
        slotId: item.slotId,
        assetId: item.matchedAsset?.id,
        script: resp.script,
        subtitles: resp.subtitles,
        visualAction: treatmentMotion
          ? `${resp.visualAction}（处理：${treatmentMotion}）`
          : resp.visualAction,
        packaging: {
          captionStyle: resp.captionStyle,
          cardType: resp.cardType ?? undefined,
          transition,
          motion: motionForVariant(variant, item.repair)
        },
        repair: item.repair,
        scriptSource: 'llm_generated',
        treatmentSpec: item.treatmentSpec
      });
    }
  }

  return { script, storyboard, timeline };
}

export type GenerateTimelineResultWithSource = {
  script: ScriptSegment[];
  storyboard: StoryboardShot[];
  timeline: TimelineItem[];
  scriptSource: 'llm_generated' | 'template';
  warning?: string;
};

export async function generateTimelineWithFallback(opts: GenerateTimelineLLMOptions): Promise<GenerateTimelineResultWithSource> {
  try {
    const result = await generateTimelineLLM(opts);
    return { ...result, scriptSource: 'llm_generated' };
  } catch (err) {
    const fallback = await generateTimelineMock({
      structureGraph: opts.structureGraph,
      newContent: opts.newContent,
      matches: opts.matches,
      repairs: opts.repairs,
      variant: opts.variant,
      boundaries: opts.boundaries
    });
    return {
      ...fallback,
      timeline: fallback.timeline.map((t) => ({ ...t, scriptSource: 'template' as const })),
      scriptSource: 'template',
      warning: `LLM script generation failed (${err instanceof Error ? err.message : String(err)}); using template fallback.`
    };
  }
}
