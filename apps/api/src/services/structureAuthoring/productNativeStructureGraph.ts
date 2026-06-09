import type {
  ContentBrief,
  ProductComplexity,
  ProductFact,
  ProductIntelligence,
  ViralStructureGraph
} from '@viral-struct/shared';
import { ViralStructureGraphSchema } from '@viral-struct/shared';

/**
 * Product-native source structure graph (the "skeleton") generator.
 *
 * THE PROBLEM IT SOLVES: the legacy pipeline borrows a fixed source `ViralStructureGraph` extracted from a
 * MacBook ad. Its slots carry hardware-specific semantics ("keyboard", "side port"), so `decideFillStatus`
 * stamps even perfectly-matched drink/bread assets as `source_specific_not_transferable` — the penalty is on
 * the SOURCE script, not the asset. Swapping the asset library can't fix a skeleton written in MacBook's
 * language.
 *
 * THE FIX: don't borrow a skeleton — synthesize one in the TARGET product's own language. What is "viral and
 * transferable" is the FUNCTIONAL ARC (hook → sensory reveal → benefit proof → usage → social proof → cta),
 * not the surface content. So we keep the proven arc and author every slot from Product Intelligence — which
 * is already an LLM-derived understanding of THIS product. `PI(bread)` yields bread sensory/rituals/benefits,
 * `PI(beverage)` yields beverage ones, so the SAME assembler produces a bread skeleton for bread and a
 * beverage skeleton for beverage — automatically, by input.
 *
 * Deterministic by design (PI did the "understanding"; this just assembles a schema-valid arc). Arc length
 * scales with PI complexity. Exactly the first feature beat carries the 由散到聚 cascade language, so it
 * becomes the single cascade owner downstream (see structuralCompressionPlanner.beatOwnsSensoryCascade).
 */

export interface BuildProductNativeStructureGraphInput {
  contentBrief: ContentBrief;
  productIntelligence: ProductIntelligence;
}

type ArcFunction = 'hook' | 'reveal' | 'benefit' | 'usage' | 'social' | 'cta';

interface ArcStep {
  fn: ArcFunction;
  index: number; // 0-based index within the same function family
}

export function buildProductNativeStructureGraph(input: BuildProductNativeStructureGraphInput): ViralStructureGraph {
  const { contentBrief: brief, productIntelligence: pi } = input;
  const product = pi.productName || brief.productName;
  const steps = planArc(pi);

  const segments: ViralStructureGraph['segments'] = [];
  const shotSlots: ViralStructureGraph['shotSlots'] = [];
  const edges: ViralStructureGraph['edges'] = [];

  let cursorMs = 0;
  steps.forEach((step, i) => {
    const segId = `seg_native_${String(i + 1).padStart(2, '0')}_${step.fn}`;
    const slotId = `slot_native_${String(i + 1).padStart(2, '0')}_${step.fn}`;
    const durSec = DURATION_SEC[step.fn];
    const startSec = cursorMs / 1000;
    const endSec = startSec + durSec;
    cursorMs += durSec * 1000;

    const subject = buildSubject(step, product, pi);
    segments.push({
      id: segId,
      role: SEGMENT_ROLE[step.fn],
      start: round1(startSec),
      end: round1(endSec),
      duration: durSec,
      purpose: buildPurpose(step, product, pi),
      transferRule: `保留「${ARC_LABEL[step.fn]}」的结构功能，用 ${product} 的目标品类原生动作演绎，不照搬任何源产品物体。`,
      importance: IMPORTANCE[step.fn]
    });

    shotSlots.push({
      id: slotId,
      segmentId: segId,
      role: SLOT_ROLE[step.fn],
      requiredAsset: {
        type: 'video',
        subject,
        camera: CAMERA[step.fn],
        motion: MOTION[step.fn],
        minDuration: round1(durSec * 0.5)
      },
      visualIngredientRequirements: VISUAL_INGREDIENTS[step.fn],
      humanRequirement: HUMAN_REQUIREMENT[step.fn],
      fallbackStrategies: FALLBACKS[step.fn],
      importance: IMPORTANCE[step.fn],
      intent: {
        purpose: buildPurpose(step, product, pi),
        energyLevel: ENERGY[step.fn],
        motionPattern: MOTION_PATTERN[step.fn],
        compositionPrincipal: COMPOSITION[step.fn],
        durationMs: [Math.round(durSec * 1000 * 0.6), Math.round(durSec * 1000)]
      },
      sourceInstance: {
        productInSource: product,
        specificAction: buildSpecificAction(step, product, pi)
      },
      acceptanceCriteria: {
        anyOf: [
          {
            motionType: MOTION_PATTERN[step.fn],
            compositionType: COMPOSITION[step.fn],
            examples: buildExamples(step, product, pi)
          }
        ],
        rejectIf: ['画面杂乱有多余干扰元素', '产品被遮挡或无法识别']
      }
    });

    if (i > 0) {
      edges.push({ from: shotSlots[i - 1].id, to: slotId, type: 'sequence' });
    }
  });

  const totalSec = cursorMs / 1000;
  const graph: ViralStructureGraph = {
    schemaVersion: 'v1',
    meta: {
      duration: round1(totalSec),
      aspectRatio: '9:16',
      videoType: 'ecommerce',
      style: pi.targetDurationRecommendation.preferred === 'high_click_15s' ? 'high_click' : 'high_conversion'
    },
    structureSummary:
      `产品原生爆款结构：${product}（${pi.category.value || brief.category || '通用'}）的 ${steps.length} 拍弧线`
      + `（hook→感官reveal→利益证明→使用→社交证明→cta），由 Product Intelligence 派生，全程目标品类原生语言。`,
    segments,
    shotSlots,
    rhythm: {
      avgShotDuration: round1(totalSec / Math.max(1, shotSlots.length)),
      cutFrequency: 'high',
      pattern: 'product_native_canonical_arc'
    },
    packaging: {
      captionDensity: 'medium',
      captionPosition: 'bottom_center',
      titleStyle: 'bold_pop',
      cardTypes: ['hook_card', 'benefit_card', 'cta_card'],
      transitions: ['cut', 'match_cut'],
      coverStyle: 'product_hero'
    },
    creativeIngredients: [],
    edges
  };

  return ViralStructureGraphSchema.parse(graph);
}

// --- arc planning (PI-complexity-driven) ------------------------------------

function planArc(pi: ProductIntelligence): ArcStep[] {
  const featureCap = featureCapFor(pi.complexity); // total feature/benefit beats incl. the reveal
  const usageCount = pi.complexity === 'high_complexity_feature_product' ? 3 : 2;
  const includeSocial =
    pi.socialContexts.length > 0
    || pi.recommendedProofTypes.includes('social_proof')
    || pi.recommendedProofTypes.includes('trust_proof');

  const steps: ArcStep[] = [{ fn: 'hook', index: 0 }];
  // first feature beat = the sensory reveal (cascade owner); the rest = benefit enumeration.
  steps.push({ fn: 'reveal', index: 0 });
  for (let i = 1; i < featureCap; i += 1) steps.push({ fn: 'benefit', index: i - 1 });
  for (let i = 0; i < usageCount; i += 1) steps.push({ fn: 'usage', index: i });
  if (includeSocial) steps.push({ fn: 'social', index: 0 });
  steps.push({ fn: 'cta', index: 0 });
  return steps;
}

function featureCapFor(complexity: ProductComplexity): number {
  if (complexity === 'high_complexity_feature_product') return 4;
  if (complexity === 'medium_complexity_lifestyle_product') return 3;
  return 2; // low_complexity_impulse_product
}

// --- product-native natural language (all sourced from PI) ------------------

function buildSubject(step: ArcStep, product: string, pi: ProductIntelligence): string {
  const sensory = factList(pi.sensoryCues, 3);
  const benefits = factList(pi.coreBenefits, 3);
  const rituals = factList(pi.usageRituals, 3);
  const social = factList(pi.socialContexts, 2);
  switch (step.fn) {
    case 'hook':
      return `${pick(sensory, 0, 2).join('、') || '强感官元素'} 的强冲击快速逼近 ${product}，第一秒制造"想要"的冲动`;
    case 'reveal':
      // The ONLY slot that carries 由散到聚 cascade language → becomes the single cascade owner downstream.
      return `${product} 的感官汇聚揭示：${sensory.join('、') || '感官元素'} 由散到聚围绕产品高速掠入，收束成一次干净利落的 reveal`;
    case 'benefit':
      return `把 ${product} 的核心利益点做感官化证明：${rotate(benefits, step.index).join('、') || '核心卖点'}`;
    case 'usage':
      return `真人完成 ${product} 的真实使用：${rotate(rituals, step.index).join('、') || '拿取、使用、享用'}`;
    case 'social':
      return `${social.join('、') || '日常分享'} 等社交场景，${product} 作为多人共享的中心`;
    case 'cta':
    default:
      return `${product} 包装/外形 hero 收口 + 行动号召`;
  }
}

function buildPurpose(step: ArcStep, product: string, pi: ProductIntelligence): string {
  switch (step.fn) {
    case 'hook':
      return `开场用最强的感官冲击抓住前 3 秒注意力，让观众对 ${product} 产生即时欲望。`;
    case 'reveal':
      return `把分散的感官元素汇聚成对 ${product} 的一次完整 reveal，建立产品识别。`;
    case 'benefit':
      return `用画面证明 ${product} 的核心利益点，把卖点变成可感知的结果。`;
    case 'usage':
      return `展示 ${product} 在真实场景里的使用动作，建立可信度与代入感。`;
    case 'social':
      return `用社交/分享场景为 ${product} 提供社会证明，强化从众与认同。`;
    case 'cta':
    default:
      return `收口到 ${product} 的清晰产品形象与行动号召，引导立即转化。`;
  }
}

function buildSpecificAction(step: ArcStep, product: string, pi: ProductIntelligence): string {
  const rituals = factList(pi.usageRituals, 2);
  switch (step.fn) {
    case 'usage':
      return rotate(rituals, step.index).join('、') || `真实使用 ${product}`;
    case 'reveal':
      return `${factList(pi.sensoryCues, 2).join('、') || '感官元素'} 汇聚到产品`;
    default:
      return `围绕 ${product} 完成「${ARC_LABEL[step.fn]}」`;
  }
}

function buildExamples(step: ArcStep, product: string, pi: ProductIntelligence): string[] {
  switch (step.fn) {
    case 'hook':
      return pick(factList(pi.sensoryCues, 3), 0, 2).map((s) => `${s} 强冲击开场`);
    case 'reveal':
      return [`${factList(pi.sensoryCues, 2).join('、') || '感官元素'} 由散到聚汇聚到产品`, '产品干净利落定格 reveal'];
    case 'benefit':
      return rotate(factList(pi.coreBenefits, 3), step.index).slice(0, 2).map((b) => `${b} 的可视化证明`);
    case 'usage':
      return rotate(factList(pi.usageRituals, 3), step.index).slice(0, 2);
    case 'social':
      return factList(pi.socialContexts, 2).map((s) => `${s} 的多人分享`);
    case 'cta':
    default:
      return [`${product} 产品定格`, '行动号召文案空间'];
  }
}

// --- per-function attributes ------------------------------------------------

const ARC_LABEL: Record<ArcFunction, string> = {
  hook: '开场钩子',
  reveal: '感官汇聚揭示',
  benefit: '利益证明',
  usage: '真实使用',
  social: '社交证明',
  cta: '行动收口'
};

const SEGMENT_ROLE: Record<ArcFunction, ViralStructureGraph['segments'][number]['role']> = {
  hook: 'hook',
  reveal: 'selling_point',
  benefit: 'selling_point',
  usage: 'usage',
  social: 'proof',
  cta: 'cta'
};

const SLOT_ROLE: Record<ArcFunction, ViralStructureGraph['shotSlots'][number]['role']> = {
  hook: 'opening_attention',
  reveal: 'product_closeup',
  benefit: 'benefit_visual',
  usage: 'usage_demo',
  social: 'testimonial',
  cta: 'cta_visual'
};

const DURATION_SEC: Record<ArcFunction, number> = {
  hook: 3,
  reveal: 4,
  benefit: 3,
  usage: 4,
  social: 3,
  cta: 3
};

const IMPORTANCE: Record<ArcFunction, 1 | 2 | 3 | 4 | 5> = {
  hook: 5,
  reveal: 5,
  benefit: 4,
  usage: 4,
  social: 3,
  cta: 4
};

const ENERGY: Record<ArcFunction, 'low' | 'medium' | 'high'> = {
  hook: 'high',
  reveal: 'high',
  benefit: 'medium',
  usage: 'medium',
  social: 'medium',
  cta: 'low'
};

const CAMERA: Record<ArcFunction, 'closeup' | 'medium' | 'wide' | 'macro' | 'unknown'> = {
  hook: 'medium',
  reveal: 'closeup',
  benefit: 'closeup',
  usage: 'medium',
  social: 'wide',
  cta: 'medium'
};

const MOTION: Record<ArcFunction, 'static' | 'push_in' | 'pan' | 'fast_cut' | 'hand_operation' | 'unknown'> = {
  hook: 'fast_cut',
  reveal: 'push_in',
  benefit: 'push_in',
  usage: 'hand_operation',
  social: 'static',
  cta: 'static'
};

const MOTION_PATTERN: Record<ArcFunction, string> = {
  hook: 'high_energy_sensory_entry',
  reveal: 'scatter_to_converge_sensory_reveal',
  benefit: 'benefit_point_surface',
  usage: 'real_hand_usage_action',
  social: 'multi_person_sharing',
  cta: 'product_lockup_hold'
};

const COMPOSITION: Record<ArcFunction, string> = {
  hook: 'centered_subject_high_impact',
  reveal: 'centered_subject_clean_bg',
  benefit: 'product_with_benefit_overlay_space',
  usage: 'hands_and_product_in_frame',
  social: 'group_sharing_scene',
  cta: 'product_center_with_copy_safe_area'
};

const VISUAL_INGREDIENTS: Record<ArcFunction, ViralStructureGraph['shotSlots'][number]['visualIngredientRequirements']> = {
  hook: ['premium_visual', 'clean_background'],
  reveal: ['product_closeup_trait', 'clean_background'],
  benefit: ['product_closeup_trait'],
  usage: ['human_presence', 'hand_demo', 'lifestyle_context'],
  social: ['social_proof', 'lifestyle_context', 'human_presence'],
  cta: ['product_closeup_trait', 'clean_background']
};

const HUMAN_REQUIREMENT: Record<ArcFunction, ViralStructureGraph['shotSlots'][number]['humanRequirement']> = {
  hook: { required: false },
  reveal: { required: false },
  benefit: { required: false },
  usage: { required: true, role: 'hand_only', framing: 'hands', action: 'holding_product' },
  social: { required: true, role: 'user', framing: 'half_body', action: 'holding_product' },
  cta: { required: false }
};

const FALLBACKS: Record<ArcFunction, ViralStructureGraph['shotSlots'][number]['fallbackStrategies']> = {
  hook: ['product_closeup_replacement', 'text_card'],
  reveal: ['product_closeup_replacement', 'reuse_asset'],
  benefit: ['selling_point_card', 'text_card'],
  usage: ['hand_demo', 'product_closeup_replacement'],
  social: ['trust_card', 'reuse_asset'],
  cta: ['cta_card', 'text_card']
};

// --- helpers ----------------------------------------------------------------

function factList(facts: ProductFact[], n: number): string[] {
  return facts.slice(0, n).map((f) => f.value).filter((v) => v && v.trim().length > 0);
}

function pick(values: string[], start: number, end: number): string[] {
  return values.slice(start, end);
}

/** Rotate a list by `offset` so the N-th benefit/usage beat leads with a different fact (avoids dupes). */
function rotate(values: string[], offset: number): string[] {
  if (values.length === 0) return values;
  const k = offset % values.length;
  return [...values.slice(k), ...values.slice(0, k)];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
