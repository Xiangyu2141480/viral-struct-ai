import type {
  AssetCard,
  CategoryEquivalentVocabulary,
  ContentBrief,
  OrchestratedSlot,
  OrchestratedTransition
} from '@viral-struct/shared';
import { SAFE_NEGATIVE_PROMPT_ZH, DEFAULT_HYPERFRAMES_TRANSITION_WEIGHT } from './constants';

/**
 * P3 (§7, decision 2) — transition logic migrated into the Director Agent.
 *
 * The legacy transitionRecipeGenerator consumed flat TimelineItems and produced rich TransitionRecipes.
 * Here we re-home the core idea (adjacent-pair pairing, narrative-function inference, motif-driven choice)
 * but consume OrchestratedSlots and emit the leaner OrchestratedTransition, with two policy changes:
 *   - **hyperframes is the high-weight default** (decision 2): most transitions are card animations the
 *     Video Agent can execute from existing assets;
 *   - **aigc_frame_bridge is opt-in and gated**: only when BOTH sides are real `matched` assets AND the
 *     motif needs real-frame continuity (chaos→order / ingredient→product with cascade motion). It is a
 *     plan/job-card only — no external model is called, no frames are really extracted (placeholders).
 *
 * Everything is plan-only: no rendering, no external generation.
 */
export interface BuildOrchestratedTransitionsArgs {
  slots: OrchestratedSlot[];
  assetCards: AssetCard[];
  contentBrief: ContentBrief;
  /** Product-native category-equivalent vocabulary. The kinetic-assembly bridge reads its actions from here; everything else stays category-neutral structural language. */
  vocab: CategoryEquivalentVocabulary;
  /** Share of transitions that prefer hyperframes (default 0.8). At >= 1 even strong pairs stay hyperframes. */
  hyperframesWeight?: number;
}

const STRONG_BRIDGE_FUNCTIONS = new Set(['motif_assembly_bridge', 'chaos_to_order', 'ingredient_to_product']);
const STRONG_BRIDGE_TOKENS = new Set([
  'component_cascade',
  'chaos_to_order',
  'assembly_completion',
  'assembly_reveal',
  'spectacle_burst'
]);

export function buildOrchestratedTransitions(args: BuildOrchestratedTransitionsArgs): OrchestratedTransition[] {
  const slots = [...args.slots].sort((a, b) => a.startMs - b.startMs);
  if (slots.length < 2) {
    return [];
  }

  const weight = args.hyperframesWeight ?? DEFAULT_HYPERFRAMES_TRANSITION_WEIGHT;
  const productName = args.contentBrief.productName;
  const transitions: OrchestratedTransition[] = [];

  for (let index = 0; index < slots.length - 1; index += 1) {
    const from = slots[index];
    const to = slots[index + 1];
    const id = `transition_${String(index + 1).padStart(3, '0')}`;
    const transitionFunction = inferTransitionFunction(from, to);
    const requiredAssets = [matchedAssetId(from), matchedAssetId(to)].filter((value): value is string => Boolean(value));
    const missingAssets = [from, to].filter(isGap).map((slot) => `${slot.slotId} asset`);

    if (isGap(from) || isGap(to)) {
      // No real frames on one side → a clean cut into the next slot (still executable via hyperframes card).
      transitions.push({
        id,
        fromSlotId: from.slotId,
        toSlotId: to.slotId,
        mode: 'cut',
        transitionFunction,
        preferredImplementation: 'hyperframes',
        reason: '一侧仍是缺口，因此用干净切换进入下一槽位，不做真实帧桥接。',
        requiredAssets,
        missingAssets,
        riskNotes: ['Plan-only transition; one side is a gap pending resolution.']
      });
      continue;
    }

    // §7 rule 3: a real frame bridge needs BOTH sides to be real `matched` footage (not partial),
    // AND a motif that needs frame continuity. Everything else stays on the hyperframes default.
    if (allowsFrameBridge(weight) && isRealMatched(from) && isRealMatched(to) && needsRealFrameBridge(from, to, transitionFunction)) {
      transitions.push({
        id,
        fromSlotId: from.slotId,
        toSlotId: to.slotId,
        mode: 'aigc_frame_bridge',
        transitionFunction,
        preferredImplementation: 'external_generation',
        reason: 'Both sides are matched and the motif needs real-frame continuity; bridge via an AIGC frame job card.',
        aigcFrameBridge: {
          fromTailFrameRef: `required: extract tail frame from ${from.slotId}`,
          toHeadFrameRef: `required: extract head frame from ${to.slotId}`,
          prompt:
            `仅为生成提示词，非成片。为 ${productName} 生成衔接帧：${transitionPrompt(transitionFunction, from, to, args.vocab)}`
            + '不得加入任何未授权品牌、价格承诺或医疗功效宣称。',
          negativePrompt: SAFE_NEGATIVE_PROMPT_ZH,
          durationMs: 500,
          ownership: 'external_generation_job_card_only'
        },
        requiredAssets,
        missingAssets,
        riskNotes: [
          'Plan-only frame bridge; no external model is called and no frames are really extracted yet.',
          'Review brand, IP and source-copying risk before rendering.'
        ]
      });
      continue;
    }

    // Default (high weight): a hyperframes card animation bridges the two shots.
    transitions.push({
      id,
      fromSlotId: from.slotId,
      toSlotId: to.slotId,
      mode: 'hyperframes',
      transitionFunction,
      preferredImplementation: 'hyperframes',
      reason: `用语义转场把「${zhRole(from.role)}」承接到「${zhRole(to.role)}」，保留结构节奏但不复制源画面。`,
      hyperframes: {
        editingGuidanceNL: `${transitionGuidance(transitionFunction, productName, from, to, args.vocab)}保持产品标签清晰可见，不加任何未经证实的宣称。`,
        durationMs: 400,
        styleTokens: styleTokens(from, to, transitionFunction)
      },
      requiredAssets,
      missingAssets,
      riskNotes: ['Plan-only transition; review brand/IP/claims before rendering.']
    });
  }

  return transitions;
}

function allowsFrameBridge(weight: number): boolean {
  // weight >= 1 means "force hyperframes for everything"; below that, strong pairs may use a frame bridge.
  return weight < 1;
}

function needsRealFrameBridge(from: OrchestratedSlot, to: OrchestratedSlot, transitionFunction: string): boolean {
  if (!STRONG_BRIDGE_FUNCTIONS.has(transitionFunction)) {
    return false;
  }
  return hasStrongMotion(from) || hasStrongMotion(to);
}

function hasStrongMotion(slot: OrchestratedSlot): boolean {
  return (slot.motionTokens ?? []).some((token) => STRONG_BRIDGE_TOKENS.has(token));
}

function inferTransitionFunction(from: OrchestratedSlot, to: OrchestratedSlot): string {
  const fromRole = from.role;
  const toRole = to.role;
  if (toRole === 'cta' || toRole === 'cta_visual') return fromRole === 'cta_visual' ? 'cta_lockup' : 'product_to_cta';
  if (isMotifAssemblyBridge(from, to)) return 'motif_assembly_bridge';
  if (fromRole === 'opening_attention' && (toRole === 'product_closeup' || toRole === 'usage_demo')) return 'opening_to_product';
  if (fromRole === 'product_closeup' && toRole === 'usage_demo') return 'product_to_usage';
  if (fromRole === 'usage_demo' && (toRole === 'benefit_visual' || toRole === 'testimonial')) return 'usage_to_benefit';
  if ((fromRole === 'benefit_visual' || fromRole === 'testimonial') && toRole === 'usage_demo') return 'benefit_to_usage';
  if (fromRole === 'comparison') return 'proof_to_cta';
  return 'simple_cut';
}

function isMotifAssemblyBridge(from: OrchestratedSlot, to: OrchestratedSlot): boolean {
  if (to.role === 'benefit_visual' || to.role === 'testimonial' || to.role === 'cta_visual') {
    return false;
  }
  return from.motifType === 'kinetic_assembly_reveal' || to.motifType === 'kinetic_assembly_reveal';
}

/**
 * Category-neutral transition guidance. Transitions are structural connective tissue, so — apart from the
 * kinetic-assembly bridge, which expresses the product's OWN cascade actions from the injected vocab — every
 * case stays product-neutral (product name + generic motion verbs) and never names any category-specific
 * imagery. This keeps transitions from re-stating slot content and from leaking another category's motifs.
 */
function transitionGuidance(
  functionName: string,
  productName: string,
  from: OrchestratedSlot,
  to: OrchestratedSlot,
  vocab: CategoryEquivalentVocabulary
): string {
  switch (functionName) {
    case 'opening_to_product':
      return `以 ${productName} 为主体，用快速推近或干净擦除从「${zhRole(from.role)}」转场到「${zhRole(to.role)}」，前 0.4 秒迅速锁定产品主体。`;
    case 'product_to_usage':
      return `以 ${productName} 为主体，用手部动作或细节触发，从产品特写自然承接到真实使用动作。`;
    case 'usage_to_benefit':
      return `把使用动作的末帧接到卖点证明，用利益点卡片落下或干净擦除完成转场。`;
    case 'benefit_to_usage':
      return `让卖点卡下落或侧滑，露出下一段真实使用动作，保留节奏但降低字幕压力。`;
    case 'motif_assembly_bridge':
      return `迁移级联组装语法：让 ${vocab.bySubtype.kinetic_assembly_reveal!.actions.join('、')} 由散到聚地依次完成，再承接到「${zhRole(to.role)}」镜头。`;
    case 'product_to_cta':
      return `用产品定格和 CTA 锁定，把前一镜头收束到结尾行动引导。`;
    case 'cta_lockup':
      return `保持产品轻微弹动后稳定在 CTA 尾帧，形成干净收口。`;
    case 'proof_to_cta':
      return `从证明或对比段落用分屏合拢转场到 CTA 尾帧，避免未经证实的优劣宣称。`;
    default:
      return `用干净切换或轻微擦除从「${zhRole(from.role)}」承接到「${zhRole(to.role)}」。`;
  }
}

function transitionPrompt(
  functionName: string,
  from: OrchestratedSlot,
  to: OrchestratedSlot,
  vocab: CategoryEquivalentVocabulary
): string {
  switch (functionName) {
    case 'motif_assembly_bridge':
      return `${vocab.bySubtype.kinetic_assembly_reveal!.actions.join('、')} 从上一镜头由散到聚地级联汇聚，形成结构化转场，再自然进入「${zhRole(to.role)}」镜头。`;
    case 'opening_to_product':
      return `用干净擦除露出清晰产品主体，并自然进入「${zhRole(to.role)}」镜头。`;
    case 'product_to_usage':
      return `用手部动作或细节触发画面切换，承接到真实使用动作。`;
    case 'product_to_cta':
      return `产品定格后进入 CTA 锁定尾帧。`;
    default:
      return `从「${zhRole(from.role)}」镜头以目标品类元素自然承接到「${zhRole(to.role)}」镜头。`;
  }
}

function styleTokens(from: OrchestratedSlot, to: OrchestratedSlot, transitionFunction: string): string[] {
  const tokens = new Set<string>([...(from.motionTokens ?? []), ...(to.motionTokens ?? [])]);
  if (tokens.size === 0) {
    tokens.add(transitionFunction === 'product_to_cta' ? 'clean_hold' : 'match_cut');
  }
  return Array.from(tokens);
}

function matchedAssetId(slot: OrchestratedSlot): string | undefined {
  return slot.fill.kind === 'matched' ? slot.fill.assetId : undefined;
}

function isGap(slot: OrchestratedSlot): boolean {
  return slot.fill.kind === 'gap';
}

/** Real matched footage (the strong tier) — partial assets are "差一点" and don't get a frame bridge. */
function isRealMatched(slot: OrchestratedSlot): boolean {
  return slot.fill.kind === 'matched' && slot.fill.status === 'matched';
}

function humanRole(role: string): string {
  return role.replace(/_/g, ' ');
}

const ZH_ROLE_LABELS: Record<string, string> = {
  opening_attention: '开场吸睛',
  product_closeup: '产品特写',
  usage_demo: '使用演示',
  benefit_visual: '卖点证明',
  comparison: '对比/陈列',
  testimonial: '口碑证言',
  cta_visual: '结尾行动引导',
  instruction_card: '说明卡',
  example_clip: '示例片段',
  technique_demo: '技巧演示'
};

function zhRole(role: string): string {
  return ZH_ROLE_LABELS[role] ?? role.replace(/_/g, ' ');
}
