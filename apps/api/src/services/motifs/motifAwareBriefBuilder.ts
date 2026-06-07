import type {
  AigcGenerationBrief,
  ContentBrief,
  HyperframesFallbackBrief,
  ManualShootBrief,
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
  if (input.motif.motifType !== 'kinetic_assembly_reveal') {
    return undefined;
  }

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
      safetyNotes: [
        'This is a motif-aware Asset Manager handoff brief only.',
        'It transfers motion grammar, not source objects or source product identity.',
        'No external generation call is made by Asset Manager.'
      ]
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
