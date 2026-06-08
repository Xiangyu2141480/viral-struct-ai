import type {
  AigcGenerationBrief,
  ContentBrief,
  HyperframesFallbackBrief,
  ManualShootBrief,
  MotifType,
  ViralMotifAnnotation
} from '@viral-struct/shared';
import type { CategoryPreset } from './categoryPresetProvider';

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
  categoryPreset?: CategoryPreset;
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
    shotCore: 'ice cubes, lemon slices and tea droplets fall from above and converge around the beverage bottle, settling from a scattered state into an ordered cold tableau',
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
    shotCore: 'ice cubes, lemon slices and tea droplets morph and flow together and transform into the poured beverage with cold mist around the bottle',
    durationSec: 5,
    mustCapture: ['ingredients enter and morph', 'flow into the drink', 'tea pour with cold mist', 'product visible through the transformation'],
    extraProps: ['ice cubes', 'lemon slices', 'clear cup'],
    cardType: 'benefit_card',
    copyVerb: 'Show an ingredient-to-drink transformation',
    hyperVisualElements: ['ice cubes', 'lemon slices', 'tea droplets', 'cold mist', 'pour stream'],
    hyperAnimationHints: ['ingredients morph and flow', 'pour reveal of the beverage', 'cold mist trail behind product'],
    hyperDurationSec: 4
  },
  kinetic_product_reveal: {
    shootTitle: '补拍产品运动揭晓素材',
    objective: '用产品整体运动（旋转/推近）揭晓标签与冷凝水，收束到干净产品定格。',
    shotCore: 'the beverage bottle rotates while the camera pushes in to reveal the label and condensation, then resolves into a clean product hold',
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
    shotCore: 'two or three beverage bottles line up and the camera sweeps laterally, settling into a clean pack lockup with a CTA safe area',
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
    shotCore: 'an ice cube drop or cap tap lands as an impact beat and triggers a cold mist activation around the beverage bottle',
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
    shotCore: 'the beverage bottle and ice cubes enter the frame with energy from above with a quick push-in, as a high-energy opening hook',
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
    shotCore: 'a benefit card drops over the beverage bottle and animates around the selling point, finishing on a clean CTA lock-up',
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
  const preset = buildPresetPromptParts(input, spec.hyperVisualElements);
  const productName = input.contentBrief?.productName ?? preset.productLabel;
  const sellingPoint = input.contentBrief?.sellingPoints[0] ?? 'refreshing cold taste';
  const cta = input.contentBrief?.cta ?? 'clear CTA lock-up';
  const referenceAssetIds = input.referenceAssetIds ?? [];
  const shotCore = preset.shotCore ?? spec.shotCore;
  const targetObjects = preset.targetObjects.length ? preset.targetObjects : spec.extraProps;
  const targetActions = preset.targetActions.length ? preset.targetActions : spec.mustCapture;
  const visualElements = preset.visualElements.length ? preset.visualElements : spec.hyperVisualElements;

  return {
    manualShootBrief: {
      title: spec.shootTitle,
      objective: spec.objective,
      shotDescription: `Shoot ${spec.durationSec}s of ${productName}: ${shotCore}.`,
      durationSec: spec.durationSec,
      framing: 'vertical 9:16, product-safe, label readable, hand-only or product-only',
      requiredProps: unique([productName, ...BASE_PROPS, ...targetObjects, ...(input.categoryPreset?.requiredAssets ?? [])]),
      mustCapture: unique(targetActions),
      avoid: AVOID_LIST
    },
    aigcGenerationBrief: {
      providerHint: 'seedance',
      prompt: [
        'Prompt brief only, not rendered output.',
        `Create a vertical 9:16 ${preset.category}-native shot for ${productName}:`,
        `${shotCore}.`,
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
      visualElements: unique([productName, ...visualElements]),
      animationHints: unique([...targetActions.slice(0, 4), ...spec.hyperAnimationHints]),
      durationSec: spec.hyperDurationSec,
      inputAssets: referenceAssetIds
    }
  };
}

function buildKineticAssemblyBriefs(input: BuildMotifAwareBriefsInput): MotifAwareBriefs {
  const preset = buildPresetPromptParts(input, [
    'ice cubes',
    'lemon slices',
    'tea droplets',
    'cold mist',
    'benefit card drop',
    'CTA lock-up'
  ]);
  const productName = input.contentBrief?.productName ?? preset.productLabel;
  const sellingPoint = input.contentBrief?.sellingPoints[0] ?? 'refreshing cold taste';
  const cta = input.contentBrief?.cta ?? 'clear CTA lock-up';
  const referenceAssetIds = input.referenceAssetIds ?? [];
  const legacyBeverageFallback = input.categoryPreset ? [] : [
    'ice cubes',
    'lemon slices',
    'clear cup',
    'cold detail background',
    'clean CTA end frame surface'
  ];
  const legacyVisualFallback = input.categoryPreset ? [] : [
    'ice cubes',
    'lemon slices',
    'tea droplets',
    'cold mist',
    'benefit card drop',
    'CTA lock-up'
  ];
  const targetObjects = preset.targetObjects.length
    ? preset.targetObjects
    : legacyBeverageFallback;
  const targetActions = preset.targetActions.length
    ? preset.targetActions
    : ['ice drop', 'cap opening', 'pour to cup', 'cold detail with droplets or mist', 'clean CTA end frame'];
  const visualElements = preset.visualElements.length
    ? preset.visualElements
    : legacyVisualFallback;
  const shotCore = preset.shotCore
    ?? 'Use ice cubes, lemon slices, tea droplets, and cold mist as a chaos-to-order ingredient cascade. Show cap opening or pour to cup as the interaction activation moment. Add a cold splash or mist spectacle burst, then finish on a clean CTA lock-up';

  return {
    manualShootBrief: {
      title: '补拍动势组装感饮料素材',
      objective: '保留 chaos-to-order / assembly / activation / spectacle / CTA 结构，但全部替换为饮料语境动作。',
      shotDescription: [
        `Shoot 4-6 seconds of ${productName} in a vertical ${preset.category}-native kinetic reveal.`,
        shotCore
      ].join(' '),
      durationSec: 5,
      framing: 'vertical 9:16, hand-only or product-only, label readable before final lock-up',
      requiredProps: unique([
        productName,
        ...legacyBeverageFallback,
        ...targetObjects,
        ...(input.categoryPreset?.requiredAssets ?? [])
      ]),
      mustCapture: unique(targetActions),
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
        `Create a vertical 9:16 ${preset.category}-native kinetic assembly reveal for ${productName}.`,
        `${shotCore}.`,
        `Preserve the abstract grammar: component cascade, chaos-to-order, activation, spectacle burst, and CTA reveal.`,
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
      title: `Kinetic ${preset.category} benefit card drop`,
      cardType: 'benefit_card',
      copyIntent: `Use a HyperFrames benefit card drop to preserve assembly/activation energy around ${sellingPoint}, ending with ${cta}.`,
      visualElements: unique([
        productName,
        ...legacyVisualFallback,
        ...visualElements
      ]),
      animationHints: unique([
        'ingredient cascade enters frame',
        'benefit card drops on impact beat',
        'cold mist burst behind product',
        'final clean CTA hold',
        ...targetActions.slice(0, 4)
      ]),
      durationSec: 4,
      inputAssets: referenceAssetIds
    }
  };
}

function buildPresetPromptParts(input: BuildMotifAwareBriefsInput, fallbackVisualElements: string[]): {
  category: string;
  productLabel: string;
  targetObjects: string[];
  targetActions: string[];
  visualElements: string[];
  shotCore?: string;
} {
  const preset = input.categoryPreset;
  const category = preset?.category ?? 'beverage';
  const motifEquivalents = preset?.motifEquivalents[input.motif.motifType] ?? [];
  const targetObjects = unique([
    ...motifEquivalents,
    ...(preset?.objects ?? [])
  ]).slice(0, 8);
  const targetActions = unique([
    ...(preset?.actions ?? []),
    ...motifEquivalents
  ]).slice(0, 8);
  const visualElements = unique([
    ...targetObjects,
    ...fallbackVisualElements
  ]).slice(0, 10);

  if (!preset) {
    return {
      category,
      productLabel: 'new beverage product',
      targetObjects,
      targetActions,
      visualElements
    };
  }

  const cascade = targetObjects.slice(0, 4).join(', ') || 'category-native objects';
  const activation = targetActions.slice(0, 3).join(', ') || 'category-native activation';
  const sensory = preset.sensoryKeywords.slice(0, 3).join(', ');
  return {
    category,
    productLabel: `${category} product`,
    targetObjects,
    targetActions,
    visualElements,
    shotCore: [
      `${cascade} form a chaos-to-order cascade`,
      `${activation} becomes the activation beat`,
      sensory ? `sensory cues: ${sensory}` : undefined,
      'finish on a clean CTA lock-up'
    ].filter(Boolean).join('; ')
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
