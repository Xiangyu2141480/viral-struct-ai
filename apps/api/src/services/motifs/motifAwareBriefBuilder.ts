import type {
  AigcGenerationBrief,
  ContentBrief,
  HyperframesFallbackBrief,
  ManualShootBrief,
  MotifType,
  ViralMotifAnnotation
} from '@viral-struct/shared';

const MOTIF_NEGATIVE_PROMPT = [
  'no keyboard',
  'no laptop',
  'no touchpad',
  'no rocket',
  'no hardware',
  'no MacBook',
  'no Apple visual identity',
  'no copied source layout',
  'no watermark',
  'no celebrity',
  'no medical claims',
  'do not alter the product packaging or label'
].join(', ');

const SAFETY_NOTES = [
  'This is a motif-aware Asset Manager handoff brief only.',
  'It transfers motion grammar, not source objects or source product identity.',
  'No external generation call is made by Asset Manager.'
];

const AVOID_LIST = [
  'keyboard',
  'laptop',
  'touchpad',
  'rocket',
  'hardware',
  'MacBook or Apple visual identity',
  'unverified price or medical claims'
];

const BASE_PROPS = ['phone camera', 'clean vertical background'];

export interface BuildMotifAwareBriefsInput {
  motif: ViralMotifAnnotation;
  contentBrief?: ContentBrief;
  referenceAssetIds?: string[];
}

export interface MotifAwareBriefs {
  manualShootBrief: ManualShootBrief;
  aigcGenerationBrief: AigcGenerationBrief;
  hyperframesBrief: HyperframesFallbackBrief;
}

export function buildMotifAwareBriefs(input: BuildMotifAwareBriefsInput): MotifAwareBriefs | undefined {
  // kinetic_assembly_reveal keeps its original, test-pinned output verbatim.
  if (input.motif.motifType === 'kinetic_assembly_reveal') {
    return buildKineticAssemblyBriefs(input);
  }
  // Every other producing motif is assembled from a beverage-native spec. Adding
  // a new motif's brief = add one MOTIF_BRIEF_SPECS entry (the "new entry" hook).
  // `category_usage_moment` has no spec on purpose: ordinary usage falls back to
  // the existing plain brief path (the extractor never emits it as an annotation).
  const spec = MOTIF_BRIEF_SPECS[input.motif.motifType];
  return spec ? buildFromSpec(input, spec) : undefined;
}

// ---------------------------------------------------------------------------
// Spec-driven builder for the non-kinetic motifs.
// ---------------------------------------------------------------------------

interface MotifBriefSpec {
  shootTitle: string;
  objective: string;
  /** Beverage-native recipe sentence; reused in shotDescription + aigc prompt. */
  shotCore: string;
  durationSec: number;
  mustCapture: string[];
  extraProps: string[];
  cardType: HyperframesFallbackBrief['cardType'];
  copyVerb: string;
  hyperVisualElements: string[];
  hyperAnimationHints: string[];
  hyperDurationSec: number;
}

const MOTIF_BRIEF_SPECS: Partial<Record<MotifType, MotifBriefSpec>> = {
  surreal_assembly: {
    shootTitle: '补拍超现实原料聚合素材',
    objective: '保留"部件坠落→收束成形"的运动逻辑，替换为饮料原料的有序聚合（无需交互/CTA payoff）。',
    shotCore: 'ice cubes, lemon slices and tea droplets fall from above and converge around the iced tea bottle, settling from a scattered state into an ordered cold tableau',
    durationSec: 5,
    mustCapture: ['ingredients fall from above', 'elements converge around the bottle', 'ordered cold tableau forms', 'clean settle on product'],
    extraProps: ['ice cubes', 'lemon slices', 'clear cup'],
    cardType: 'benefit_card',
    copyVerb: 'Animate a beverage ingredient convergence',
    hyperVisualElements: ['ice cubes', 'lemon slices', 'tea droplets', 'converging frame'],
    hyperAnimationHints: ['ingredients fall and orbit the bottle', 'elements snap into an ordered frame', 'clean settle on product'],
    hyperDurationSec: 4
  },
  ingredient_transformation: {
    shootTitle: '补拍原料变换/流动汇聚素材',
    objective: '把"组装/变形"翻译为饮料原料的变换与流动，最终汇聚成饮用状态。',
    shotCore: 'ice cubes, lemon slices and tea droplets morph and flow together and transform into the poured iced tea with cold mist around the bottle',
    durationSec: 5,
    mustCapture: ['ingredients enter and morph', 'flow into the drink', 'tea pour with cold mist', 'product visible through the transformation'],
    extraProps: ['ice cubes', 'lemon slices', 'clear cup'],
    cardType: 'benefit_card',
    copyVerb: 'Show an ingredient-to-drink transformation',
    hyperVisualElements: ['ice cubes', 'lemon slices', 'tea droplets', 'cold mist', 'pour stream'],
    hyperAnimationHints: ['ingredients morph and flow', 'pour reveal of the iced tea', 'cold mist trail behind product'],
    hyperDurationSec: 4
  },
  kinetic_product_reveal: {
    shootTitle: '补拍产品运动揭晓素材',
    objective: '用产品整体运动（旋转/推近）揭晓标签与冷凝水，收束到干净产品定格。',
    shotCore: 'the iced tea bottle rotates while the camera pushes in to reveal the label and condensation, then resolves into a clean product hold',
    durationSec: 4,
    mustCapture: ['bottle rotation or push-in', 'label and condensation detail', 'clean product hold'],
    extraProps: ['cold detail background'],
    cardType: 'hook_card',
    copyVerb: 'Reveal the product with a clean rotation',
    hyperVisualElements: ['rotating bottle', 'condensation highlight', 'clean hold frame'],
    hyperAnimationHints: ['bottle rotates', 'push-in on the label', 'clean product hold'],
    hyperDurationSec: 4
  },
  lineup_lockup: {
    shootTitle: '补拍产品阵列横扫+锁定素材',
    objective: '用产品阵列横移收束到干净的成组锁定与 CTA。',
    shotCore: 'two or three iced tea bottles line up and the camera sweeps laterally, settling into a clean pack lockup with a CTA safe area',
    durationSec: 5,
    mustCapture: ['bottle lineup', 'lateral sweep', 'clean pack lockup', 'CTA safe area'],
    extraProps: ['multiple bottles', 'clean CTA end frame surface'],
    cardType: 'cta_card',
    copyVerb: 'Lock up a clean product lineup',
    hyperVisualElements: ['bottle lineup', 'lateral sweep', 'CTA lock-up'],
    hyperAnimationHints: ['lineup sweeps across frame', 'settles into a clean pack', 'CTA card locks in'],
    hyperDurationSec: 4
  },
  impact_activation: {
    shootTitle: '补拍撞击触发冷感激活素材',
    objective: '用一次撞击/节拍触发饮料的冷感激活（冰雾/水花）。',
    shotCore: 'an ice cube drop or cap tap lands as an impact beat and triggers a cold mist activation around the iced tea bottle',
    durationSec: 4,
    mustCapture: ['impact beat (ice drop or cap tap)', 'cold mist activation', 'product stays centered'],
    extraProps: ['ice cubes', 'cold mist'],
    cardType: 'benefit_card',
    copyVerb: 'Trigger a cold activation on an impact beat',
    hyperVisualElements: ['ice drop', 'impact ring', 'cold mist burst'],
    hyperAnimationHints: ['ice drops on the beat', 'cold mist bursts behind product', 'clean hold'],
    hyperDurationSec: 4
  },
  dynamic_entry: {
    shootTitle: '补拍高能产品入场 hook 素材',
    objective: '用高能入场（自上而下/推近）建立开场注意力锚点。',
    shotCore: 'the iced tea bottle and ice cubes enter the frame with energy from above with a quick push-in, as a high-energy opening hook',
    durationSec: 3,
    mustCapture: ['energetic entry from above', 'ice accompanies the entry', 'product centered quickly'],
    extraProps: ['ice cubes'],
    cardType: 'hook_card',
    copyVerb: 'Open with a high-energy product entry',
    hyperVisualElements: ['bottle entry', 'ice drop-in', 'push-in'],
    hyperAnimationHints: ['product enters with energy', 'ice drops in', 'quick push-in onto product'],
    hyperDurationSec: 3
  },
  benefit_card_motion: {
    shootTitle: '补拍/生成卖点卡动效素材',
    objective: '用卖点卡动效承接缺失动作，收束到干净 CTA（HyperFrames 原生，无需实拍）。',
    shotCore: 'a benefit card drops over the iced tea bottle and animates around the selling point, finishing on a clean CTA lock-up',
    durationSec: 4,
    mustCapture: ['benefit card drop', 'animated selling-point copy', 'clean CTA hold'],
    extraProps: ['benefit card surface', 'clean CTA end frame surface'],
    cardType: 'benefit_card',
    copyVerb: 'Animate a benefit card',
    hyperVisualElements: ['benefit card drop', 'selling-point copy', 'CTA lock-up'],
    hyperAnimationHints: ['benefit card drops in', 'selling-point copy animates', 'CTA holds clean'],
    hyperDurationSec: 4
  }
};

function buildFromSpec(input: BuildMotifAwareBriefsInput, spec: MotifBriefSpec): MotifAwareBriefs {
  const productName = input.contentBrief?.productName ?? 'new beverage product';
  const sellingPoint = input.contentBrief?.sellingPoints[0] ?? 'refreshing cold taste';
  const cta = input.contentBrief?.cta ?? 'clear CTA lock-up';
  const referenceAssetIds = input.referenceAssetIds ?? [];

  return {
    manualShootBrief: {
      title: spec.shootTitle,
      objective: spec.objective,
      shotDescription: `Shoot ${spec.durationSec}s of ${productName}: ${spec.shotCore}.`,
      durationSec: spec.durationSec,
      framing: 'vertical 9:16, product-safe, label readable, hand-only or product-only',
      requiredProps: [productName, ...BASE_PROPS, ...spec.extraProps],
      mustCapture: spec.mustCapture,
      avoid: AVOID_LIST
    },
    aigcGenerationBrief: {
      providerHint: 'seedance',
      prompt: [
        'Prompt brief only, not rendered output.',
        `Create a vertical 9:16 beverage-native shot for ${productName}:`,
        `${spec.shotCore}.`,
        `Keep claims limited to: ${sellingPoint}.`,
        `CTA intent: ${cta}.`
      ].join(' '),
      negativePrompt: MOTIF_NEGATIVE_PROMPT,
      referenceAssetIds,
      expectedDurationSec: spec.durationSec,
      aspectRatio: '9:16',
      safetyNotes: SAFETY_NOTES
    },
    hyperframesBrief: {
      title: spec.shootTitle,
      cardType: spec.cardType,
      copyIntent: `${spec.copyVerb} around ${sellingPoint}, ending with ${cta}.`,
      visualElements: [productName, ...spec.hyperVisualElements],
      animationHints: spec.hyperAnimationHints,
      durationSec: spec.hyperDurationSec,
      inputAssets: referenceAssetIds
    }
  };
}

function buildKineticAssemblyBriefs(input: BuildMotifAwareBriefsInput): MotifAwareBriefs {
  const productName = input.contentBrief?.productName ?? 'new beverage product';
  const sellingPoint = input.contentBrief?.sellingPoints[0] ?? 'refreshing cold taste';
  const cta = input.contentBrief?.cta ?? 'clear CTA lock-up';
  const referenceAssetIds = input.referenceAssetIds ?? [];

  return {
    manualShootBrief: {
      title: '补拍动势组装感饮料素材',
      objective: '保留 chaos-to-order / assembly / activation / spectacle / CTA 结构，但全部替换为饮料语境动作。',
      shotDescription: [
        `Shoot 4-6 seconds of ${productName} in a vertical beverage-native kinetic reveal.`,
        'Start with ice drop or lemon/tea-droplet cascade, move into cap opening or pour activation, then resolve into cold detail and clean CTA end frame.'
      ].join(' '),
      durationSec: 5,
      framing: 'vertical 9:16, hand-only or product-only, label readable before final lock-up',
      requiredProps: [
        productName,
        'ice cubes',
        'lemon slices',
        'clear cup',
        'cold detail background',
        'clean CTA end frame surface'
      ],
      mustCapture: [
        'ice drop',
        'cap opening',
        'pour to cup',
        'cold detail with droplets or mist',
        'clean CTA end frame'
      ],
      avoid: [
        'keyboard',
        'laptop',
        'touchpad',
        'rocket',
        'hardware',
        'MacBook or Apple visual identity',
        'unverified price or medical claims'
      ]
    },
    aigcGenerationBrief: {
      providerHint: 'seedance',
      prompt: [
        `Prompt brief only, not rendered output.`,
        `Create a vertical 9:16 beverage-native kinetic assembly reveal for ${productName}.`,
        `Use ice cubes, lemon slices, tea droplets, and cold mist as a chaos-to-order ingredient cascade.`,
        `Show cap opening or pour to cup as the interaction activation moment.`,
        `Add a cold splash or mist spectacle burst, then finish on a clean CTA lock-up.`,
        `Keep claims limited to: ${sellingPoint}.`,
        `CTA intent: ${cta}.`
      ].join(' '),
      negativePrompt: MOTIF_NEGATIVE_PROMPT,
      referenceAssetIds,
      expectedDurationSec: 5,
      aspectRatio: '9:16',
      safetyNotes: SAFETY_NOTES
    },
    hyperframesBrief: {
      title: 'Kinetic beverage benefit card drop',
      cardType: 'benefit_card',
      copyIntent: `Use a HyperFrames benefit card drop to preserve assembly/activation energy around ${sellingPoint}, ending with ${cta}.`,
      visualElements: [
        productName,
        'ice cubes',
        'lemon slices',
        'tea droplets',
        'cold mist',
        'benefit card drop',
        'CTA lock-up'
      ],
      animationHints: [
        'ingredient cascade enters frame',
        'benefit card drops on impact beat',
        'cold mist burst behind product',
        'final clean CTA hold'
      ],
      durationSec: 4,
      inputAssets: referenceAssetIds
    }
  };
}
