import type {
  AssetCard,
  AssetLibraryReport,
  AssetManagerRole,
  ContentBrief,
  RoleAffordanceScore,
  RoleCoverageSummary,
  ShotSlotNode,
  ShotSlotRole,
  SlotCandidateAsset,
  SlotCoverageMatrix,
  SlotCoverageRow,
  ViralStructureGraph
} from '@viral-struct/shared';
import { AssetCardSchema, AssetLibraryReportSchema, SlotCoverageMatrixSchema } from '@viral-struct/shared';
import { normalizeAssetCard } from './assetNormalizer';
import {
  ASSET_MANAGER_ROLES,
  coverageStatusFromScore,
  getRoleAffordanceScore,
  mapAssetManagerRoleToShotSlotRole,
  mapShotSlotRoleToAssetManagerRole,
  scoreSlotAffordance
} from './slotAffordanceScorer';

export interface AnalyzeAssetCoverageInput {
  structureGraph?: ViralStructureGraph;
  assetCards: AssetCard[];
  contentBrief?: ContentBrief;
  libraryId?: string;
}

export interface AssetCoverageAnalysisResult {
  matrix: SlotCoverageMatrix;
  report: AssetLibraryReport;
  assetCards: AssetCard[];
  warnings: string[];
}

export function analyzeAssetCoverage(input: AnalyzeAssetCoverageInput): AssetCoverageAnalysisResult {
  const warnings: string[] = [];
  const assetCards = enrichAssetsWithAffordance(input.assetCards, input.contentBrief);
  if (assetCards.length === 0) {
    warnings.push('No assetCards were provided; every role and slot will be marked missing.');
  }

  const roleScores = buildRoleScoreMap(assetCards);
  const slotRows = input.structureGraph?.shotSlots?.length
    ? input.structureGraph.shotSlots.map((slot) => buildSlotCoverageRow(slot, assetCards, roleScores))
    : buildRoleLevelRows(roleScores, warnings);

  const matrix = buildMatrix(slotRows);
  const report = buildReport({
    libraryId: input.libraryId ?? 'input_assets',
    assetCards,
    slotRows,
    roleScores,
    warnings
  });

  return {
    matrix: SlotCoverageMatrixSchema.parse(matrix) as SlotCoverageMatrix,
    report: AssetLibraryReportSchema.parse(report) as AssetLibraryReport,
    assetCards,
    warnings
  };
}

function enrichAssetsWithAffordance(assetCards: AssetCard[], contentBrief?: ContentBrief): AssetCard[] {
  return assetCards.map((asset) => {
    const normalized = normalizeAssetCard(asset);
    const roleAffordance = scoreSlotAffordance(normalized, contentBrief);
    const primaryRoles = roleAffordance
      .filter((score) => score.score >= 50)
      .map((score) => mapAssetManagerRoleToShotSlotRole(score.role))
      .filter((role): role is ShotSlotRole => Boolean(role))
      .filter((role, index, roles) => roles.indexOf(role) === index)
      .slice(0, 5);
    const candidateSlotRoles = primaryRoles.map((role) => {
      const assetRole = roleAffordance.find((score) => mapAssetManagerRoleToShotSlotRole(score.role) === role);
      return {
        role,
        confidence: round01((assetRole?.score ?? normalized.qualityScore * 100) / 100),
        caveat: 'Deterministic slot affordance scoring.'
      };
    });
    const suitableSlots = uniqueRoles(normalized.suitableSlots);
    const enriched: AssetCard = {
      ...normalized,
      suitableSlots,
      candidateSlotRoles,
      analysis: {
        ...normalized.analysis!,
        roleAffordance,
        slotAffordance: {
          suitableSlots,
          primaryRoles: candidateSlotRoles,
          missingRoles: ([
            'opening_attention',
            'product_closeup',
            'usage_demo',
            'benefit_visual',
            'comparison',
            'testimonial',
            'cta_visual'
          ] as ShotSlotRole[]).filter((role) => !suitableSlots.includes(role)),
          rationale: 'Updated by deterministic Asset Manager slot affordance scoring.'
        }
      }
    };
    return AssetCardSchema.parse(enriched);
  });
}

function buildRoleScoreMap(assetCards: AssetCard[]): Record<AssetManagerRole, SlotCandidateAsset[]> {
  const map = createRoleCandidateMap();
  for (const asset of assetCards) {
    const roleAffordance = asset.analysis?.roleAffordance ?? scoreSlotAffordance(asset);
    for (const score of roleAffordance) {
      map[score.role].push({
        assetId: asset.id,
        assetType: asset.type,
        score: score.score,
        roleAffordance: score.score,
        intentSemanticMatch: score.components.semanticFit,
        acceptanceCriteriaMatch: score.components.visualSignalFit,
        assetQuality: score.components.qualityFit,
        editabilityFit: score.components.editabilityFit,
        rationale: score.rationale
      });
    }
  }
  for (const role of ASSET_MANAGER_ROLES) {
    map[role].sort((a, b) => b.score - a.score);
  }
  return map;
}

function createRoleCandidateMap(): Record<AssetManagerRole, SlotCandidateAsset[]> {
  return ASSET_MANAGER_ROLES.reduce((acc, role) => {
    acc[role] = [];
    return acc;
  }, {} as Record<AssetManagerRole, SlotCandidateAsset[]>);
}

function buildSlotCoverageRow(
  slot: ShotSlotNode,
  assets: AssetCard[],
  roleScores: Record<AssetManagerRole, SlotCandidateAsset[]>
): SlotCoverageRow {
  const mappedRole = mapShotSlotRoleToAssetManagerRole(slot.role);
  const candidates = assets
    .map((asset) => buildSlotCandidate(slot, mappedRole, asset))
    .sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const bestScore = best?.score ?? 0;
  const bestAsset = best ? assets.find((asset) => asset.id === best.assetId) : undefined;
  const status = slotCoverageStatusFromCandidate(slot, bestScore, bestAsset);
  return {
    slotId: slot.id,
    segmentId: slot.segmentId,
    slotRole: slot.role,
    mappedRole,
    requiredAssetType: slot.requiredAsset.type,
    status,
    bestAssetId: status === 'missing' ? undefined : best?.assetId,
    bestScore,
    candidates,
    gapReason: buildGapReason(slot, status, roleScores[mappedRole]?.[0], bestAsset)
  };
}

function buildSlotCandidate(slot: ShotSlotNode, mappedRole: AssetManagerRole, asset: AssetCard): SlotCandidateAsset {
  const roleScore = getRoleAffordanceScore(asset.analysis?.roleAffordance ?? scoreSlotAffordance(asset), mappedRole);
  const intentSemanticMatch = scoreIntentSemanticMatch(slot, asset);
  const acceptanceCriteriaMatch = scoreAcceptanceCriteriaMatch(slot, asset);
  const assetQuality = roundScore((asset.analysis?.quality.overallScore ?? asset.qualityScore) * 100);
  const editabilityFit = roleScore.components.editabilityFit;
  let score = roundScore(
    0.30 * roleScore.score
    + 0.25 * intentSemanticMatch
    + 0.20 * acceptanceCriteriaMatch
    + 0.15 * assetQuality
    + 0.10 * editabilityFit
  );
  score = applyHardRequirementPenalty(score, slot, asset);
  return {
    assetId: asset.id,
    assetType: asset.type,
    score,
    roleAffordance: roleScore.score,
    intentSemanticMatch,
    acceptanceCriteriaMatch,
    assetQuality,
    editabilityFit,
    rationale: buildCandidateRationale(slot, asset, roleScore, score)
  };
}

function buildRoleLevelRows(
  roleScores: Record<AssetManagerRole, SlotCandidateAsset[]>,
  warnings: string[]
): SlotCoverageRow[] {
  warnings.push('structureGraph has no shotSlots; using role-level coverage fallback.');
  return ASSET_MANAGER_ROLES.map((role) => {
    const candidates = roleScores[role];
    const best = candidates[0];
    const bestScore = best?.score ?? 0;
    const status = coverageStatusFromScore(bestScore);
    return {
      slotId: `role:${role}`,
      mappedRole: role,
      status,
      bestAssetId: status === 'missing' ? undefined : best?.assetId,
      bestScore,
      candidates,
      gapReason: status === 'covered' ? undefined : `Role ${role} has no strong candidate asset.`
    };
  });
}

function buildMatrix(slotRows: SlotCoverageRow[]): SlotCoverageMatrix {
  const coveredSlotCount = slotRows.filter((row) => row.status === 'covered').length;
  const totalSlotCount = slotRows.length;
  return {
    slots: slotRows.map((row) => ({
      role: row.slotRole ?? row.mappedRole,
      slotId: row.slotId,
      mappedRole: row.mappedRole,
      assetIds: row.candidates.filter((candidate) => candidate.score >= 50).map((candidate) => candidate.assetId),
      bestAssetId: row.bestAssetId,
      bestScore: row.bestScore,
      coverage: row.status,
      candidates: row.candidates
    })),
    slotRows,
    coveredSlotCount,
    totalSlotCount,
    coverageRatio: totalSlotCount === 0 ? 0 : round01(coveredSlotCount / totalSlotCount)
  };
}

function buildReport(input: {
  libraryId: string;
  assetCards: AssetCard[];
  slotRows: SlotCoverageRow[];
  roleScores: Record<AssetManagerRole, SlotCandidateAsset[]>;
  warnings: string[];
}): AssetLibraryReport {
  const avgQualityScore = input.assetCards.length === 0
    ? 0
    : round01(input.assetCards.reduce((sum, asset) => sum + asset.qualityScore, 0) / input.assetCards.length);
  const lowQualityAssetIds = input.assetCards
    .filter((asset) => (asset.analysis?.quality.overallScore ?? asset.qualityScore) < 0.5)
    .map((asset) => asset.id);
  const warningCount = input.assetCards.reduce((count, asset) => count + (asset.analysis?.warnings.length ?? 0), input.warnings.length);
  const roleCoverage = Object.fromEntries(ASSET_MANAGER_ROLES.map((role) => {
    const best = input.roleScores[role][0];
    const bestScore = best?.score ?? 0;
    return [role, {
      role,
      status: coverageStatusFromScore(bestScore),
      bestAssetId: best?.assetId,
      bestScore,
      assetIds: input.roleScores[role].filter((candidate) => candidate.score >= 50).map((candidate) => candidate.assetId)
    } satisfies RoleCoverageSummary];
  })) as Record<AssetManagerRole, RoleCoverageSummary>;
  const requiredRoles = uniqueAssetManagerRoles(input.slotRows.map((row) => row.mappedRole));
  const missingRoles = requiredRoles.filter((role) => roleCoverage[role].status === 'missing');
  const weakRoles = requiredRoles.filter((role) => roleCoverage[role].status === 'weak');
  const coveredSlots = uniqueRoles(input.slotRows
    .filter((row) => row.slotRole && row.status === 'covered')
    .map((row) => row.slotRole!));
  const missingSlots = uniqueRoles(input.slotRows
    .filter((row) => row.slotRole && row.status === 'missing')
    .map((row) => row.slotRole!));

  return {
    libraryId: input.libraryId,
    assetCount: input.assetCards.length,
    byType: {
      image: input.assetCards.filter((asset) => asset.type === 'image').length,
      video: input.assetCards.filter((asset) => asset.type === 'video').length,
      text: input.assetCards.filter((asset) => asset.type === 'text').length
    },
    avgQualityScore,
    qualitySummary: {
      avgQualityScore,
      lowQualityAssetIds,
      warningCount
    },
    coveredSlots,
    missingSlots,
    roleCoverage,
    missingRoles,
    weakRoles,
    topAssetsByRole: Object.fromEntries(ASSET_MANAGER_ROLES.map((role) => [role, input.roleScores[role].slice(0, 3)])) as Record<AssetManagerRole, SlotCandidateAsset[]>,
    recommendations: buildRecommendations(input.slotRows, roleCoverage),
    warnings: input.warnings,
    generatedAt: '1970-01-01T00:00:00.000Z'
  };
}

function scoreIntentSemanticMatch(slot: ShotSlotNode, asset: AssetCard): number {
  if (asset.suitableSlots.includes(slot.role)) return 86;
  const intentText = [
    slot.intent?.purpose,
    slot.intent?.motionPattern,
    slot.intent?.compositionPrincipal,
    slot.sourceInstance?.specificAction,
    slot.requiredAsset.subject
  ].filter(Boolean).join(' ');
  return keywordOverlapScore(intentText, buildAssetText(asset), 28);
}

function scoreAcceptanceCriteriaMatch(slot: ShotSlotNode, asset: AssetCard): number {
  if (asset.suitableSlots.includes(slot.role)) return 78;
  const criteriaText = slot.acceptanceCriteria?.anyOf
    .flatMap((criterion) => [criterion.motionType, criterion.compositionType, ...criterion.examples])
    .filter(Boolean)
    .join(' ') ?? '';
  if (!criteriaText) return 62;
  return keywordOverlapScore(criteriaText, buildAssetText(asset), 24);
}

function applyHardRequirementPenalty(score: number, slot: ShotSlotNode, asset: AssetCard): number {
  if (asset.analysis?.safety.status === 'blocked') return 0;
  if (isLowQuality(asset)) return Math.min(score, 49);
  if (slot.humanRequirement?.required && !asset.humanPresence?.hasHuman) return Math.min(score, 49);
  if (slot.humanRequirement?.action && slot.humanRequirement.action !== 'none' && !asset.humanPresence?.actions?.includes(slot.humanRequirement.action)) {
    return Math.min(score, 49);
  }
  if (slot.role === 'usage_demo' && !hasStrongUsageEvidence(slot, asset)) return Math.min(score, hasBasicUsageEvidence(asset) ? 69 : 49);
  if (slot.role === 'product_closeup' && needsSpecificActionEvidence(slot) && !hasSpecificActionEvidence(slot, asset)) return Math.min(score, 69);
  if (slot.role === 'comparison' && !hasComparisonEvidence(asset)) return Math.min(score, 49);
  if (slot.role === 'benefit_visual' && !hasBenefitEvidence(asset)) return Math.min(score, 64);
  if (slot.role === 'opening_attention' && !hasOpeningEvidence(asset)) return Math.min(score, 69);
  if (slot.role === 'cta_visual' && slot.requiredAsset.motion === 'hand_operation' && !hasCtaEvidence(asset)) return Math.min(score, 49);
  if (slot.role === 'cta_visual' && !hasCtaEvidence(asset)) return Math.min(score, 69);
  if (slot.requiredAsset.type === 'video' && asset.type !== 'video' && slot.requiredAsset.motion === 'hand_operation') {
    return Math.min(score, 48);
  }
  if (slot.requiredAsset.type !== 'generated' && slot.requiredAsset.type !== asset.type && slot.role === 'usage_demo') {
    return Math.min(score, 55);
  }
  return score;
}

function buildCandidateRationale(
  slot: ShotSlotNode,
  asset: AssetCard,
  roleScore: RoleAffordanceScore,
  finalScore: number
): string {
  const status = coverageStatusFromScore(finalScore);
  return `${asset.id} -> ${slot.id}: ${status}; role=${roleScore.score}, intent/criteria fit included.`;
}

function buildGapReason(
  slot: ShotSlotNode,
  status: SlotCoverageRow['status'],
  bestRoleCandidate?: SlotCandidateAsset,
  bestAsset?: AssetCard
): string | undefined {
  if (status === 'covered') return undefined;
  if (bestAsset && isLowQuality(bestAsset)) {
    return `${slot.role} candidate ${bestAsset.id} is low quality or warning-heavy; keep it as weak evidence only.`;
  }
  if (slot.role === 'comparison' && bestAsset && !hasComparisonEvidence(bestAsset)) {
    return `${slot.role} requires lineup, before/after, or comparison evidence; current best asset ${bestAsset.id} does not show comparison.`;
  }
  if (slot.role === 'usage_demo' && bestAsset && hasSpecificUsageActionRequirement(slot) && !hasUsageActionFamilyMatch(slot, bestAsset)) {
    return `${slot.role} source slot requires a specific usage action family; current best asset ${bestAsset.id} only provides generic or different usage motion.`;
  }
  if (slot.role === 'usage_demo' && bestAsset && !hasStrongUsageEvidence(slot, bestAsset)) {
    return `${slot.role} needs drink, pour, open-cap, or stronger use evidence; current best asset ${bestAsset.id} is only partial usage evidence.`;
  }
  if (slot.role === 'product_closeup' && bestAsset && needsSpecificActionEvidence(slot) && !hasSpecificActionEvidence(slot, bestAsset)) {
    return `${slot.role} source slot requires a specific product action; current best asset ${bestAsset.id} is only generic product evidence.`;
  }
  if (slot.role === 'benefit_visual' && bestAsset && !hasBenefitEvidence(bestAsset)) {
    return `${slot.role} needs cold, pour, drink, splash, or other benefit proof evidence; current best asset ${bestAsset.id} is weak.`;
  }
  if (slot.role === 'cta_visual' && bestAsset && !hasCtaEvidence(bestAsset)) {
    return `${slot.role} needs a clean CTA surface or copy-ready end frame; current best asset ${bestAsset.id} is weak.`;
  }
  if (slot.role === 'opening_attention' && bestAsset && !hasOpeningEvidence(bestAsset)) {
    return `${slot.role} needs high-attention motion, cold cue, or strong hook evidence; current best asset ${bestAsset.id} is weak.`;
  }
  if (slot.humanRequirement?.required) {
    return `${slot.role} requires human/hand action coverage; current best asset ${bestRoleCandidate?.assetId ?? 'none'} is insufficient.`;
  }
  if (slot.requiredAsset.type === 'video') {
    return `${slot.role} prefers video or motion evidence; current library coverage is ${status}.`;
  }
  return `${slot.role} coverage is ${status}; add a stronger ${mapShotSlotRoleToAssetManagerRole(slot.role)} asset or use repair strategies.`;
}

function buildRecommendations(
  rows: SlotCoverageRow[],
  roleCoverage: Record<AssetManagerRole, RoleCoverageSummary>
): string[] {
  const recommendations = rows
    .filter((row) => row.status !== 'covered')
    .map((row) => `Add or generate ${row.mappedRole} material for ${row.slotId}: ${row.gapReason ?? 'coverage is not strong enough'}`);
  for (const role of ASSET_MANAGER_ROLES) {
    if (roleCoverage[role].status === 'missing') {
      recommendations.push(`Role ${role} has no usable candidate; consider prompt-ready storyboard or user upload.`);
    }
  }
  return Array.from(new Set(recommendations)).slice(0, 8);
}

function keywordOverlapScore(source: string, target: string, perHit: number): number {
  const tokens = tokenize(source);
  if (tokens.length === 0) return 55;
  const targetText = target.toLowerCase();
  const hits = tokens.filter((token) => targetText.includes(token)).length;
  if (hits === 0) return 25;
  return roundScore(Math.min(100, 35 + hits * perHit));
}

function tokenize(text: string): string[] {
  return Array.from(new Set(text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)));
}

function buildAssetText(asset: AssetCard): string {
  return [
    asset.id,
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

function slotCoverageStatusFromCandidate(
  slot: ShotSlotNode,
  bestScore: number,
  bestAsset?: AssetCard
): SlotCoverageRow['status'] {
  if (!bestAsset || bestScore < 50) return 'missing';
  if (isLowQuality(bestAsset)) return 'weak';
  if (slot.role === 'usage_demo' && !hasStrongUsageEvidence(slot, bestAsset)) return 'weak';
  if (slot.role === 'product_closeup' && needsSpecificActionEvidence(slot) && !hasSpecificActionEvidence(slot, bestAsset)) return 'weak';
  if (slot.role === 'comparison' && !hasComparisonEvidence(bestAsset)) return 'missing';
  if (slot.role === 'benefit_visual' && !hasBenefitEvidence(bestAsset)) return 'weak';
  if (slot.role === 'opening_attention' && !hasOpeningEvidence(bestAsset)) return 'weak';
  if (slot.role === 'cta_visual' && slot.requiredAsset.motion === 'hand_operation' && !hasCtaEvidence(bestAsset)) return 'missing';
  if (slot.role === 'cta_visual' && !hasCtaEvidence(bestAsset)) return 'weak';
  return coverageStatusFromScore(bestScore);
}

function isLowQuality(asset: AssetCard): boolean {
  return (asset.analysis?.quality.overallScore ?? asset.qualityScore) < 0.5
    || (asset.analysis?.warnings.length ?? 0) >= 2
    || (asset.analysis?.quality.issues.length ?? 0) > 0;
}

function hasBasicUsageEvidence(asset: AssetCard): boolean {
  const text = buildAssetText(asset);
  return asset.type === 'video'
    && (
      asset.humanPresence?.hasHuman
      || asset.humanPresence?.actions?.some((action) => ['holding_product', 'applying_product', 'swatching'].includes(action))
      || asset.detectedIngredients?.includes('hand_demo')
      || text.includes('hand')
      || text.includes('手')
    );
}

function hasStrongUsageEvidence(_slot: ShotSlotNode, asset: AssetCard): boolean {
  if (hasSpecificUsageActionRequirement(_slot) && !hasUsageActionFamilyMatch(_slot, asset)) return false;
  const text = buildAssetText(asset);
  const hasDrinkLikeCue = hasAnyPositiveCue(text, [
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
  return hasDrinkLikeCue;
}

function hasSpecificUsageActionRequirement(slot: ShotSlotNode): boolean {
  return detectUsageActionFamilies(buildSlotRequirementText(slot)).length > 0;
}

function hasUsageActionFamilyMatch(slot: ShotSlotNode, asset: AssetCard): boolean {
  const requiredFamilies = detectUsageActionFamilies(buildSlotRequirementText(slot));
  if (!requiredFamilies.length) return true;
  const assetFamilies = detectUsageActionFamilies(buildAssetText(asset));
  const transferCompatibleFamilies = new Set(['beverage_drink', 'beverage_pour', 'cap_open', 'pickup_holding']);
  const complexRequiredFamilies = requiredFamilies.filter((family) => !transferCompatibleFamilies.has(family));
  if (complexRequiredFamilies.length) {
    return complexRequiredFamilies.some((family) => assetFamilies.includes(family));
  }
  return requiredFamilies.some((family) => {
    if (assetFamilies.includes(family)) return true;
    if (!transferCompatibleFamilies.has(family)) return false;
    return assetFamilies.some((assetFamily) => transferCompatibleFamilies.has(assetFamily));
  });
}

function detectUsageActionFamilies(text: string): string[] {
  const families: Array<{ family: string; keywords: string[] }> = [
    { family: 'beverage_drink', keywords: ['drink', 'drinking', '饮用', '喝'] },
    { family: 'beverage_pour', keywords: ['pour', '倒', 'cup', '杯'] },
    { family: 'cap_open', keywords: ['open_cap', 'open cap', 'cap opening', '开盖'] },
    { family: 'pickup_holding', keywords: ['pickup', 'pick up', 'hand pickup', 'holding_product', '拿起', '手持'] },
    { family: 'assembly', keywords: ['manual_part_assembly', 'particle_floating_and_assembly', 'assemble', 'assembly', 'install', 'part assembly', 'component', '组装', '安装', '嵌入', '拼接', '归位', '碎片'] },
    { family: 'ui_interaction', keywords: ['smooth_ui_transition', 'ui transition', 'interface', 'application', 'window', 'dock', 'touchpad', 'keyboard', 'button', 'press', 'slide', '界面', '应用', '窗口', '图标', '触控板', '键盘', '按键', '按压', '滑动'] },
    { family: 'color_swap', keywords: ['color_swap', 'color swap', 'color', '配色', '颜色', '渐变切换'] },
    { family: 'device_transfer', keywords: ['device transfer', 'cross-device', 'phone', 'airdrop', 'handoff', '手机', '跨设备', '投送', '接力', '协同'] },
    { family: 'interface_uncover', keywords: ['sequential_interface_uncover', 'port', 'interface uncover', '接口', '侧边', '露出'] },
    { family: 'flip_unfold', keywords: ['flip', 'unfold', 'fold', '翻转', '展开', '开合'] }
  ];
  return families
    .filter(({ keywords }) => keywords.some((keyword) => hasPositiveCue(text, keyword)))
    .map(({ family }) => family);
}

function needsSpecificActionEvidence(slot: ShotSlotNode): boolean {
  const slotText = buildSlotRequirementText(slot);
  return [
    'hand_operation',
    '翻转',
    '打开',
    '开合',
    '展开',
    '组装',
    '安装',
    '按压',
    '滑动',
    '取出',
    '飞入',
    '切换',
    '拼接',
    '弹出',
    '操作',
    '按键',
    'assemble',
    'install',
    'press',
    'slide',
    'flip',
    'open',
    'unfold',
    'keyboard',
    'touchpad',
    'camera'
  ].some((keyword) => slotText.includes(keyword));
}

function hasSpecificActionEvidence(slot: ShotSlotNode, asset: AssetCard): boolean {
  const slotText = buildSlotRequirementText(slot);
  const assetText = buildAssetText(asset);
  const actionFamilies: Array<{ slot: string[]; asset: string[] }> = [
    { slot: ['drink', 'drinking', '饮用', '喝'], asset: ['drink', 'drinking', '饮用', '喝'] },
    { slot: ['pour', '倒', '杯'], asset: ['pour', '倒', 'cup', '杯'] },
    { slot: ['open cap', 'open_cap', 'cap opening', '开盖'], asset: ['open cap', 'open_cap', 'cap opening', '开盖'] },
    { slot: ['pickup', 'pick up', '拿起', '手持'], asset: ['pickup', 'pick up', 'hand pickup', 'holding_product', '拿起', '手持'] },
    { slot: ['flip', '翻转'], asset: ['flip', '翻转'] },
    { slot: ['assemble', 'install', '组装', '安装'], asset: ['assemble', 'install', '组装', '安装'] },
    { slot: ['press', 'touchpad', 'button', '按压', '滑动', '按键'], asset: ['press', 'touchpad', 'button', '按压', '滑动', '按键'] },
    { slot: ['lineup', 'series', 'color', '配色', '陈列'], asset: ['lineup', 'series', '多瓶', '多规格', '配色', '陈列'] }
  ];
  return actionFamilies.some((family) => family.slot.some((keyword) => slotText.includes(keyword)) && family.asset.some((keyword) => assetText.includes(keyword)));
}

function buildSlotRequirementText(slot: ShotSlotNode): string {
  return [
    slot.requiredAsset.subject,
    slot.requiredAsset.motion,
    slot.intent?.purpose,
    slot.intent?.motionPattern,
    slot.sourceInstance?.specificAction,
    slot.acceptanceCriteria?.anyOf.flatMap((criterion) => [criterion.motionType, criterion.compositionType, ...criterion.examples]).join(' '),
  ].filter(Boolean).join(' ').toLowerCase();
}

function hasComparisonEvidence(asset: AssetCard): boolean {
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

function hasBenefitEvidence(asset: AssetCard): boolean {
  const text = buildAssetText(asset);
  return hasAnyPositiveCue(text, [
    'ice cubes',
    'cold drink',
    'splash',
    'lemon',
    'refresh',
    'condensation',
    'pour',
    'drink',
    '冰块',
    '冰爽',
    '飞溅',
    '柠檬',
    '解腻',
    '倒',
    '喝'
  ]);
}

function hasOpeningEvidence(asset: AssetCard): boolean {
  return hasBenefitEvidence(asset)
    || Boolean(asset.detectedIngredients?.includes('lifestyle_context'))
    || Boolean(asset.visualStyleTags?.includes('premium_visual'));
}

function hasCtaEvidence(asset: AssetCard): boolean {
  const text = buildAssetText(asset);
  const textSafeArea = asset.analysis?.quality.textSafeArea ?? 0;
  return asset.type === 'text'
    || text.includes('cta_copy')
    || text.includes('clean_end')
    || text.includes('end frame')
    || text.includes('negative space')
    || text.includes('购买')
    || text.includes('立即')
    || (Boolean(asset.visualStyleTags?.includes('clean_background')) && hasProductCue(asset) && textSafeArea >= 0.72 && !asset.humanPresence?.hasHuman);
}

function hasProductCue(asset: AssetCard): boolean {
  const text = buildAssetText(asset);
  return ['product', 'bottle', 'label', 'packaging', '商品', '产品', '瓶身', '包装', '标签'].some((keyword) => text.includes(keyword));
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
    if (!/(^|[\s_\-;,.])(?:no|not|without|missing|lacks?)(?:\s+[a-z0-9_/-]+){0,3}\s*$/.test(before)) return true;
    index = normalizedText.indexOf(normalizedKeyword, index + normalizedKeyword.length);
  }
  return false;
}

function uniqueRoles(roles: ShotSlotRole[]): ShotSlotRole[] {
  return Array.from(new Set(roles));
}

function uniqueAssetManagerRoles(roles: AssetManagerRole[]): AssetManagerRole[] {
  return Array.from(new Set(roles));
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

function round01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}
