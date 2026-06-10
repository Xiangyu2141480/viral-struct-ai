import type { CategoryEquivalentVocabulary } from '@viral-struct/shared';
import { VOCAB_ROLES, VOCAB_SUBTYPES } from '@viral-struct/shared';

/**
 * Earphone vocabulary fixture for unit tests (NOT a production fallback). Every value is earphone-native so a
 * test can assert the refactored layer (a) read the injected vocab and (b) emitted no beverage term.
 */
const SUBTYPE_FIXTURE: Record<string, { label: string; actions: string[] }> = {
  opening_transform: { label: '耳机开盒亮相', actions: ['开盒揭盖', '耳机单元浮现', '首帧钩子定格', '干净产品定格'] },
  interface_detail: { label: '耳机细节巡览', actions: ['充电仓特写', '腔体材质扫光', 'logo 微距', '接缝工艺细节'] },
  assembly_detail: { label: '耳机部件归位', actions: ['左右单元归位', '入仓吸附', '配色切换', '产品定格'] },
  ui_sequence: { label: '卖点信息连跳', actions: ['卖点卡连跳', '场景卡切换', '降噪示意叠入', '产品稳定底图'] },
  device_handoff: { label: '场景接力', actions: ['摘下递出', '通勤到办公切换', '佩戴上耳', '场景擦除转场'] },
  cta_lockup: { label: '耳机收口 CTA', actions: ['产品阵列', '产品定格', 'CTA 留白', '购买引导弹出'] },
  kinetic_assembly_reveal: { label: '单元汇聚揭示', actions: ['零件由散到聚', '单元入仓', '降噪激活', 'CTA 收口'] },
  generic_source_specific: { label: '耳机功能等价镜头', actions: ['佩戴展示', '降噪示意', '续航示意', '产品定格'] }
};

const ROLE_FIXTURE = {
  label: '耳机镜头',
  reshootShot: '拍摄耳机佩戴、开盒与充电仓细节，背景干净',
  mustCapture: ['耳机外形完整', '佩戴动作清晰', '画面稳定对焦'],
  animationHints: ['卖点卡', '降噪波纹示意', '简单箭头动效'],
  aigcScene: '简约冷调背景的耳机镜头，产品清晰、降噪沉浸氛围'
};

export const EARPHONE_VOCAB_FIXTURE: CategoryEquivalentVocabulary = {
  product: '无线蓝牙耳机',
  bySubtype: Object.fromEntries(VOCAB_SUBTYPES.map((k) => [k, SUBTYPE_FIXTURE[k]!])) as CategoryEquivalentVocabulary['bySubtype'],
  byRole: Object.fromEntries(VOCAB_ROLES.map((k) => [k, ROLE_FIXTURE])) as CategoryEquivalentVocabulary['byRole'],
  tokenActions: {
    component_cascade: '单元零件归位',
    chaos_to_order: '由散到聚',
    assembly_completion: '完成定格',
    cta_reveal: 'CTA 收口',
    object_rotation: '产品旋转',
    clean_hold: '干净定格'
  },
  connective: { afterUseResult: '戴上之后即时的安静与沉浸', productHero: '耳机产品 hero 定格' }
};

/**
 * Source-identity banlist fixture representing "the scanned source video is the MacBook ad". Mirrors what
 * deriveSourceIdentityBanlist would return for that source, so unit tests can exercise the source-leak
 * guardrails with an explicit banlist (production derives this from the actual scanned source graph).
 */
export const MACBOOK_SOURCE_BANNED_TERMS: readonly string[] = [
  'macbook', 'apple', '苹果', 'laptop', '笔记本', 'keyboard', '键盘', 'trackpad', 'touchpad', '触控板',
  'screen', '屏幕', 'port', '接口', 'camera', '摄像头', 'hinge', 'chassis', '机身', 'hardware', '硬件',
  'rocket', '火箭', 'purchase window', '购买窗口', '开合结构'
];
