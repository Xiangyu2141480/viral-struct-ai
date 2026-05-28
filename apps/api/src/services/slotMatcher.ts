import { z } from 'zod';
import type {
  AssetCard,
  Boundary,
  CreativeIngredientType,
  MaterialGap,
  MaterialGapType,
  SlotMatch,
  ViralStructureGraph
} from '@viral-struct/shared';
import { createOpenAICompatibleClient } from './llmProvider';

export function matchSlots(
  graph: ViralStructureGraph,
  assets: AssetCard[],
  boundaries?: Boundary[]
): { matches: SlotMatch[]; gaps: MaterialGap[] } {
  const matches: SlotMatch[] = graph.shotSlots.map((slot) => {
    const ranked = assets
      .map((asset) => {
        const semanticMatch = asset.suitableSlots.includes(slot.role) ? 0.35 : 0;
        const typeMatch =
          slot.requiredAsset.type === 'generated'
            ? 0.12
            : asset.type === slot.requiredAsset.type
              ? 0.2
              : 0;
        const ingredientMatchScore = getIngredientMatchScore(
          slot.visualIngredientRequirements,
          asset.detectedIngredients
        );
        const motionMatch = getMotionMatch(slot.requiredAsset.motion, asset);
        const quality = asset.qualityScore * 0.1;
        const score =
          semanticMatch + typeMatch + ingredientMatchScore * 0.2 + motionMatch + quality
          + boundaryBonus(slot.segmentId, boundaries);
        return {
          asset,
          score,
          ingredientMatchScore,
          missingIngredients: getMissingIngredients(
            slot.visualIngredientRequirements,
            asset.detectedIngredients
          )
        };
      })
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    const humanBlocked = best ? violatesHumanRequirement(slot, best.asset) : false;
    const score = best?.score ?? 0;

    if (score >= 0.75 && !humanBlocked && (best.missingIngredients.length === 0 || best.ingredientMatchScore >= 0.75)) {
      return {
        slotId: slot.id,
        assetId: best.asset.id,
        score,
        ingredientMatchScore: best.ingredientMatchScore,
        missingIngredients: sanitizeMissingIngredients(best.missingIngredients),
        status: 'matched',
        reason: '素材类型、槽位语义、关键创作要素和质量均满足。'
      };
    }

    if (score >= 0.45) {
      return {
        slotId: slot.id,
        assetId: best.asset.id,
        score,
        ingredientMatchScore: best.ingredientMatchScore,
        missingIngredients: sanitizeMissingIngredients(best.missingIngredients),
        status: 'partial',
        reason: humanBlocked
          ? '槽位需要授权演示或指定动作，但当前素材缺少对应动作要素，最多只能部分满足。'
          : '素材语义部分满足，但类型、动作、时长或创作要素不足，需要补全。'
      };
    }

    return {
      slotId: slot.id,
      score,
      ingredientMatchScore: best?.ingredientMatchScore ?? 0,
      missingIngredients: sanitizeMissingIngredients(best?.missingIngredients ?? slot.visualIngredientRequirements ?? []),
      status: 'missing',
      reason: '没有找到能支撑该结构槽位的素材。'
    };
  });

  const gaps: MaterialGap[] = matches
    .filter((match) => match.status !== 'matched')
    .map((match) => {
      const slot = graph.shotSlots.find((s) => s.id === match.slotId)!;
      const rawMissingIngredients = match.missingIngredients ?? slot.visualIngredientRequirements ?? [];
      const missingIngredients = sanitizeMissingIngredients(rawMissingIngredients);
      return {
        slotId: slot.id,
        role: slot.role,
        type: getGapType(slot.role, rawMissingIngredients),
        severity: match.status === 'missing' ? 'high' : 'medium',
        reason: getGapReason(match.reason, missingIngredients),
        impact: `该缺口会影响 ${slot.segmentId} 段落的画面表达，需要使用 ${slot.fallbackStrategies.join(' / ')} 补足。`,
        affectedSegmentId: slot.segmentId,
        missingIngredients
      };
    });

  return { matches, gaps };
}

function getIngredientMatchScore(
  requiredIngredients: CreativeIngredientType[] | undefined,
  detectedIngredients: CreativeIngredientType[] | undefined
): number {
  if (!requiredIngredients || requiredIngredients.length === 0) return 1;
  if (!detectedIngredients || detectedIngredients.length === 0) return 0;
  const matchedCount = requiredIngredients.filter((ingredient) =>
    detectedIngredients.includes(ingredient)
  ).length;
  return matchedCount / requiredIngredients.length;
}

function getMissingIngredients(
  requiredIngredients: CreativeIngredientType[] | undefined,
  detectedIngredients: CreativeIngredientType[] | undefined
): CreativeIngredientType[] {
  if (!requiredIngredients) return [];
  return requiredIngredients.filter((ingredient) => !detectedIngredients?.includes(ingredient));
}

function getMotionMatch(
  requiredMotion: ViralStructureGraph['shotSlots'][number]['requiredAsset']['motion'],
  asset: AssetCard
): number {
  if (!requiredMotion || requiredMotion === 'unknown') return 0.15;
  if (requiredMotion === 'hand_operation') {
    return asset.humanPresence?.actions?.some((action) =>
      ['applying_product', 'swatching', 'holding_product'].includes(action)
    )
      ? 0.15
      : 0;
  }
  if (asset.type === 'video') return 0.1;
  return 0;
}

function violatesHumanRequirement(
  slot: ViralStructureGraph['shotSlots'][number],
  asset: AssetCard
): boolean {
  if (!slot.humanRequirement?.required) return false;
  if (!asset.humanPresence?.hasHuman) return true;
  if (slot.humanRequirement.framing && !asset.humanPresence.framing?.includes(slot.humanRequirement.framing)) {
    return true;
  }
  const requiredAction = slot.humanRequirement.action;
  if (requiredAction && requiredAction !== 'none' && !asset.humanPresence.actions?.includes(requiredAction)) {
    return true;
  }
  return false;
}

function getGapType(
  role: ViralStructureGraph['shotSlots'][number]['role'],
  missingIngredients: CreativeIngredientType[]
): MaterialGapType {
  if (missingIngredients.includes('human_presence') || missingIngredients.includes('host_talking')) {
    return 'missing_human_host';
  }
  if (missingIngredients.includes('face_closeup')) return 'missing_human_host';
  if (missingIngredients.includes('beauty_demo') || missingIngredients.includes('makeup_application')) {
    return 'missing_usage_action';
  }
  if (missingIngredients.includes('before_after_comparison')) return 'missing_before_after';
  if (missingIngredients.includes('trust_building') || missingIngredients.includes('social_proof')) {
    return 'missing_trust_element';
  }
  if (missingIngredients.includes('scene_style') || missingIngredients.includes('soft_light')) {
    return 'missing_scene_style';
  }
  if (role === 'opening_attention') return 'missing_opening_visual';
  if (role === 'product_closeup') return 'missing_product_closeup';
  if (role === 'usage_demo') return 'missing_usage_demo';
  if (role === 'comparison') return 'missing_comparison';
  if (role === 'cta_visual') return 'missing_cta_visual';
  return 'missing_visual_ingredient';
}

function getGapReason(
  baseReason: string,
  missingIngredients: CreativeIngredientType[]
): string {
  if (missingIngredients.length === 0) return baseReason;
  return `${baseReason} 缺失关键创作要素：${missingIngredients.join(' / ')}。`;
}

function sanitizeMissingIngredients(missingIngredients: CreativeIngredientType[]): CreativeIngredientType[] {
  return missingIngredients
    .map((ingredient) => {
      if (ingredient === 'face_closeup') {
        return 'human_presence';
      }
      if (ingredient === 'beauty_demo' || ingredient === 'makeup_application' || ingredient === 'skin_texture_display') {
        return 'hand_demo';
      }
      return ingredient;
    })
    .filter((ingredient, index, items) => items.indexOf(ingredient) === index);
}

function boundaryBonus(segmentId: string, boundaries?: Boundary[]): number {
  if (!boundaries?.length) return 0;
  const strongTransitions = new Set(['morph', 'wipe']);
  const touches = boundaries.some(
    (b) =>
      (b.from === segmentId || b.to === segmentId)
      && b.intensity === 'strong'
      && strongTransitions.has(b.transitionType)
  );
  return touches ? 0.05 : 0;
}

// ---------------------------------------------------------------------------
// LLM judge: source-of-truth prompt at prompts/migration/slot_alignment_v0.md
// ---------------------------------------------------------------------------

const SLOT_ALIGNMENT_SYSTEM_PROMPT = `你是一个短视频结构迁移系统中的「素材对齐裁判」。

你将看到：
A. 源片样例的"分镜槽位骨架"：每个槽位含意图 (intent，可迁移)、源片实例 (sourceInstance，仅供识别 SWAP 项)、可接受标准 (acceptanceCriteria.anyOf)。
B. 新商品的"候选素材清单"：每张 AssetCard 含视觉描述 (visualContent)、动作潜力 (motionPotential)、候选角色 (candidateSlotRoles)。

判断原则：
1. 只看意图 + 接受标准，不要让 sourceInstance 把你带跑——新素材不需要和源片产品长得像。
2. 接受标准的 anyOf 是「OR」关系：任一组合达成即合格。在结果里列出 matchedCriteria 命中的项。
3. 即使没有任何 asset 能达 ≥ 0.85 质量，也仍要给出"最佳匹配 + treatmentSpec"。质量 < 0.45 才允许 assetId = null。
4. treatmentSpec 是处方：动作类型、时长（毫秒，落在素材的 canSimulateDurationMs 区间内）、节拍同步点、字幕建议。三选二填即可。
5. missing 必须是自然语言描述，不是 token。
6. 不要发明 assetId——只用候选清单里出现过的 id。
7. 只输出 JSON，不要 Markdown，不要解释。`;

const TreatmentSpecResponseSchema = z.object({
  motion: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  syncPoint: z.string().nullable().optional(),
  captionOverlay: z.string().nullable().optional()
});

const SlotAlignmentResultSchema = z.object({
  assetId: z.string().nullable(),
  quality: z.number().min(0).max(1),
  matchedCriteria: z.array(z.string()).default([]),
  missing: z.string().default(''),
  treatmentSpec: TreatmentSpecResponseSchema.default({})
});

const SlotAlignmentResponseSchema = z.record(SlotAlignmentResultSchema);

type AlignmentResult = z.infer<typeof SlotAlignmentResultSchema>;

interface SlotSummary {
  id: string;
  segmentId: string;
  role: string;
  intent?: ViralStructureGraph['shotSlots'][number]['intent'];
  acceptanceCriteria?: ViralStructureGraph['shotSlots'][number]['acceptanceCriteria'];
  sourceInstance?: ViralStructureGraph['shotSlots'][number]['sourceInstance'];
  fallbackStrategies: ViralStructureGraph['shotSlots'][number]['fallbackStrategies'];
}

interface AssetSummary {
  id: string;
  type: AssetCard['type'];
  visualContent?: AssetCard['visualContent'];
  motionPotential?: AssetCard['motionPotential'];
  candidateSlotRoles?: AssetCard['candidateSlotRoles'];
  detectedObjects?: AssetCard['detectedObjects'];
  suitableSlots?: AssetCard['suitableSlots'];
}

function summarizeSlot(slot: ViralStructureGraph['shotSlots'][number]): SlotSummary {
  return {
    id: slot.id,
    segmentId: slot.segmentId,
    role: slot.role,
    intent: slot.intent,
    acceptanceCriteria: slot.acceptanceCriteria,
    sourceInstance: slot.sourceInstance,
    fallbackStrategies: slot.fallbackStrategies
  };
}

function summarizeAsset(asset: AssetCard): AssetSummary {
  return {
    id: asset.id,
    type: asset.type,
    visualContent: asset.visualContent,
    motionPotential: asset.motionPotential,
    candidateSlotRoles: asset.candidateSlotRoles,
    detectedObjects: asset.detectedObjects,
    suitableSlots: asset.suitableSlots
  };
}

function buildAlignmentUserPrompt(slots: SlotSummary[], assets: AssetSummary[]): string {
  return `下面是源片骨架的槽位清单（精简版）：

${JSON.stringify(slots, null, 2)}

下面是新商品的候选素材（精简版）：

${JSON.stringify(assets, null, 2)}

请输出对齐 JSON，结构为 { "<slotId>": { "assetId": "..." | null, "quality": 0..1, "matchedCriteria": [...], "missing": "≤80字", "treatmentSpec": { "motion"|null, "durationMs"|null, "syncPoint"|null, "captionOverlay"|null } } }。

约束：
- 每个 slotId 必须出现一次，不可遗漏。
- assetId 必须存在于候选素材清单中或为 null。
- quality 严格 0-1。
- treatmentSpec 至少有两个字段非 null。

只输出 JSON 本体。`;
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  }
  return trimmed;
}

function statusFromQuality(quality: number, assetId: string | null): SlotMatch['status'] {
  if (assetId && quality >= 0.85) return 'matched';
  if (assetId && quality >= 0.45) return 'partial';
  return 'missing';
}

function cleanTreatmentSpec(spec: AlignmentResult['treatmentSpec']): import('@viral-struct/shared').SlotTreatmentSpec | undefined {
  const out: import('@viral-struct/shared').SlotTreatmentSpec = {};
  if (typeof spec.motion === 'string') out.motion = spec.motion;
  if (typeof spec.durationMs === 'number') out.durationMs = spec.durationMs;
  if (typeof spec.syncPoint === 'string') out.syncPoint = spec.syncPoint;
  if (typeof spec.captionOverlay === 'string') out.captionOverlay = spec.captionOverlay;
  return Object.keys(out).length > 0 ? out : undefined;
}

function reasonFromAlignment(result: AlignmentResult, status: SlotMatch['status']): string {
  if (status === 'matched') return result.matchedCriteria.length
    ? `已对齐：命中接受标准 ${result.matchedCriteria.join(' / ')}。`
    : '已对齐：质量评分高于阈值。';
  if (status === 'partial') return result.missing
    ? `可用但需补全：${result.missing}`
    : '素材语义部分满足，可用但需要补全处理。';
  return result.missing || '没有候选素材能达到该槽位的接受标准。';
}

function buildLLMMatch(slot: ViralStructureGraph['shotSlots'][number], result: AlignmentResult): SlotMatch {
  const assetId = result.assetId ?? undefined;
  const status = statusFromQuality(result.quality, result.assetId);
  const treatmentSpec = cleanTreatmentSpec(result.treatmentSpec);
  return {
    slotId: slot.id,
    assetId,
    score: result.quality,
    status,
    reason: reasonFromAlignment(result, status),
    quality: result.quality,
    matchedCriteria: result.matchedCriteria.length ? result.matchedCriteria : undefined,
    missingDescription: result.missing || undefined,
    treatmentSpec,
    alignmentSource: 'llm_judge'
  };
}

function buildLLMGap(slot: ViralStructureGraph['shotSlots'][number], match: SlotMatch): MaterialGap {
  return {
    slotId: slot.id,
    role: slot.role,
    severity: match.status === 'missing' ? 'high' : 'medium',
    reason: match.missingDescription || match.reason,
    impact: `该缺口影响 ${slot.segmentId} 段落的画面表达，需要走 ${slot.fallbackStrategies.join(' / ')} 补足。`,
    affectedSegmentId: slot.segmentId
  };
}

type Client = ReturnType<typeof createOpenAICompatibleClient>;

export interface MatchSlotsLLMOptions {
  graph: ViralStructureGraph;
  assets: AssetCard[];
  boundaries?: Boundary[];
  clientFactory?: () => Client;
  model?: string;
}

export async function matchSlotsLLM(opts: MatchSlotsLLMOptions): Promise<{ matches: SlotMatch[]; gaps: MaterialGap[] }> {
  const { graph, assets, clientFactory, model } = opts;
  const client = (clientFactory ?? createOpenAICompatibleClient)();
  const modelId = model ?? process.env.LLM_MODEL;
  if (!modelId) {
    throw new Error('LLM_MODEL is required for matchSlotsLLM.');
  }

  const slotSummaries = graph.shotSlots.map(summarizeSlot);
  const assetSummaries = assets.map(summarizeAsset);

  const response = await client.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: SLOT_ALIGNMENT_SYSTEM_PROMPT },
      { role: 'user', content: buildAlignmentUserPrompt(slotSummaries, assetSummaries) }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' }
  });

  const raw = response.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(stripJsonFence(raw));
  const validated = SlotAlignmentResponseSchema.parse(parsed);

  const knownAssetIds = new Set(assets.map((a) => a.id));
  const matches: SlotMatch[] = graph.shotSlots.map((slot) => {
    const aligned = validated[slot.id];
    if (!aligned) {
      throw new Error(`LLM alignment missing slot ${slot.id}`);
    }
    if (aligned.assetId && !knownAssetIds.has(aligned.assetId)) {
      throw new Error(`LLM returned unknown assetId ${aligned.assetId} for slot ${slot.id}`);
    }
    return buildLLMMatch(slot, aligned);
  });

  const gaps: MaterialGap[] = matches
    .filter((m) => m.status !== 'matched')
    .map((m) => {
      const slot = graph.shotSlots.find((s) => s.id === m.slotId)!;
      return buildLLMGap(slot, m);
    });

  return { matches, gaps };
}

export type MatchSlotsResultWithSource = {
  matches: SlotMatch[];
  gaps: MaterialGap[];
  alignmentSource: 'llm_judge' | 'rule_based';
  warning?: string;
};

/**
 * Tries the LLM alignment judge first; on any error falls back to the
 * rule-based scorer. The returned `alignmentSource` and per-match
 * `alignmentSource` tell callers which path was taken.
 */
export async function matchSlotsWithFallback(opts: MatchSlotsLLMOptions): Promise<MatchSlotsResultWithSource> {
  try {
    const result = await matchSlotsLLM(opts);
    return { ...result, alignmentSource: 'llm_judge' };
  } catch (err) {
    const fallback = matchSlots(opts.graph, opts.assets, opts.boundaries);
    return {
      matches: fallback.matches.map((m) => ({ ...m, alignmentSource: 'rule_based' as const })),
      gaps: fallback.gaps,
      alignmentSource: 'rule_based',
      warning: `LLM alignment failed (${err instanceof Error ? err.message : String(err)}); using rule-based fallback.`
    };
  }
}
