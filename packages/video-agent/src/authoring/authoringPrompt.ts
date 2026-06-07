import type { VideoEditContext } from '../context/VideoEditContext';
import { buildGapReports } from '../gap-fill/gapFillPlanner';

/**
 * Builds the Director/Screenwriter authoring prompt. The system message teaches UNDERSTANDING + RE-INVENTION
 * (read why the sample works, then author a NEW approach for the new product) — explicitly NOT template fill.
 * The user message carries a compacted graph + the new product's assets/matches/gaps/brief. The LLM returns an
 * AuthoredTimeline JSON (validated + repaired by the canonicalizer afterward).
 */
export function buildAuthoringPrompt(context: VideoEditContext): { system: string; user: string } {
  const gapReports = buildGapReports(context);
  const system = [
    '你是短视频广告的导演兼编剧（创意创作者），不是模板填空器。',
    '你的任务：阅读一个【已验证成功的样例广告的深层结构】，理解它「为什么有效」，然后用【新产品的真实素材】为新产品创作一条结构相似但内容全新的广告。',
    '',
    '核心要求：',
    '1) 先理解再创作：从样例的 hook 机制、情绪曲线、节奏(rhythm)、转场语法、creativeIngredients 中提炼"为什么有效"，',
    '   再为新产品【重新发明】钩子、文案、卖点呈现——不要逐字照搬样例的台词/caption，不要照抄样例的运镜预设。',
    '   每个 segment 带有 transferRule，它是把该段意图迁移到新产品的【约束】，请遵守它。',
    '2) 只用真实素材承载事实：每个 mediaLayer 必须引用一个真实 AssetCard（media.assetId = 资产 id）。',
    '   若某个槽位没有合适的真实素材，不要编造——把该 beat 标记 unresolvedReason（系统会渲染为「替代卡片 · 素材缺失」）。',
    '3) 诚实红线：proof / 对比 等需要真实证据的段落，禁止用 AIGC 图生视频伪造；AIGC(image_to_video) 只能用于',
    '   非证据性的氛围/运动镜头，且必须带 disclosureText（如「【AI 生成动画】」）。绝不虚构评价、数据、效果。',
    '4) 创意在调色板内：motion.kind 只能从 {static,ken_burns,crop_zoom,pan,push_in,pop_scale,custom} 选，',
    '   文字 stylePreset 从 {bold_pop_center,clean_lower_third,karaoke_highlight,minimal_serif,sticker_outline,custom} 选——',
    '   在这些原语里自由组合编排，为每个 beat 选最合适的，而不是全部复用同一套。',
    '5) 输出：只输出合法的 AuthoredTimeline JSON（schemaVersion "1.0"），不要任何解释或 Markdown 代码围栏。',
    '   每个 beat 一个 segment：segmentRole / startSeconds / endSeconds / mediaLayers[] / textElements[] /',
    '   transitionOut / paletteHint，证据缺失时加 unresolvedReason。'
  ].join('\n');

  const user = [
    '【样例广告结构（理解"为什么有效"，不要复制内容）】',
    JSON.stringify(compactGraph(context), null, 0),
    '',
    '【新产品简介 ContentBrief】',
    JSON.stringify(context.contentBrief, null, 0),
    '',
    '【新产品素材库 AssetCard[]（media.assetId 必须引用这里的 id）】',
    JSON.stringify(context.assetCards.map(compactAsset), null, 0),
    '',
    '【槽位匹配 SlotMatch[]（status=matched 的可直接用其 assetId；partial/missing 走缺口处理）】',
    JSON.stringify(context.slotMatches, null, 0),
    '',
    '【缺口报告 GapReport[]（requiresRealProof=true 的槽位若无真实素材，必须标 unresolvedReason，禁止 AIGC）】',
    JSON.stringify(gapReports.map((g) => ({ slotId: g.slotId, segmentId: g.segmentId, requiresRealProof: g.requiresRealProof, evidenceType: g.evidenceType, whyUnmatched: g.whyUnmatched })), null, 0),
    '',
    '思考引导（无需作答，仅辅助）：样例的钩子靠什么瞬间抓人？新产品用什么不同的视觉/反差达到同样效果？',
    '样例的节奏(rhythm.pattern, cutFrequency)说明了什么？新素材应保持/加快/放慢？哪些卖点能用真实素材证明，哪些只能诚实留白？',
    '',
    '现在输出新产品的 AuthoredTimeline JSON：'
  ].join('\n');

  return { system, user };
}

function compactGraph(context: VideoEditContext): unknown {
  const g = context.structureGraph;
  return {
    meta: g.meta,
    structureSummary: g.structureSummary,
    rhythm: g.rhythm,
    packaging: g.packaging,
    creativeIngredients: (g.creativeIngredients ?? []).map((c) => ({ type: c.type, name: c.name, description: c.description })),
    boundaries: (g.boundaries ?? []).map((b) => ({ from: b.from, to: b.to, transitionType: b.transitionType, intensity: b.intensity })),
    segments: g.segments.map((s) => ({
      id: s.id,
      role: s.role,
      start: s.start,
      end: s.end,
      duration: s.duration,
      purpose: s.purpose,
      transferRule: s.transferRule,
      importance: s.importance,
      slots: g.shotSlots
        .filter((slot) => slot.segmentId === s.id)
        .map((slot) => ({ id: slot.id, role: slot.role, subject: slot.requiredAsset?.subject, intent: slot.intent?.purpose, importance: slot.importance }))
    }))
  };
}

function compactAsset(a: VideoEditContext['assetCards'][number]): unknown {
  return {
    id: a.id,
    type: a.type,
    suitableSlots: a.suitableSlots,
    qualityScore: a.qualityScore,
    detectedObjects: a.detectedObjects,
    primarySubject: a.visualContent?.primarySubject,
    motion: a.motionPotential?.implicitMotion,
    candidateSlotRoles: a.candidateSlotRoles
  };
}
