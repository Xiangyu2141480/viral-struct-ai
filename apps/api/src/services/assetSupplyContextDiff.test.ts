import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssetCard, AssetSupplyContext, ContextualSlotCoverage, MissingIngredient } from '@viral-struct/shared';
import {
  buildAssetMarginalContributionReport,
  buildCoverageSnapshot,
  buildIncrementalContributionStep,
  buildLeaveOneOutContribution,
  diffCoverageSnapshots,
  diffMissingIngredients,
  diffSlotCoverage,
  summarizePerAssetContribution
} from './assetManager/assetSupplyContextDiff';

test('buildCoverageSnapshot and diffCoverageSnapshots compare high-level coverage', () => {
  const previous = context(['asset_a'], [slot('slot_1', 'weak', 'asset_a', [ingredient('motion')])]);
  const next = context(['asset_a', 'asset_b'], [slot('slot_1', 'covered', 'asset_b')]);

  const previousSnapshot = buildCoverageSnapshot(previous);
  const nextSnapshot = buildCoverageSnapshot(next);
  const delta = diffCoverageSnapshots(previousSnapshot, nextSnapshot);

  assert.equal(previousSnapshot.coverageScore, 50);
  assert.equal(nextSnapshot.coverageScore, 100);
  assert.equal(delta.coverageScoreDelta, 50);
  assert.equal(delta.coveredSlotsDelta, 1);
  assert.equal(delta.weakSlotsDelta, -1);
});

test('diffSlotCoverage detects status and best candidate transitions', () => {
  const previous = context(['asset_a'], [slot('slot_1', 'weak', 'asset_a')]);
  const next = context(['asset_a', 'asset_b'], [slot('slot_1', 'covered', 'asset_b')]);

  const changes = diffSlotCoverage(previous, next);

  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.previousStatus, 'weak');
  assert.equal(changes[0]?.nextStatus, 'covered');
  assert.equal(changes[0]?.previousBestAssetId, 'asset_a');
  assert.equal(changes[0]?.nextBestAssetId, 'asset_b');
  assert.match(changes[0]?.reason ?? '', /status changed/i);
});

test('diffMissingIngredients detects resolved ingredients even when status remains weak', () => {
  const previous = context(['asset_a'], [
    slot('slot_1', 'weak', 'asset_a', [ingredient('motion'), ingredient('text_safe_area')])
  ]);
  const next = context(['asset_a', 'asset_b'], [
    slot('slot_1', 'weak', 'asset_b', [ingredient('text_safe_area')])
  ]);

  const deltas = diffMissingIngredients(previous, next);

  assert.equal(deltas.some((delta) => delta.ingredientLabel === 'motion' && delta.change === 'resolved'), true);
  assert.equal(deltas.some((delta) => delta.ingredientLabel === 'text_safe_area' && delta.change === 'still_missing'), true);
});

test('leave-one-out detects unique contribution', () => {
  const full = context(['asset_a', 'asset_b'], [slot('slot_1', 'covered', 'asset_b')]);
  const without = context(['asset_a'], [slot('slot_1', 'weak', 'asset_a', [ingredient('motion')])]);

  const contribution = buildLeaveOneOutContribution({
    removedAsset: asset('asset_b'),
    fullContext: full,
    withoutAssetContext: without
  });

  assert.equal(contribution.deltaIfRemoved.coverageScoreDelta, -50);
  assert.equal(contribution.affectedSlots[0]?.slotId, 'slot_1');
  assert.match(contribution.interpretation.join(' '), /unique/i);
});

test('summarizePerAssetContribution classifies redundant supporting assets', () => {
  const assetA = asset('asset_a');
  const assetB = asset('asset_b');
  const stepA = buildIncrementalContributionStep({
    addedAsset: assetA,
    previousContext: context([], []),
    nextContext: context(['asset_a'], [slot('slot_1', 'weak', 'asset_a', [ingredient('motion')])])
  });
  const stepB = buildIncrementalContributionStep({
    addedAsset: assetB,
    previousContext: context(['asset_a'], [slot('slot_1', 'weak', 'asset_a', [ingredient('motion')])]),
    nextContext: context(['asset_a', 'asset_b'], [slot('slot_1', 'weak', 'asset_a', [ingredient('motion')])])
  });
  const leaveOneOut = buildLeaveOneOutContribution({
    removedAsset: assetB,
    fullContext: context(['asset_a', 'asset_b'], [slot('slot_1', 'weak', 'asset_a', [ingredient('motion')])]),
    withoutAssetContext: context(['asset_a'], [slot('slot_1', 'weak', 'asset_a', [ingredient('motion')])])
  });

  const summaries = summarizePerAssetContribution({
    assetCards: [assetA, assetB],
    incrementalSteps: [stepA, stepB],
    leaveOneOut: [leaveOneOut]
  });

  const redundant = summaries.find((summary) => summary.assetId === 'asset_b');
  assert.equal(redundant?.uniqueContribution, false);
  assert.equal(redundant?.recommendedUse, 'redundant_material');
  assert.equal((redundant?.noGainReasons ?? []).some((reason) => /overlap|existing/i.test(reason)), true);
});

test('buildAssetMarginalContributionReport handles empty libraries and emits no repair artifacts', () => {
  const empty = context([], []);
  const report = buildAssetMarginalContributionReport({
    libraryId: 'empty_library',
    baselineContext: empty,
    fullContext: empty,
    incrementalSteps: [],
    leaveOneOut: [],
    perAssetSummary: [],
    warnings: []
  });

  assert.equal(report.fullSet.coverageScore, 0);
  assert.equal(report.perAssetSummary.length, 0);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes('fallbackCards'), false);
  assert.equal(serialized.includes('suggestedRepair'), false);
});

function asset(id: string): AssetCard {
  return {
    id,
    type: 'video',
    url: `seed_assets/user_test/${id}.mp4`,
    spatialDescription: `${id} product video`,
    temporalDescription: `${id} temporal evidence`,
    detectedObjects: ['product'],
    suitableSlots: ['product_closeup'],
    qualityScore: 0.74
  };
}

function context(assetIds: string[], slots: ContextualSlotCoverage[]): AssetSupplyContext {
  const totalSlots = slots.length;
  const coveredSlots = slots.filter((row) => row.coverageStatus === 'covered').length;
  const weakSlots = slots.filter((row) => row.coverageStatus === 'weak').length;
  const insufficientSlots = slots.filter((row) => row.coverageStatus === 'insufficient').length;
  return {
    protocolVersion: 'asset-supply-v1',
    libraryId: 'test_library',
    generatedAt: '1970-01-01T00:00:00.000Z',
    assets: assetIds.map((id) => asset(id)) as AssetSupplyContext['assets'],
    libraryProfile: {
      libraryId: 'test_library',
      assetCount: assetIds.length,
      byType: { image: 0, video: assetIds.length, text: 0 },
      avgQualityScore: 0.74,
      qualitySummary: { avgQualityScore: 0.74, lowQualityAssetIds: [], warningCount: 0 },
      coveredSlots: [],
      missingSlots: [],
      roleCoverage: {} as AssetSupplyContext['libraryProfile']['roleCoverage'],
      missingRoles: [],
      weakRoles: [],
      topAssetsByRole: {} as AssetSupplyContext['libraryProfile']['topAssetsByRole'],
      recommendations: [],
      warnings: [],
      generatedAt: '1970-01-01T00:00:00.000Z'
    },
    contextualCoverage: {
      graphId: 'test_graph',
      libraryId: 'test_library',
      coverageSummary: {
        totalSlots,
        coveredSlots,
        weakSlots,
        insufficientSlots,
        coverageScore: totalSlots === 0 ? 0 : Number((((coveredSlots + weakSlots * 0.5) / totalSlots) * 100).toFixed(1))
      },
      slotCoverages: slots,
      observations: slots
        .filter((row) => row.coverageStatus !== 'covered')
        .map((row, index) => ({
          id: `obs_${index}`,
          affectedSlotId: row.slotId,
          slotRole: row.slotRole,
          slotIntent: row.slotIntent,
          observationType: 'missing_motion_evidence',
          requiredIngredients: row.requiredIngredients,
          missingIngredients: row.missingIngredients,
          availableButWeakIngredients: row.weakIngredients,
          bestCandidateAssetIds: row.candidateAssets.map((candidate) => candidate.assetId),
          potentialImpact: [],
          severityEstimate: 'low',
          confidence: 'medium',
          evidence: [],
          ownership: 'asset_manager_observation_only'
        })),
      warnings: []
    },
    warnings: []
  };
}

function slot(
  slotId: string,
  coverageStatus: ContextualSlotCoverage['coverageStatus'],
  bestAssetId?: string,
  weakIngredients: MissingIngredient[] = []
): ContextualSlotCoverage {
  return {
    slotId,
    affectedSegmentId: 'segment_1',
    slotRole: 'usage_demo',
    slotIntent: 'Show usage motion',
    requiredIngredients: [],
    availableIngredients: coverageStatus === 'covered' && bestAssetId
      ? [{ requiredIngredientId: 'motion', assetId: bestAssetId, score: 80, evidence: ['motion evidence'] }]
      : [],
    missingIngredients: coverageStatus === 'insufficient' ? weakIngredients : [],
    weakIngredients: coverageStatus === 'weak' ? weakIngredients : [],
    candidateAssets: bestAssetId ? [{
      assetId: bestAssetId,
      score: coverageStatus === 'covered' ? 82 : 62,
      fitStatus: coverageStatus === 'covered' ? 'strong' : 'usable',
      usableAs: 'video_clip',
      mediaReadiness: {
        hasUsableUrl: true,
        hasLocalPath: true,
        hasThumbnail: false,
        hasKeyframe: false,
        hasDuration: true
      },
      constraints: {
        notEnoughForStandaloneShot: coverageStatus !== 'covered'
      },
      evidence: {
        affordanceScore: coverageStatus === 'covered' ? 82 : 62,
        qualityScore: 74,
        semanticSignals: [],
        reasons: [`${bestAssetId} is best candidate`],
        warnings: []
      }
    }] : [],
    coverageStatus,
    confidence: coverageStatus === 'covered' ? 'high' : 'medium',
    evidence: [`coverageStatus=${coverageStatus}`],
    limitations: coverageStatus === 'covered' ? [] : ['needs stronger motion evidence']
  };
}

function ingredient(label: string): MissingIngredient {
  return {
    requiredIngredientId: label,
    label,
    reason: `${label} is missing`,
    evidence: []
  };
}
