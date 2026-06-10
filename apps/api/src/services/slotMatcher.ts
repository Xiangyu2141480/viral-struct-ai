import { z } from 'zod';
import type {
  AssetCard,
  AssetManagerRole,
  AssetMatchEvidence,
  Boundary,
  CreativeIngredientType,
  MaterialGap,
  MaterialGapType,
  RoleAffordanceScore,
  ShotSlotRole,
  SlotMatch,
  ViralStructureGraph
} from '@viral-struct/shared';
import { splitRejectIfForTransfer } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from './llmProvider';
import { buildMotifContext, extractViralMotifAnnotation } from './motifs/viralMotifExtractor';

export function matchSlots(
  graph: ViralStructureGraph,
  assets: AssetCard[],
  boundaries?: Boundary[]
): { matches: SlotMatch[]; gaps: MaterialGap[] } {
  const matchableAssets = assets.filter(isMatchableAsset);
  const matches: SlotMatch[] = graph.shotSlots.map((slot) => {
    const ranked = matchableAssets
      .map((asset) => {
        const semanticMatch = getSemanticMatch(slot.role, asset);
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
        const quality = getAssetQualityScore(asset) * 0.1;
        const analysisFit = getRoleAffordanceFit(slot.role, asset) * 0.15;
        const score = clampScore(
          semanticMatch + typeMatch + ingredientMatchScore * 0.2 + motionMatch + quality
          + analysisFit
          + boundaryBonus(slot.segmentId, boundaries)
          - getAnalysisPenalty(asset)
        );
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
        assetSegmentId: best.asset.segmentSource ? best.asset.id : undefined,
        mediaStartSec: best.asset.segmentSource?.startSec,
        mediaEndSec: best.asset.segmentSource?.endSec,
        score,
        ingredientMatchScore: best.ingredientMatchScore,
        missingIngredients: sanitizeMissingIngredients(best.missingIngredients),
        status: 'matched',
        reason: '素材类型、槽位语义、关键创作要素和质量均满足。',
        assetEvidence: buildAssetMatchEvidence(best.asset, slot.role)
      };
    }

    if (score >= 0.45) {
      return {
        slotId: slot.id,
        assetId: best.asset.id,
        assetSegmentId: best.asset.segmentSource ? best.asset.id : undefined,
        mediaStartSec: best.asset.segmentSource?.startSec,
        mediaEndSec: best.asset.segmentSource?.endSec,
        score,
        ingredientMatchScore: best.ingredientMatchScore,
        missingIngredients: sanitizeMissingIngredients(best.missingIngredients),
        status: 'partial',
        reason: humanBlocked
          ? '槽位需要授权演示或指定动作，但当前素材缺少对应动作要素，最多只能部分满足。'
          : '素材语义部分满足，但类型、动作、时长或创作要素不足，需要补全。',
        assetEvidence: buildAssetMatchEvidence(best.asset, slot.role)
      };
    }

    return {
      slotId: slot.id,
      assetId: best?.asset.id,
      assetSegmentId: best?.asset.segmentSource ? best.asset.id : undefined,
      mediaStartSec: best?.asset.segmentSource?.startSec,
      mediaEndSec: best?.asset.segmentSource?.endSec,
      score,
      ingredientMatchScore: best?.ingredientMatchScore ?? 0,
      missingIngredients: sanitizeMissingIngredients(best?.missingIngredients ?? slot.visualIngredientRequirements ?? []),
      status: 'missing',
      reason: '没有找到能支撑该结构槽位的素材。',
      assetEvidence: best ? buildAssetMatchEvidence(best.asset, slot.role) : undefined
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
        missingIngredients,
        motifContext: buildSlotMotifContext(slot)
      };
    });

  return { matches, gaps };
}

function isMatchableAsset(asset: AssetCard): boolean {
  return !(
    asset.type === 'video'
    && !asset.segmentSource
    && (asset.analysis?.videoSegments?.length ?? 0) > 0
  );
}

function buildSlotMotifContext(slot: ViralStructureGraph['shotSlots'][number]): MaterialGap['motifContext'] {
  const existing = slot.motifAnnotations?.find((annotation) => annotation.motifType !== undefined);
  const annotation = existing ?? extractViralMotifAnnotation({
    slot,
    targetCategory: 'generic'
  });
  return annotation ? buildMotifContext(annotation) : undefined;
}

const SLOT_ROLE_TO_ASSET_MANAGER_ROLE: Record<ShotSlotRole, AssetManagerRole> = {
  opening_attention: 'opening_hook',
  product_closeup: 'product_closeup',
  usage_demo: 'usage_demo',
  benefit_visual: 'benefit_proof',
  comparison: 'comparison',
  testimonial: 'benefit_proof',
  cta_visual: 'cta',
  // instructional slot roles (course/tutorial genre) -> nearest asset-manager role
  instruction_card: 'packaging_card',
  example_clip: 'usage_demo',
  technique_demo: 'usage_demo'
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(0.99, Number(value.toFixed(4))));
}

function getSemanticMatch(role: ShotSlotRole, asset: AssetCard): number {
  if (asset.suitableSlots.includes(role)) return 0.35;
  if (asset.analysis?.slotAffordance.suitableSlots.includes(role)) return 0.35;
  const targetAffordance = getTargetAffordance(role, asset);
  if ((targetAffordance?.score ?? 0) >= 75) return 0.35;
  return 0;
}

function getAssetQualityScore(asset: AssetCard): number {
  return asset.analysis?.quality.overallScore ?? asset.qualityScore;
}

function getRoleAffordanceFit(role: ShotSlotRole, asset: AssetCard): number {
  const target = getTargetAffordance(role, asset);
  if (target) return target.score / 100;
  const primary = asset.analysis?.slotAffordance.primaryRoles.find((entry) => entry.role === role);
  if (primary) return primary.confidence;
  return asset.candidateSlotRoles?.find((entry) => entry.role === role)?.confidence ?? 0;
}

function getAnalysisPenalty(asset: AssetCard): number {
  const warnings = asset.analysis?.warnings ?? [];
  const warningPenalty = Math.min(0.12, warnings.length * 0.035);
  const quality = getAssetQualityScore(asset);
  const lowQualityPenalty = quality < 0.5 ? (0.5 - quality) * 0.12 : 0;
  const safetyPenalty = asset.analysis?.safety.status === 'blocked'
    ? 0.2
    : asset.analysis?.safety.status === 'needs_review'
      ? 0.08
      : 0;
  return warningPenalty + lowQualityPenalty + safetyPenalty;
}

function getTargetAffordance(role: ShotSlotRole, asset: AssetCard): RoleAffordanceScore | undefined {
  const targetRole = SLOT_ROLE_TO_ASSET_MANAGER_ROLE[role];
  return asset.analysis?.roleAffordance?.find((entry) => entry.role === targetRole);
}

function getTopAffordance(role: ShotSlotRole, asset: AssetCard): RoleAffordanceScore | undefined {
  return getTargetAffordance(role, asset)
    ?? asset.analysis?.roleAffordance?.slice().sort((a, b) => b.score - a.score)[0];
}

function buildAssetMatchEvidence(asset: AssetCard, slotRole: ShotSlotRole): AssetMatchEvidence {
  const topAffordance = getTopAffordance(slotRole, asset);
  const keyframes = asset.analysis?.media.keyframes ?? [];
  const qualityScore = getAssetQualityScore(asset);
  const productVisibilityScore =
    topAffordance?.components.productVisibilityFit
    ?? (asset.analysis?.quality.productFocus !== undefined ? Math.round(asset.analysis.quality.productFocus * 100) : undefined);
  const reasons = [
    topAffordance ? `${topAffordance.role} affordance ${Math.round(topAffordance.score)}: ${topAffordance.rationale}` : undefined,
    asset.segmentSource ? `segment: ${asset.segmentSource.label} (${asset.segmentSource.startSec}s-${asset.segmentSource.endSec}s)` : undefined,
    asset.analysis?.semantic.summary ? `semantic: ${asset.analysis.semantic.summary}` : undefined,
    asset.analysis?.slotAffordance.rationale ? `slot affordance: ${asset.analysis.slotAffordance.rationale}` : undefined,
    `quality: ${qualityScore.toFixed(2)}`
  ].filter((reason): reason is string => Boolean(reason));

  return {
    assetId: asset.id,
    parentAssetId: asset.segmentSource?.parentAssetId,
    segmentLabel: asset.segmentSource?.label,
    mediaStartSec: asset.segmentSource?.startSec,
    mediaEndSec: asset.segmentSource?.endSec,
    segmentIndex: asset.segmentSource?.segmentIndex,
    qualityScore,
    topAffordanceRole: topAffordance?.role,
    topAffordanceScore: topAffordance?.score,
    productVisibilityScore,
    keyframeIds: keyframes.map((keyframe) => keyframe.id),
    keyframeCaptions: keyframes
      .map((keyframe) => keyframe.description)
      .filter((caption): caption is string => Boolean(caption)),
    reasons,
    warnings: [
      ...(asset.analysis?.warnings ?? []),
      ...(asset.segmentSource?.warnings ?? []),
      ...(asset.analysis?.quality.issues.map((issue) => issue.message) ?? [])
    ]
  };
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

你会看到 hardRejectIf 和 sourceSpecificRejectIf。
hardRejectIf 是真正的质量、安全、构图拒绝条件。
sourceSpecificRejectIf 是源品类专属限制，不得直接用于否决目标品类素材。
请把 sourceSpecificRejectIf 理解为需要做目标品类等价迁移的提示。
例如源片要求“不能是无开合结构的素材”，迁移到饮料品类时不应否决瓶装饮料，而应判断是否存在开盖、触碰、倒入、冰爽爆发等目标品类等价动作。

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

/**
 * The judge is told to return matchedCriteria as strings, but LLMs often return richer objects
 * (e.g. {criterion, met}). Coerce each item to a string so one stylistic deviation doesn't drop the
 * whole alignment to the rule-based fallback. String items are unchanged.
 */
function coerceCriterion(item: unknown): string {
  if (typeof item === 'string') return item.trim();
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>;
    for (const key of ['criterion', 'text', 'name', 'description', 'motionType', 'compositionType', 'label', 'value']) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    const strings = Object.values(obj).filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (strings.length) return strings.join(' / ');
    return JSON.stringify(item);
  }
  return String(item ?? '').trim();
}

const MatchedCriteriaSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value.map(coerceCriterion).filter((s) => s.length > 0) : []),
  z.array(z.string())
);

const SlotAlignmentResultSchema = z.object({
  assetId: z.string().nullable(),
  quality: z.number().min(0).max(1),
  matchedCriteria: MatchedCriteriaSchema,
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
  acceptanceCriteria?: {
    anyOf: NonNullable<ViralStructureGraph['shotSlots'][number]['acceptanceCriteria']>['anyOf'];
    hardRejectIf: string[];
    sourceSpecificRejectIf: string[];
  };
  sourceInstance?: ViralStructureGraph['shotSlots'][number]['sourceInstance'];
  fallbackStrategies: ViralStructureGraph['shotSlots'][number]['fallbackStrategies'];
}

interface AssetSummary {
  id: string;
  type: AssetCard['type'];
  parentAssetId?: string;
  segmentLabel?: string;
  mediaStartSec?: number;
  mediaEndSec?: number;
  visualContent?: AssetCard['visualContent'];
  motionPotential?: AssetCard['motionPotential'];
  candidateSlotRoles?: AssetCard['candidateSlotRoles'];
  detectedObjects?: AssetCard['detectedObjects'];
  suitableSlots?: AssetCard['suitableSlots'];
  analysisEvidence?: {
    semanticShortCaption?: string;
    topAffordances: Array<{
      role: AssetManagerRole;
      score: number;
      rationale: string;
    }>;
    quality: number;
    productVisibilityScore?: number;
    keyframes: Array<{
      id: string;
      caption?: string;
    }>;
    warnings: string[];
  };
}

function summarizeSlot(slot: ViralStructureGraph['shotSlots'][number]): SlotSummary {
  const acceptanceCriteria = slot.acceptanceCriteria
    ? {
        anyOf: slot.acceptanceCriteria.anyOf,
        ...splitRejectIfForTransfer({
          ...slot.acceptanceCriteria,
          slotText: [
            slot.intent?.purpose,
            slot.intent?.motionPattern,
            slot.sourceInstance?.productInSource,
            slot.sourceInstance?.specificAction
          ].filter(Boolean).join('\n')
        })
      }
    : undefined;
  return {
    id: slot.id,
    segmentId: slot.segmentId,
    role: slot.role,
    intent: slot.intent,
    acceptanceCriteria,
    sourceInstance: slot.sourceInstance,
    fallbackStrategies: slot.fallbackStrategies
  };
}

function summarizeAsset(asset: AssetCard): AssetSummary {
  return {
    id: asset.id,
    type: asset.type,
    parentAssetId: asset.segmentSource?.parentAssetId,
    segmentLabel: asset.segmentSource?.label,
    mediaStartSec: asset.segmentSource?.startSec,
    mediaEndSec: asset.segmentSource?.endSec,
    visualContent: asset.visualContent,
    motionPotential: asset.motionPotential,
    candidateSlotRoles: asset.candidateSlotRoles,
    detectedObjects: asset.detectedObjects,
    suitableSlots: asset.suitableSlots,
    analysisEvidence: summarizeAssetAnalysisEvidence(asset)
  };
}

function summarizeAssetAnalysisEvidence(asset: AssetCard): AssetSummary['analysisEvidence'] | undefined {
  const analysis = asset.analysis;
  if (!analysis) return undefined;
  const topAffordances = (analysis.roleAffordance ?? [])
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry) => ({
      role: entry.role,
      score: Math.round(entry.score),
      rationale: entry.rationale
    }));
  return {
    semanticShortCaption: analysis.semantic.summary,
    topAffordances,
    quality: Number(analysis.quality.overallScore.toFixed(2)),
    productVisibilityScore: Math.round(analysis.quality.productFocus * 100),
    keyframes: analysis.media.keyframes.slice(0, 3).map((keyframe) => ({
      id: keyframe.id,
      caption: keyframe.description
    })),
    warnings: analysis.warnings.slice(0, 5)
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

function isUnsupportedResponseFormatError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /response_format|json_object/i.test(message);
}

const DEFAULT_ALIGNMENT_MAX_TOKENS = 8192;

function resolveAlignmentMaxTokens(): number {
  const fromEnv = Number(process.env.LLM_MAX_TOKENS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_ALIGNMENT_MAX_TOKENS;
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  }
  return trimmed;
}

export type AssetEvidenceStrength = 'none' | 'weak' | 'medium' | 'strong';

export function statusFromQualityWithEvidence(args: {
  quality: number;
  hasAsset: boolean;
  assetEvidenceStrength: AssetEvidenceStrength;
  hardRejectTriggered?: boolean;
  sourceSpecificRejectOnly?: boolean;
}): SlotMatch['status'] {
  if (!args.hasAsset) return 'missing';
  if (args.hardRejectTriggered) return 'missing';
  if (args.quality >= 0.85) return 'matched';
  if (args.quality >= 0.45) return 'partial';
  if (args.quality >= 0.4 && args.assetEvidenceStrength !== 'none') return 'partial';
  if (args.sourceSpecificRejectOnly && args.assetEvidenceStrength !== 'none') return 'partial';
  return 'missing';
}

function statusFromQuality(quality: number, asset: AssetCard | undefined, sourceSpecificRejectOnly = false): SlotMatch['status'] {
  return statusFromQualityWithEvidence({
    quality,
    hasAsset: Boolean(asset),
    assetEvidenceStrength: estimateAssetEvidenceStrength(asset),
    sourceSpecificRejectOnly
  });
}

export function estimateAssetEvidenceStrength(asset: AssetCard | undefined): AssetEvidenceStrength {
  if (!asset) return 'none';
  let score = 0;
  const analysis = asset.analysis;
  if (asset.visualContent || asset.spatialDescription || asset.temporalDescription) score += 1;
  if ((asset.detectedObjects?.length ?? 0) > 0 || (asset.detectedIngredients?.length ?? 0) > 0) score += 1;
  if ((asset.suitableSlots?.length ?? 0) > 0 || (asset.candidateSlotRoles?.length ?? 0) > 0) score += 1;
  if (analysis?.semantic.summary) score += 1;
  if ((analysis?.semantic.detectedObjects.length ?? 0) > 0) score += 1;
  if ((analysis?.media.keyframes.length ?? 0) > 0) score += 1;
  if ((analysis?.roleAffordance ?? []).some((entry) => entry.score >= 70)) score += 2;
  if ((analysis?.slotAffordance.primaryRoles.length ?? 0) > 0) score += 1;
  if ((analysis?.quality.overallScore ?? asset.qualityScore ?? 0) >= 0.75) score += 1;
  if ((analysis?.warnings.length ?? 0) >= 3) score -= 1;

  if (score >= 6) return 'strong';
  if (score >= 3) return 'medium';
  if (score >= 1) return 'weak';
  return 'none';
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

function buildLLMMatch(
  slot: ViralStructureGraph['shotSlots'][number],
  result: AlignmentResult,
  asset?: AssetCard
): SlotMatch {
  const assetId = result.assetId ?? undefined;
  const sourceSplit = splitRejectIfForTransfer({
    ...slot.acceptanceCriteria,
    slotText: `${slot.intent?.purpose ?? ''}\n${slot.sourceInstance?.specificAction ?? ''}`
  });
  const hardRejectTriggered = sourceSplit.hardRejectIf.some((item) => result.missing.includes(item));
  const sourceSpecificRejectOnly =
    sourceSplit.sourceSpecificRejectIf.length > 0
    && sourceSplit.hardRejectIf.length === 0
    && result.missing.length > 0;
  const status = statusFromQuality(result.quality, asset, sourceSpecificRejectOnly && !hardRejectTriggered);
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
    alignmentSource: 'llm_judge',
    assetEvidence: asset ? buildAssetMatchEvidence(asset, slot.role) : undefined,
    assetSegmentId: asset?.segmentSource ? asset.id : undefined,
    mediaStartSec: asset?.segmentSource?.startSec,
    mediaEndSec: asset?.segmentSource?.endSec
  };
}

function buildLLMGap(slot: ViralStructureGraph['shotSlots'][number], match: SlotMatch): MaterialGap {
  return {
    slotId: slot.id,
    role: slot.role,
    severity: match.status === 'missing' ? 'high' : 'medium',
    reason: match.missingDescription || match.reason,
    impact: `该缺口影响 ${slot.segmentId} 段落的画面表达，需要走 ${slot.fallbackStrategies.join(' / ')} 补足。`,
    affectedSegmentId: slot.segmentId,
    motifContext: buildSlotMotifContext(slot)
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
  const matchableAssets = assets.filter(isMatchableAsset);
  const client = (clientFactory ?? createOpenAICompatibleClient)();
  const modelId = model ?? process.env.LLM_MODEL;
  if (!modelId) {
    throw new Error('LLM_MODEL is required for matchSlotsLLM.');
  }

  const slotSummaries = graph.shotSlots.map(summarizeSlot);
  const assetSummaries = matchableAssets.map(summarizeAsset);

  const messages = [
    { role: 'system' as const, content: SLOT_ALIGNMENT_SYSTEM_PROMPT },
    { role: 'user' as const, content: buildAlignmentUserPrompt(slotSummaries, assetSummaries) }
  ];

  // The alignment JSON has one entry per shotSlot, so a graph with many slots produces a long response.
  // Without a generous output budget the model truncates mid-JSON (parse fails -> rule-based fallback),
  // so we request a large max_tokens (env-overridable via LLM_MAX_TOKENS).
  const maxTokens = resolveAlignmentMaxTokens();

  // Most OpenAI-compatible endpoints accept response_format json_object, but some models (e.g. certain
  // domestic providers) reject it with a 400. The system prompt already mandates raw JSON and
  // stripJsonFence parses it, so on an unsupported-response_format error we retry once without the hint.
  let response;
  try {
    response = await client.chat.completions.create({
      model: modelId,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' }
    });
  } catch (err) {
    if (!isUnsupportedResponseFormatError(err)) throw err;
    response = await client.chat.completions.create({ model: modelId, messages, temperature: 0.2, max_tokens: maxTokens });
  }

  const raw = response.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(stripJsonFence(raw));
  const validated = SlotAlignmentResponseSchema.parse(parsed);

  const knownAssetIds = new Set(matchableAssets.map((a) => a.id));
  const assetById = new Map(matchableAssets.map((asset) => [asset.id, asset]));
  const matches: SlotMatch[] = graph.shotSlots.map((slot) => {
    const aligned = validated[slot.id];
    if (!aligned) {
      throw new Error(`LLM alignment missing slot ${slot.id}`);
    }
    if (aligned.assetId && !knownAssetIds.has(aligned.assetId)) {
      throw new Error(`LLM returned unknown assetId ${aligned.assetId} for slot ${slot.id}`);
    }
    return buildLLMMatch(slot, aligned, aligned.assetId ? assetById.get(aligned.assetId) : undefined);
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
