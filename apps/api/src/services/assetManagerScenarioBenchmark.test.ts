import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetSupplyContext } from '@viral-struct/shared';
import {
  buildScenarioComparisonReport,
  summarizeScenarioRun
} from './assetManager/scenarioBenchmarkReporter';

function contextFixture(overrides: Partial<AssetSupplyContext> = {}): AssetSupplyContext {
  return {
    protocolVersion: 'asset-supply-v1',
    libraryId: 'fixture',
    generatedAt: '1970-01-01T00:00:00.000Z',
    assets: [],
    libraryProfile: {
      libraryId: 'fixture',
      assetCount: 0,
      mediaTypeCounts: { image: 0, video: 0, text: 0 },
      averageQualityScore: 0,
      roleCoverage: {},
      missingRoles: [],
      weakRoles: [],
      topAssetsByRole: {},
      recommendations: []
    },
    contextualCoverage: {
      graphId: 'fixture_graph',
      libraryId: 'fixture',
      coverageSummary: {
        totalSlots: 3,
        coveredSlots: 1,
        weakSlots: 1,
        insufficientSlots: 1,
        coverageScore: 50
      },
      slotCoverages: [],
      observations: [
        {
          id: 'obs_1',
          affectedSlotId: 'slot_usage',
          slotRole: 'usage_demo',
          slotIntent: 'usage evidence',
          observationType: 'missing_usage_evidence',
          requiredIngredients: [],
          missingIngredients: [],
          availableButWeakIngredients: [],
          bestCandidateAssetIds: [],
          potentialImpact: [],
          severityEstimate: 'high',
          confidence: 'medium',
          evidence: [],
          ownership: 'asset_manager_observation_only'
        }
      ],
      warnings: []
    },
    materialScenario: {
      scenarioType: 'partial_real_footage',
      assetCount: 2,
      imageCount: 0,
      videoCount: 2,
      textCount: 0,
      generatedAssetCount: 0,
      realFootageCount: 2,
      evidenceCoverageScore: 50,
      completionFeasibilityScore: 72,
      summary: 'fixture',
      strengths: [],
      weaknesses: [],
      recommendedDownstreamMode: 'mixed_repair_workflow',
      warnings: []
    },
    missingMaterialBriefs: [],
    warnings: [],
    ...overrides
  } as AssetSupplyContext;
}

test('summarizeScenarioRun exposes observations and downstreamMode for benchmark rows', () => {
  const summary = summarizeScenarioRun({
    scenario: 'partial_real_footage',
    outputPath: 'tmp/asset-supply-partial-real.json',
    context: contextFixture()
  });

  assert.equal(summary.scenario, 'partial_real_footage');
  assert.equal(summary.evidenceCoverage, 50);
  assert.equal(summary.completionFeasibility, 72);
  assert.equal(summary.covered, 1);
  assert.equal(summary.weak, 1);
  assert.equal(summary.insufficient, 1);
  assert.equal(summary.observations, 1);
  assert.equal(summary.missingBriefs, 0);
  assert.equal(summary.downstreamMode, 'mixed_repair_workflow');
});

test('buildScenarioComparisonReport includes the required judge-facing table columns', () => {
  const report = buildScenarioComparisonReport([{
    scenario: 'partial_real_footage',
    outputPath: 'tmp/asset-supply-partial-real.json',
    context: contextFixture()
  }], {
    structureGraph: 'seed_assets/analysis/macbook_neo/structure_graph.json',
    originalAssetCards: 'seed_assets/asset_libraries/kangshifu_demo/asset_cards.json',
    plainAssetCards: 'seed_assets/asset_libraries/kangshifu_plain_user_test/asset_cards.json',
    aigcSampleDescriptor: 'docs/examples/scenario-aigc-ready.sample.json'
  });

  assert.match(report, /\| scenario \| evidenceCoverage \| completionFeasibility \| covered \| weak \| insufficient \| observations \| missingBriefs \| downstreamMode \|/);
  assert.match(report, /\| partial_real_footage \| 50 \| 72 \| 1 \| 1 \| 1 \| 1 \| 0 \| mixed_repair_workflow \|/);
  assert.equal(report.includes('fallbackCards'), false);
  assert.equal(report.includes('suggestedRepair'), false);
});
