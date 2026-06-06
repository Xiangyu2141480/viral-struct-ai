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
    const suitableSlots = uniqueRoles([...normalized.suitableSlots, ...primaryRoles]);
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
  const status = coverageStatusFromScore(bestScore);
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
    gapReason: buildGapReason(slot, status, roleScores[mappedRole]?.[0])
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
  if (slot.humanRequirement?.required && !asset.humanPresence?.hasHuman) return Math.min(score, 49);
  if (slot.humanRequirement?.action && slot.humanRequirement.action !== 'none' && !asset.humanPresence?.actions?.includes(slot.humanRequirement.action)) {
    return Math.min(score, 49);
  }
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
  bestRoleCandidate?: SlotCandidateAsset
): string | undefined {
  if (status === 'covered') return undefined;
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
