import type { ShotSlotNode, SourceAbstraction, SourceSpecificTransferSubtype, ViralMotifAnnotation } from '@viral-struct/shared';
import { containsSourceSpecificTerm } from '../motifs/motionGrammarSanitizer';

interface SourceSpecificAbstractionInput {
  slot: ShotSlotNode;
  motif?: ViralMotifAnnotation;
  targetCategory?: string;
}

interface SubtypeProfile {
  sourcePattern: string;
  abstractGrammar: string;
  targetEquivalentLabel: string;
  targetEquivalentActions: string[];
  rationale: string;
}

const PROFILES: Record<SourceSpecificTransferSubtype, SubtypeProfile> = {
  opening_transform: {
    sourcePattern: 'source structure: hero entry and transformation reveal',
    abstractGrammar: 'abstract grammar: rapid entry, state change, first-frame hook, clean product hold',
    targetEquivalentLabel: '冰爽英雄入场',
    targetEquivalentActions: ['热浪破开', '冰块擦屏', '产品英雄亮相', '强 hook 标题定格'],
    rationale: 'target beverage equivalent: keep the opening shock and transformation rhythm, replace source-device behavior with cold-refresh entry cues.'
  },
  interface_detail: {
    sourcePattern: 'source structure: technical detail reveal',
    abstractGrammar: 'abstract grammar: sequential detail scan, tactile close-up, feature-to-texture payoff',
    targetEquivalentLabel: '瓶身细节扫光',
    targetEquivalentActions: ['瓶盖特写', '标签扫光', '冷凝水擦除', '瓶身微距', '茶色流动'],
    rationale: 'target beverage equivalent: keep the detail-tour structure, move the evidence to packaging, condensation, label, and drink texture.'
  },
  assembly_detail: {
    sourcePattern: 'source structure: parts converge into a completed reveal',
    abstractGrammar: 'abstract grammar: scattered elements gather, order forms, product payoff holds',
    targetEquivalentLabel: '冰柠元素汇聚',
    targetEquivalentActions: ['冰块汇聚', '柠檬片扫过', '茶滴环绕', '冷雾出现', '产品定格'],
    rationale: 'target beverage equivalent: keep chaos-to-order assembly, use ingredient and coldness cues instead of source-product components.'
  },
  ui_sequence: {
    sourcePattern: 'source structure: rapid multi-surface information sequence',
    abstractGrammar: 'abstract grammar: sequential cards, fast benefit switching, stable product anchor',
    targetEquivalentLabel: '卖点场景卡连跳',
    targetEquivalentActions: ['卖点卡连跳', '场景卡切换', '信息卡叠入', '产品稳定底图'],
    rationale: 'target beverage equivalent: keep the fast information rhythm, replace source screens with benefit, scene, and CTA cards.'
  },
  device_handoff: {
    sourcePattern: 'source structure: one context hands off to another',
    abstractGrammar: 'abstract grammar: object continuity, scene relay, social/usage context expansion',
    targetEquivalentLabel: '分享场景接力',
    targetEquivalentActions: ['手递产品', '桌面到通勤切换', '朋友分享暗示', '场景擦除转场'],
    rationale: 'target beverage equivalent: keep the relay logic, map it to handoff, commute, and sharing moments.'
  },
  cta_lockup: {
    sourcePattern: 'source structure: final product lock-up and action prompt',
    abstractGrammar: 'abstract grammar: lineup, clean end frame, CTA surface, purchase-guidance hold',
    targetEquivalentLabel: '多瓶阵列 CTA 尾帧',
    targetEquivalentActions: ['多瓶阵列', '产品定格', 'CTA 留白', '购买引导弹出', '干净收口'],
    rationale: 'target beverage equivalent: keep the final lock-up and decision cue, use product lineup and clear CTA space.'
  },
  kinetic_assembly_reveal: {
    sourcePattern: 'source structure: kinetic cascade, activation burst, CTA reveal',
    abstractGrammar: 'abstract grammar: cascade, chaos-to-order, activation, spectacle burst, CTA lock-up',
    targetEquivalentLabel: '冰爽级联组装揭示',
    targetEquivalentActions: ['冰块级联', '柠檬片扫过', '红茶水滴汇聚', '开盖/倒茶激活', '冷雾爆发', 'CTA 收口'],
    rationale: 'target beverage equivalent: keep the kinetic assembly grammar, replace source objects with cold-refresh materials and a clean CTA end frame.'
  },
  generic_source_specific: {
    sourcePattern: 'source structure: category-specific feature demonstration',
    abstractGrammar: 'abstract grammar: feature evidence, clean product reveal, category-native action',
    targetEquivalentLabel: '饮料动作等价镜头',
    targetEquivalentActions: ['瓶身标签高光', '冷凝水擦除', '开盖动作', '倒入杯中', '产品陈列'],
    rationale: 'target beverage equivalent: keep only the structural intent, use beverage-native product proof and clean packaging motion.'
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
  if (!input.motif && !containsSourceSpecificTerm(buildSlotText(input.slot))) {
    return undefined;
  }

  const subtype = inferSourceSpecificTransferSubtype(input.slot, input.motif);
  const profile = PROFILES[subtype];
  const targetCategory = input.targetCategory ?? input.motif?.targetCategoryMapping.targetCategory ?? 'generic';

  return {
    sourceSpecific: true,
    subtype,
    sourcePattern: profile.sourcePattern,
    abstractGrammar: profile.abstractGrammar,
    targetEquivalentLabel: profile.targetEquivalentLabel,
    targetEquivalentActions: profile.targetEquivalentActions,
    rationale: `${profile.rationale} Target category: ${targetCategory}.`
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
