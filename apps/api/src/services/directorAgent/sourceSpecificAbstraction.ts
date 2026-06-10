import type { CategoryEquivalentVocabulary, ShotSlotNode, SourceAbstraction, SourceSpecificTransferSubtype, ViralMotifAnnotation } from '@viral-struct/shared';
import { containsSourceSpecificTerm } from '../motifs/motionGrammarSanitizer';

interface SourceSpecificAbstractionInput {
  slot: ShotSlotNode;
  motif?: ViralMotifAnnotation;
  targetCategory?: string;
  vocab: CategoryEquivalentVocabulary;
  sourceBannedTerms: readonly string[];
}

interface SubtypeProfile {
  sourcePattern: string;
  abstractGrammar: string;
}

const PROFILES: Record<SourceSpecificTransferSubtype, SubtypeProfile> = {
  opening_transform: {
    sourcePattern: 'source structure: hero entry and transformation reveal',
    abstractGrammar: 'abstract grammar: rapid entry, state change, first-frame hook, clean product hold'
  },
  interface_detail: {
    sourcePattern: 'source structure: technical detail reveal',
    abstractGrammar: 'abstract grammar: sequential detail scan, tactile close-up, feature-to-texture payoff'
  },
  assembly_detail: {
    sourcePattern: 'source structure: parts converge into a completed reveal',
    abstractGrammar: 'abstract grammar: scattered elements gather, order forms, product payoff holds'
  },
  ui_sequence: {
    sourcePattern: 'source structure: rapid multi-surface information sequence',
    abstractGrammar: 'abstract grammar: sequential cards, fast benefit switching, stable product anchor'
  },
  device_handoff: {
    sourcePattern: 'source structure: one context hands off to another',
    abstractGrammar: 'abstract grammar: object continuity, scene relay, social/usage context expansion'
  },
  cta_lockup: {
    sourcePattern: 'source structure: final product lock-up and action prompt',
    abstractGrammar: 'abstract grammar: lineup, clean end frame, CTA surface, purchase-guidance hold'
  },
  kinetic_assembly_reveal: {
    sourcePattern: 'source structure: kinetic cascade, activation burst, CTA reveal',
    abstractGrammar: 'abstract grammar: cascade, chaos-to-order, activation, spectacle burst, CTA lock-up'
  },
  generic_source_specific: {
    sourcePattern: 'source structure: category-specific feature demonstration',
    abstractGrammar: 'abstract grammar: feature evidence, product-safe reveal, category-native action'
  }
};

export function inferSourceSpecificTransferSubtype(slot: ShotSlotNode, motif?: ViralMotifAnnotation): SourceSpecificTransferSubtype {
  if (motif?.motifType === 'kinetic_assembly_reveal') {
    return 'kinetic_assembly_reveal';
  }

  const text = buildSlotText(slot).toLowerCase();
  if (/from\s*\$|price|pricing|logo|lockup|cta|brand mark|售价|价格|产品名|品牌标识|收尾|购买决策/.test(text) || slot.role === 'cta_visual') {
    return 'cta_lockup';
  }
  if (/cross[-_\s]?device|handoff|airdrop|iphone|map|phone|seamless|隔空投送|手机|地图|跨设备|接力|无缝协同/.test(text)) {
    return 'device_handoff';
  }
  if (/multi[-_\s]?window|ui|app|application|web|browser|editing|training|touchpad|keyboard|应用|界面|多窗口|网页|视频剪辑|训练计划|触控板|键盘/.test(text)) {
    return 'ui_sequence';
  }
  if (/side port|port|interface|camera|lens|module|侧边|接口|摄像头|镜片|边框/.test(text)) {
    return 'interface_detail';
  }
  if (/assembly|assemble|component|grille|chip|parts|module|color switch|部件|归位|组装|格栅|芯片|多配色/.test(text)) {
    return 'assembly_detail';
  }
  if (/opening|hero|presenting|transform|screen opening|color transform|开场|拿出|悬浮|色彩渐变|完整亮相|打开屏幕|首次/.test(text)) {
    return 'opening_transform';
  }
  return 'generic_source_specific';
}

export function buildSourceAbstraction(input: SourceSpecificAbstractionInput): SourceAbstraction | undefined {
  if (!input.motif && !containsSourceSpecificTerm(buildSlotText(input.slot), input.sourceBannedTerms)) {
    return undefined;
  }
  const subtype = inferSourceSpecificTransferSubtype(input.slot, input.motif);
  const profile = PROFILES[subtype];
  const equivalent = input.vocab.bySubtype[subtype]!;
  const targetCategory = input.targetCategory ?? input.motif?.targetCategoryMapping.targetCategory ?? 'generic';
  return {
    sourceSpecific: true,
    subtype,
    sourcePattern: profile.sourcePattern,
    abstractGrammar: profile.abstractGrammar,
    targetEquivalentLabel: equivalent.label,
    targetEquivalentActions: equivalent.actions,
    rationale: `keep the ${subtype} structural grammar; express it as ${input.vocab.product} 本品类等价动作. Target category: ${targetCategory}.`
  };
}

export function sourceSpecificProfile(subtype: SourceSpecificTransferSubtype): SubtypeProfile {
  return PROFILES[subtype];
}

function buildSlotText(slot: ShotSlotNode): string {
  return [
    slot.requiredAsset.subject,
    slot.requiredAsset.motion,
    slot.intent?.purpose,
    slot.intent?.motionPattern,
    slot.intent?.compositionPrincipal,
    slot.sourceInstance?.specificAction
  ]
    .filter(Boolean)
    .join(' ');
}
