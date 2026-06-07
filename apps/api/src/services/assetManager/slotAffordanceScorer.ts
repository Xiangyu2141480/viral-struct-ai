import type {
  AssetCard,
  AssetManagerRole,
  ContentBrief,
  RoleAffordanceComponents,
  RoleAffordanceScore,
  ShotSlotRole
} from '@viral-struct/shared';

export const ASSET_MANAGER_ROLES: AssetManagerRole[] = [
  'opening_hook',
  'product_closeup',
  'usage_demo',
  'comparison',
  'benefit_proof',
  'lifestyle_scene',
  'background',
  'packaging_card',
  'cta',
  'cover'
];

const ROLE_TO_SLOT: Partial<Record<AssetManagerRole, ShotSlotRole>> = {
  opening_hook: 'opening_attention',
  product_closeup: 'product_closeup',
  usage_demo: 'usage_demo',
  comparison: 'comparison',
  benefit_proof: 'benefit_visual',
  cta: 'cta_visual',
  cover: 'opening_attention'
};

const SLOT_TO_ROLE: Record<ShotSlotRole, AssetManagerRole> = {
  opening_attention: 'opening_hook',
  product_closeup: 'product_closeup',
  usage_demo: 'usage_demo',
  benefit_visual: 'benefit_proof',
  comparison: 'comparison',
  testimonial: 'benefit_proof',
  cta_visual: 'cta'
};

const ROLE_KEYWORDS: Record<AssetManagerRole, string[]> = {
  opening_hook: ['opening', 'hook', 'attention', 'splash', 'ice', 'impact', 'high energy', '开场', '冰爽', '飞溅'],
  product_closeup: ['product', 'bottle', 'label', 'closeup', 'packshot', '瓶身', '标签', '商品', '产品'],
  usage_demo: ['usage', 'demo', 'hand', 'drink', 'holding', 'use', '饮用', '手持', '使用', '动作'],
  comparison: ['compare', 'comparison', 'lineup', 'before after', 'series', '对比', '陈列', '系列'],
  benefit_proof: ['benefit', 'proof', 'refresh', 'ice', 'lemon', 'selling point', '冰爽', '解腻', '柠檬', '卖点'],
  lifestyle_scene: ['lifestyle', 'summer', 'scene', 'outdoor', '聚餐', '夏日', '场景', '生活'],
  background: ['background', 'clean', 'negative space', '纯白', '背景', '留白', 'clean_background'],
  packaging_card: ['title', 'caption', 'card', 'copy', 'packaging', '字幕', '标题', '卡片', '包装'],
  cta: ['cta', 'buy', 'click', 'order', 'now', '购买', '下单', '立即', '来一瓶'],
  cover: ['cover', 'hero', 'poster', 'product', 'label', '封面', '主视觉', '瓶身']
};

export function scoreSlotAffordance(asset: AssetCard, contentBrief?: ContentBrief): RoleAffordanceScore[] {
  return ASSET_MANAGER_ROLES
    .map((role) => {
      const components = scoreComponents(role, asset, contentBrief);
      const score = applyRoleCaps(role, asset, weightedRoleScore(components));
      return {
        role,
        score,
        confidence: toConfidence(score),
        components,
        rationale: buildRationale(role, asset, components, score),
        reasons: buildReasons(role, asset, components),
        evidence: buildEvidence(asset)
      };
    })
    .sort((a, b) => b.score - a.score);
}

function applyRoleCaps(role: AssetManagerRole, asset: AssetCard, score: number): number {
  if (isLowQuality(asset)) return Math.min(score, 49);

  if (role === 'usage_demo') {
    if (!hasUsageMotionEvidence(asset)) return Math.min(score, 49);
    if (!hasDrinkPourOpenCue(asset)) return Math.min(score, 68);
  }
  if (role === 'comparison' && !hasComparisonCue(asset)) {
    return Math.min(score, 49);
  }
  if (role === 'benefit_proof' && !hasBenefitProofCue(asset)) {
    return Math.min(score, 64);
  }
  if (role === 'opening_hook' && !hasOpeningHookCue(asset)) {
    return Math.min(score, 68);
  }
  if (role === 'lifestyle_scene' && !hasLifestyleCue(asset)) {
    return Math.min(score, 55);
  }
  if (role === 'cta' && !hasCtaSurfaceCue(asset)) {
    return Math.min(score, 69);
  }
  return score;
}

export function mapShotSlotRoleToAssetManagerRole(role: ShotSlotRole): AssetManagerRole {
  return SLOT_TO_ROLE[role];
}

export function mapAssetManagerRoleToShotSlotRole(role: AssetManagerRole): ShotSlotRole | undefined {
  return ROLE_TO_SLOT[role];
}

export function coverageStatusFromScore(score: number): 'covered' | 'weak' | 'missing' {
  if (score >= 75) return 'covered';
  if (score >= 50) return 'weak';
  return 'missing';
}

export function getRoleAffordanceScore(
  roleScores: RoleAffordanceScore[],
  role: AssetManagerRole
): RoleAffordanceScore {
  return roleScores.find((score) => score.role === role) ?? {
    role,
    score: 0,
    confidence: 0,
    components: {
      semanticFit: 0,
      visualSignalFit: 0,
      productVisibilityFit: 0,
      qualityFit: 0,
      formatFit: 0,
      editabilityFit: 0,
      safetyFit: 0
    },
    rationale: 'No affordance score was available for this role.',
    reasons: ['No AssetAnalysis role affordance evidence was available.'],
    evidence: []
  };
}

function scoreComponents(role: AssetManagerRole, asset: AssetCard, contentBrief?: ContentBrief): RoleAffordanceComponents {
  return {
    semanticFit: scoreSemanticFit(role, asset, contentBrief),
    visualSignalFit: scoreVisualSignalFit(role, asset),
    productVisibilityFit: scoreProductVisibilityFit(role, asset),
    qualityFit: toPercent(asset.analysis?.quality.overallScore ?? asset.qualityScore),
    formatFit: scoreFormatFit(role, asset),
    editabilityFit: scoreEditabilityFit(role, asset),
    safetyFit: scoreSafetyFit(asset)
  };
}

function weightedRoleScore(components: RoleAffordanceComponents): number {
  return roundScore(
    0.25 * components.semanticFit
    + 0.20 * components.visualSignalFit
    + 0.15 * components.productVisibilityFit
    + 0.15 * components.qualityFit
    + 0.10 * components.formatFit
    + 0.10 * components.editabilityFit
    + 0.05 * components.safetyFit
  );
}

function scoreSemanticFit(role: AssetManagerRole, asset: AssetCard, contentBrief?: ContentBrief): number {
  const directSlot = ROLE_TO_SLOT[role];
  if (directSlot && asset.suitableSlots.includes(directSlot)) return 92;
  if (asset.analysis?.roleAffordance?.some((score) => score.role === role && score.score >= 75)) return 85;
  const profileText = buildSearchText(asset, contentBrief);
  const keywordScore = keywordHitScore(profileText, ROLE_KEYWORDS[role], 72);
  if (role === 'benefit_proof' && contentBrief?.sellingPoints.some((point) => includesLoose(profileText, point))) {
    return Math.max(76, keywordScore);
  }
  if (role === 'packaging_card' && asset.type === 'text') return Math.max(82, keywordScore);
  if (role === 'cta' && asset.detectedObjects.some((object) => includesLoose(object, 'cta'))) return Math.max(84, keywordScore);
  return keywordScore;
}

function scoreVisualSignalFit(role: AssetManagerRole, asset: AssetCard): number {
  const haystack = buildAssetText(asset);
  const ingredients = asset.detectedIngredients ?? [];
  const styles = asset.visualStyleTags ?? [];
  const motion = asset.motionPotential ?? asset.analysis?.semantic.motionPotential;
  if (role === 'opening_hook') {
    if (ingredients.includes('lifestyle_context') || styles.includes('premium_visual') || motion?.implicitMotion === 'high') return 86;
    return keywordHitScore(haystack, ROLE_KEYWORDS[role], 58);
  }
  if (role === 'product_closeup') {
    if (ingredients.includes('product_closeup_trait')) return 88;
    return keywordHitScore(haystack, ROLE_KEYWORDS[role], 60);
  }
  if (role === 'usage_demo') {
    if (ingredients.includes('hand_demo') || asset.humanPresence?.actions?.includes('holding_product')) return 88;
    if (asset.type === 'video') return 58;
    return keywordHitScore(haystack, ROLE_KEYWORDS[role], 38);
  }
  if (role === 'comparison') {
    return includesLoose(haystack, 'lineup') || includesLoose(haystack, 'series') || includesLoose(haystack, '陈列') ? 86 : keywordHitScore(haystack, ROLE_KEYWORDS[role], 52);
  }
  if (role === 'benefit_proof') {
    if (styles.includes('lifestyle_context') || includesLoose(haystack, 'ice') || includesLoose(haystack, '冰')) return 82;
    return keywordHitScore(haystack, ROLE_KEYWORDS[role], 56);
  }
  if (role === 'background') {
    return styles.includes('clean_background') || includesLoose(haystack, 'background') || includesLoose(haystack, '背景') ? 82 : 45;
  }
  if (role === 'packaging_card') return asset.type === 'text' ? 86 : 55;
  if (role === 'cta') return asset.type === 'text' || asset.suitableSlots.includes('cta_visual') ? 82 : 48;
  if (role === 'cover') return asset.qualityScore >= 0.75 && hasProductCue(asset) ? 84 : 50;
  if (role === 'lifestyle_scene') {
    return styles.includes('lifestyle_context') || ingredients.includes('lifestyle_context') ? 84 : keywordHitScore(haystack, ROLE_KEYWORDS[role], 48);
  }
  return 45;
}

function scoreProductVisibilityFit(role: AssetManagerRole, asset: AssetCard): number {
  const productScore = hasProductCue(asset) ? 92 : 22;
  if (role === 'background') return hasProductCue(asset) ? 58 : 75;
  if (role === 'packaging_card' || role === 'cta') return asset.type === 'text' ? 75 : productScore;
  if (role === 'usage_demo') return hasProductCue(asset) && asset.humanPresence?.hasHuman ? 82 : hasProductCue(asset) ? 46 : 24;
  if (role === 'lifestyle_scene') return hasProductCue(asset) ? 72 : 45;
  return productScore;
}

function scoreFormatFit(role: AssetManagerRole, asset: AssetCard): number {
  const table: Record<AssetManagerRole, Record<AssetCard['type'], number>> = {
    opening_hook: { image: 82, video: 92, text: 44 },
    product_closeup: { image: 92, video: 86, text: 28 },
    usage_demo: { image: 36, video: 94, text: 18 },
    comparison: { image: 80, video: 75, text: 58 },
    benefit_proof: { image: 82, video: 80, text: 72 },
    lifestyle_scene: { image: 78, video: 88, text: 32 },
    background: { image: 84, video: 72, text: 30 },
    packaging_card: { image: 62, video: 48, text: 94 },
    cta: { image: 64, video: 54, text: 96 },
    cover: { image: 92, video: 74, text: 42 }
  };
  return table[role][asset.type];
}

function scoreEditabilityFit(role: AssetManagerRole, asset: AssetCard): number {
  const editability = asset.analysis?.editability;
  if (!editability) {
    if (asset.type === 'text') return role === 'cta' || role === 'packaging_card' ? 78 : 48;
    return asset.type === 'video' ? 82 : 74;
  }
  if (role === 'usage_demo') return editability.canLoop || editability.suggestedEdits.includes('trim_to_highlight') ? 84 : 46;
  if (role === 'background') return editability.canUseAsBackground ? 86 : 45;
  if (role === 'cta' || role === 'packaging_card') return editability.canExtendWithCards ? 88 : 42;
  if (role === 'opening_hook' || role === 'cover' || role === 'product_closeup') return editability.canCropZoom ? 86 : 50;
  return editability.canExtendWithCards || editability.canCropZoom ? 78 : 46;
}

function scoreSafetyFit(asset: AssetCard): number {
  const status = asset.analysis?.safety.status;
  if (status === 'blocked') return 0;
  if (status === 'needs_review') return 55;
  return 100;
}

function buildRationale(
  role: AssetManagerRole,
  asset: AssetCard,
  components: RoleAffordanceComponents,
  score: number
): string {
  const strongest = Object.entries(components).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'semanticFit';
  const weakest = Object.entries(components).sort((a, b) => a[1] - b[1])[0]?.[0] ?? 'semanticFit';
  return `${asset.id} scores ${score} for ${role}; strongest=${strongest}, weakest=${weakest}.`;
}

function buildReasons(role: AssetManagerRole, asset: AssetCard, components: RoleAffordanceComponents): string[] {
  const reasons = [
    `semanticFit=${components.semanticFit}`,
    `visualSignalFit=${components.visualSignalFit}`,
    `qualityFit=${components.qualityFit}`,
    `formatFit=${components.formatFit}`
  ];
  if (asset.analysis?.warnings.length) {
    reasons.push(`warnings=${asset.analysis.warnings.length}`);
  }
  if (role === 'usage_demo' && asset.type !== 'video') {
    reasons.push('usage_demo prefers video or hand-operation evidence.');
  }
  return reasons;
}

function buildEvidence(asset: AssetCard): string[] {
  return [
    asset.analysis?.semantic.summary,
    asset.spatialDescription,
    asset.temporalDescription,
    asset.analysis?.media.keyframes.map((keyframe) => keyframe.id).join(', ')
  ].filter((value): value is string => Boolean(value));
}

function buildSearchText(asset: AssetCard, contentBrief?: ContentBrief): string {
  return [
    buildAssetText(asset),
    contentBrief?.productName,
    contentBrief?.scenario,
    contentBrief?.sellingPoints.join(' '),
    contentBrief?.cta,
    contentBrief?.stylePreference
  ].filter(Boolean).join(' ').toLowerCase();
}

function buildAssetText(asset: AssetCard): string {
  return [
    asset.id,
    asset.type,
    asset.url,
    asset.text,
    asset.spatialDescription,
    asset.temporalDescription,
    asset.detectedObjects.join(' '),
    asset.suitableSlots.join(' '),
    asset.detectedIngredients?.join(' '),
    asset.visualStyleTags?.join(' '),
    asset.analysis?.semantic.summary,
    asset.analysis?.search.embeddingText,
    asset.analysis?.search.tags.join(' ')
  ].filter(Boolean).join(' ').toLowerCase();
}

function isLowQuality(asset: AssetCard): boolean {
  return (asset.analysis?.quality.overallScore ?? asset.qualityScore) < 0.5
    || (asset.analysis?.warnings.length ?? 0) >= 2
    || (asset.analysis?.quality.issues.length ?? 0) > 0;
}

function hasUsageMotionEvidence(asset: AssetCard): boolean {
  return asset.type === 'video'
    && (
      asset.humanPresence?.hasHuman
      || asset.humanPresence?.actions?.some((action) => ['holding_product', 'applying_product', 'swatching'].includes(action))
      || asset.detectedIngredients?.includes('hand_demo')
      || includesLoose(buildAssetText(asset), 'hand')
      || includesLoose(buildAssetText(asset), '手')
    );
}

function hasDrinkPourOpenCue(asset: AssetCard): boolean {
  const text = buildAssetText(asset);
  return hasAnyPositiveCue(text, [
    'drink',
    'drinking',
    'pour',
    'open_cap',
    'open cap',
    'cap opening',
    'cup',
    '饮用',
    '喝',
    '倒',
    '开盖',
    '杯'
  ]);
}

function hasComparisonCue(asset: AssetCard): boolean {
  const text = buildAssetText(asset);
  return hasAnyPositiveCue(text, [
    'compare',
    'comparison',
    'lineup',
    'series',
    'multiple products',
    'before after',
    'multi-pack',
    '对比',
    '陈列',
    '系列',
    '多瓶',
    '多规格'
  ]);
}

function hasBenefitProofCue(asset: AssetCard): boolean {
  const text = buildAssetText(asset);
  return hasAnyPositiveCue(text, [
    'ice',
    'cold',
    'splash',
    'lemon',
    'refresh',
    'condensation',
    'pour',
    'drink',
    '冰',
    '冰爽',
    '飞溅',
    '柠檬',
    '解腻',
    '倒',
    '喝'
  ]);
}

function hasOpeningHookCue(asset: AssetCard): boolean {
  return hasBenefitProofCue(asset)
    || hasDrinkPourOpenCue(asset)
    || Boolean(asset.detectedIngredients?.includes('lifestyle_context'))
    || Boolean(asset.visualStyleTags?.includes('premium_visual'));
}

function hasLifestyleCue(asset: AssetCard): boolean {
  const text = buildAssetText(asset);
  return Boolean(asset.visualStyleTags?.includes('lifestyle_context'))
    || Boolean(asset.detectedIngredients?.includes('lifestyle_context'))
    || ['outdoor', 'summer', 'party', 'scene', 'hand', 'drink', 'pour', '户外', '夏日', '聚餐', '场景', '手持', '饮用'].some((keyword) => includesLoose(text, keyword));
}

function hasCtaSurfaceCue(asset: AssetCard): boolean {
  const text = buildAssetText(asset);
  const textSafeArea = asset.analysis?.quality.textSafeArea ?? 0;
  return asset.type === 'text'
    || includesLoose(text, 'cta_copy')
    || includesLoose(text, 'clean_end')
    || includesLoose(text, 'end frame')
    || includesLoose(text, 'negative space')
    || includesLoose(text, '购买')
    || includesLoose(text, '立即')
    || (Boolean(asset.visualStyleTags?.includes('clean_background')) && hasProductCue(asset) && textSafeArea >= 0.72 && !asset.humanPresence?.hasHuman);
}

function hasAnyPositiveCue(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => hasPositiveCue(text, keyword));
}

function hasPositiveCue(text: string, keyword: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedKeyword = keyword.toLowerCase();
  let index = normalizedText.indexOf(normalizedKeyword);
  while (index >= 0) {
    const before = normalizedText.slice(Math.max(0, index - 16), index);
    if (!/(^|[\s_\-;,.])(?:no|not|without|missing|lacks?)\s*$/.test(before)) return true;
    index = normalizedText.indexOf(normalizedKeyword, index + normalizedKeyword.length);
  }
  return false;
}

function keywordHitScore(text: string, keywords: string[], maxScore: number): number {
  const hits = keywords.filter((keyword) => includesLoose(text, keyword)).length;
  if (hits === 0) return 25;
  return Math.min(maxScore, 38 + hits * 14);
}

function hasProductCue(asset: AssetCard): boolean {
  const text = buildAssetText(asset);
  return ['product', 'bottle', 'label', '商品', '产品', '瓶身', '康师傅', '冰红茶'].some((keyword) => includesLoose(text, keyword));
}

function includesLoose(text: string, needle: string): boolean {
  const normalizedNeedle = needle.toLowerCase().trim();
  if (!normalizedNeedle) return false;
  return text.toLowerCase().includes(normalizedNeedle);
}

function toPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return roundScore(Math.max(0, Math.min(1, value)) * 100);
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

function toConfidence(score: number): number {
  return Math.max(0, Math.min(1, Number((score / 100).toFixed(3))));
}
