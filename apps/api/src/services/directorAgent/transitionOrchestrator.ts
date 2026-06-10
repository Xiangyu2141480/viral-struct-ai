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

export interface PlanTransitionArgs {
  id: string;
  from: OrchestratedSlot;
  to: OrchestratedSlot;
  productName: string;
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
  return slots.slice(0, -1).map((from, index) => planTransition({
    id: `transition_${String(index + 1).padStart(3, '0')}`,
    from,
    to: slots[index + 1],
    productName: args.contentBrief.productName,
    hyperframesWeight: weight
  }));
}

export function planTransition(args: PlanTransitionArgs): OrchestratedTransition {
  const { id, from, to, productName } = args;
  const weight = args.hyperframesWeight ?? DEFAULT_HYPERFRAMES_TRANSITION_WEIGHT;
  const transitionFunction = inferTransitionFunction(from, to);
  const requiredAssets = [matchedAssetId(from), matchedAssetId(to)].filter((value): value is string => Boolean(value));
  const missingAssets = [from, to].filter(isGap).map((slot) => `${slot.slotId} asset`);
  const assetSupport = classifyAssetSupport(from, to);

  if (isGap(from) || isGap(to)) {
    const visualAction = `用干净切换从「${zhRole(from.role)}」进入「${zhRole(to.role)}」，缺口段由后续补拍、AIGC 或 HyperFrames 方案补齐。`;
    return {
      id,
      fromSlotId: from.slotId,
      toSlotId: to.slotId,
      mode: 'cut',
      implementationMode: 'cut_only',
      assetSupport,
      confidence: 0.62,
      whyThisMode: '相邻槽位至少一侧还没有可用真实素材，直接帧桥接会误导，所以先用可执行的干净切换保住节奏。',
      whyNot: ['不使用 AIGC frame bridge：缺少一侧真实首尾帧。', '不使用复杂转场：会掩盖当前素材缺口。'],
      missingTransitionAssets: missingAssets,
      visualAction,
      fallbackStrategy: '若后续补齐缺口素材，可升级为 HyperFrames 衔接或 0.5 秒 frame bridge；当前保持 plan-only cut。',
      transitionFunction,
      preferredImplementation: 'hyperframes',
      reason: '一侧仍是缺口，因此用干净切换进入下一槽位，不做真实帧桥接。',
      requiredAssets,
      missingAssets,
      riskNotes: ['转场计划已生成；该段等待素材补齐后执行。']
    };
  }

  // §7 rule 3: a real frame bridge needs BOTH sides to be real `matched` footage (not partial),
  // AND a motif that needs frame continuity. Everything else stays on the hyperframes default.
  if (allowsFrameBridge(weight) && isRealMatched(from) && isRealMatched(to) && needsRealFrameBridge(from, to, transitionFunction)) {
    const visualAction = transitionPrompt(transitionFunction, from, to);
    return {
      id,
      fromSlotId: from.slotId,
      toSlotId: to.slotId,
      mode: 'aigc_frame_bridge',
      implementationMode: 'external_generation_job_card',
      assetSupport,
      confidence: 0.76,
      whyThisMode: '两侧都是真实匹配素材，且运动语法需要连续帧承接，因此生成一个可选的转场衔接帧任务卡。',
      whyNot: ['不直接渲染：当前 Director 只输出计划。', '不使用纯 cut：会削弱级联/由散到聚的运动连续性。'],
      missingTransitionAssets: [],
      visualAction,
      fallbackStrategy: '如果外部转场帧不执行，回退为 HyperFrames 冷雾/擦除衔接。',
      transitionFunction,
      preferredImplementation: 'external_generation',
      reason: '两侧都有真实素材，使用 0.5 秒冰爽衔接帧保持运动连续。',
      aigcFrameBridge: {
        fromTailFrameRef: `required: extract tail frame from ${from.slotId}`,
        toHeadFrameRef: `required: extract head frame from ${to.slotId}`,
        prompt:
          `竖屏 9:16，0.5 秒转场衔接帧，主体产品：${productName}。${visualAction}`,
        negativePrompt: SAFE_NEGATIVE_PROMPT_ZH,
        durationMs: 500,
        ownership: 'external_generation_job_card_only'
      },
      requiredAssets,
      missingAssets,
      riskNotes: [
        '转场衔接帧任务卡已生成；当前不执行外部生成。',
        '渲染前需要抽取前后镜头首尾帧。'
      ]
    };
  }

  const visualAction = `${transitionGuidance(transitionFunction, productName, from, to)}保持产品标签清晰可见，节奏干净。`;
  const whyNot = ['不使用 AIGC frame bridge：该 pair 不同时满足两侧 fully matched + 强运动连续性。'];
  if (hasPartialSupport(from) || hasPartialSupport(to)) {
    whyNot.push('不标记为 fully satisfied：至少一侧仍需要卡片、字幕或动效增强。');
  }
  return {
    id,
    fromSlotId: from.slotId,
    toSlotId: to.slotId,
    mode: 'hyperframes',
    implementationMode: 'hyperframes',
    assetSupport,
    confidence: hasPartialSupport(from) || hasPartialSupport(to) ? 0.72 : 0.84,
    whyThisMode: '已有真实素材可作为主画面或参考，但转场仍需要标题卡、擦除、冷雾或卖点卡增强来承接结构。',
    whyNot,
    missingTransitionAssets: [],
    visualAction,
    fallbackStrategy: '若动效执行不可用，退化为 match cut / clean cut，同时保留字幕和卖点卡片。',
    transitionFunction,
    preferredImplementation: 'hyperframes',
    reason: `用语义转场把「${zhRole(from.role)}」承接到「${zhRole(to.role)}」，保留结构节奏但不复制源画面。`,
    hyperframes: {
      editingGuidanceNL: visualAction,
      durationMs: 400,
      styleTokens: styleTokens(from, to, transitionFunction)
    },
    requiredAssets,
    missingAssets,
    riskNotes: ['转场计划已生成；实际渲染由后续执行层处理。']
  };
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

function transitionGuidance(functionName: string, productName: string, from: OrchestratedSlot, to: OrchestratedSlot): string {
  switch (functionName) {
    case 'opening_to_product':
      return `以 ${productName} 为主体，用热浪破碎或冷雾擦除从「${zhRole(from.role)}」转场到「${zhRole(to.role)}」，前 0.4 秒快速推近产品。`;
    case 'product_to_usage':
      return `以 ${productName} 为主体，用开盖声点、瓶身轻转或手部动作触发，从产品特写承接到真实使用动作。`;
    case 'usage_to_benefit':
      return `把使用动作的末帧接到卖点证明，用冷凝水擦除、红茶水滴或利益点卡片落下完成转场。`;
    case 'benefit_to_usage':
      return `让卖点卡下落或侧滑，露出下一段真实使用动作，保留节奏但降低字幕压力。`;
    case 'motif_assembly_bridge':
      return `迁移级联组装语法：冰块、柠檬片、红茶水滴由散到聚，冷雾爆发后承接到「${zhRole(to.role)}」镜头。`;
    case 'product_to_cta':
      return `用冷雾散开、产品定格和 CTA 锁定，把前一镜头收束到结尾行动引导。`;
    case 'cta_lockup':
      return `保持产品轻微弹动后稳定在 CTA 尾帧，形成干净收口。`;
    case 'proof_to_cta':
      return `从证明或对比段落用分屏合拢转场到 CTA 尾帧，形成清晰收口。`;
    default:
      return `用干净切换或轻微擦除从「${zhRole(from.role)}」承接到「${zhRole(to.role)}」。`;
  }
}

function transitionPrompt(functionName: string, from: OrchestratedSlot, to: OrchestratedSlot): string {
  switch (functionName) {
    case 'motif_assembly_bridge':
      return `冰块、柠檬片、红茶水滴和冷雾从上一镜头级联汇聚，形成由散到聚的冰爽转场，再自然进入「${zhRole(to.role)}」镜头。`;
    case 'opening_to_product':
      return `热浪被冰雾击碎，露出清晰产品主体，并自然进入「${zhRole(to.role)}」镜头。`;
    case 'product_to_usage':
      return `瓶身轻转或开盖动作触发画面切换，承接到真实使用动作。`;
    case 'product_to_cta':
      return `冷雾散开后产品定格，进入 CTA 锁定尾帧。`;
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

function hasPartialSupport(slot: OrchestratedSlot): boolean {
  return slot.fill.kind === 'matched' && (slot.fill.status === 'partial' || slot.fillStatus !== 'matched');
}

function classifyAssetSupport(from: OrchestratedSlot, to: OrchestratedSlot): string {
  if (isGap(from) || isGap(to)) return 'gap_or_missing_side';
  if (isRealMatched(from) && isRealMatched(to)) return 'real_asset_primary';
  if (hasPartialSupport(from) || hasPartialSupport(to)) return 'partial_asset_support';
  return 'asset_support_uncertain';
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
