import type {
  AssetCard,
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
  /** Share of transitions that prefer hyperframes (default 0.8). At >= 1 even strong pairs stay hyperframes. */
  hyperframesWeight?: number;
}

const STRONG_BRIDGE_FUNCTIONS = new Set(['chaos_to_order', 'ingredient_to_product']);
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
    const transitionFunction = inferTransitionFunction(from.role, to.role);
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
        reason: 'One side is an unfilled gap, so use a simple cut into the next slot rather than a real frame bridge.',
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
          prompt: `仅为生成提示词，非成片。为 ${productName} 生成衔接帧：从「${zhRole(from.role)}」镜头自然承接到「${zhRole(to.role)}」镜头，使用目标品类的元素衔接，不得加入任何品牌、价格或医疗宣称。`,
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
      reason: `Bridge the ${humanRole(from.role)} shot into the ${humanRole(to.role)} shot with a hyperframes card animation.`,
      hyperframes: {
        editingGuidanceNL:
          `以 ${productName} 为主体，从「${zhRole(from.role)}」镜头快速卡点过渡到「${zhRole(to.role)}」镜头`
          + '（卡片擦除/推近衔接）；保持产品标签清晰可见，不加任何未经证实的宣称。',
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

function inferTransitionFunction(fromRole: string, toRole: string): string {
  if (toRole === 'cta' || toRole === 'cta_visual') return 'product_to_cta';
  if (fromRole === 'comparison') return 'product_to_cta';
  if (fromRole === 'usage_demo' && (toRole === 'benefit_visual' || toRole === 'testimonial')) return 'usage_to_benefit';
  if (fromRole === 'opening_attention') return 'ingredient_to_product';
  return 'ingredient_to_product';
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
