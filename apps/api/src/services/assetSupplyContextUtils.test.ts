import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetSupplyContext } from '@viral-struct/shared';
import {
  getBestCandidatesForSlot,
  getCoverageForSlot,
  getMissingIngredientsForSlot,
  getObservationsForSlot,
  summarizeCoverageForSlot
} from './assetManager/assetSupplyContextUtils';

const context: AssetSupplyContext = {
  protocolVersion: 'asset-supply-v1',
  libraryId: 'kangshifu_demo',
  generatedAt: '1970-01-01T00:00:00.000Z',
  assets: [],
  libraryProfile: {
    libraryId: 'kangshifu_demo',
    assetCount: 0,
    byType: { image: 0, video: 0, text: 0 },
    avgQualityScore: 0,
    coveredSlots: [],
    missingSlots: [],
    roleCoverage: {
      opening_hook: { role: 'opening_hook', status: 'missing', bestScore: 0, assetIds: [] },
      product_closeup: { role: 'product_closeup', status: 'missing', bestScore: 0, assetIds: [] },
      usage_demo: { role: 'usage_demo', status: 'missing', bestScore: 0, assetIds: [] },
      comparison: { role: 'comparison', status: 'missing', bestScore: 0, assetIds: [] },
      benefit_proof: { role: 'benefit_proof', status: 'missing', bestScore: 0, assetIds: [] },
      lifestyle_scene: { role: 'lifestyle_scene', status: 'missing', bestScore: 0, assetIds: [] },
      background: { role: 'background', status: 'missing', bestScore: 0, assetIds: [] },
      packaging_card: { role: 'packaging_card', status: 'missing', bestScore: 0, assetIds: [] },
      cta: { role: 'cta', status: 'missing', bestScore: 0, assetIds: [] },
      cover: { role: 'cover', status: 'missing', bestScore: 0, assetIds: [] }
    },
    missingRoles: [],
    weakRoles: [],
    topAssetsByRole: {
      opening_hook: [],
      product_closeup: [],
      usage_demo: [],
      comparison: [],
      benefit_proof: [],
      lifestyle_scene: [],
      background: [],
      packaging_card: [],
      cta: [],
      cover: []
    },
    recommendations: [],
    warnings: [],
    generatedAt: '1970-01-01T00:00:00.000Z'
  },
  contextualCoverage: {
    graphId: 'structure_graph_input',
    libraryId: 'kangshifu_demo',
    coverageSummary: {
      totalSlots: 1,
      coveredSlots: 0,
      weakSlots: 0,
      insufficientSlots: 1,
      coverageScore: 0
    },
    slotCoverages: [
      {
        slotId: 'slot_usage',
        affectedSegmentId: 'seg_usage',
        slotRole: 'usage_demo',
        slotIntent: 'Prove real use.',
        requiredIngredients: [
          {
            id: 'slot_usage_usage_evidence',
            kind: 'usage_evidence',
            label: 'real use evidence',
            requiredBy: { segmentId: 'seg_usage', slotId: 'slot_usage' },
            importance: 'high'
          }
        ],
        availableIngredients: [],
        missingIngredients: [
          {
            requiredIngredientId: 'slot_usage_usage_evidence',
            label: 'real use evidence',
            reason: 'No hand-operation clip.',
            evidence: ['bestScore=42']
          }
        ],
        weakIngredients: [],
        candidateAssets: [
          {
            assetId: 'asset_splash',
            score: 42,
            fitStatus: 'weak',
            usableAs: 'image_clip',
            mediaReadiness: {
              hasUsableUrl: true,
              hasLocalPath: true,
              hasThumbnail: false,
              hasKeyframe: false,
              hasDuration: false
            },
            constraints: { notEnoughForStandaloneShot: true, needsOverlaySupport: true },
            evidence: {
              affordanceScore: 45,
              qualityScore: 88,
              semanticSignals: ['splash still'],
              keyframeIds: [],
              reasons: ['Static image lacks usage evidence.'],
              warnings: []
            }
          }
        ],
        coverageStatus: 'insufficient',
        confidence: 'low',
        evidence: ['coverageStatus=insufficient', 'bestScore=42'],
        limitations: ['Candidate should not be treated as standalone usage shot.']
      }
    ],
    observations: [
      {
        id: 'coverage_observation_001_slot_usage',
        affectedSegmentId: 'seg_usage',
        affectedSlotId: 'slot_usage',
        slotRole: 'usage_demo',
        slotIntent: 'Prove real use.',
        observationType: 'missing_usage_evidence',
        requiredIngredients: [
          {
            id: 'slot_usage_usage_evidence',
            kind: 'usage_evidence',
            label: 'real use evidence',
            requiredBy: { segmentId: 'seg_usage', slotId: 'slot_usage' },
            importance: 'high'
          }
        ],
        missingIngredients: [
          {
            requiredIngredientId: 'slot_usage_usage_evidence',
            label: 'real use evidence',
            reason: 'No hand-operation clip.',
            evidence: ['bestScore=42']
          }
        ],
        availableButWeakIngredients: [],
        bestCandidateAssetIds: ['asset_splash'],
        potentialImpact: [
          {
            type: 'usage_proof_missing',
            description: 'Usage proof may need downstream repair.',
            affectedMetric: 'slotCoverage',
            severity: 'high'
          }
        ],
        severityEstimate: 'high',
        confidence: 'low',
        evidence: ['coverageStatus=insufficient', 'bestScore=42'],
        ownership: 'asset_manager_observation_only'
      }
    ],
    warnings: []
  },
  warnings: []
};

test('asset supply context helpers return slot-level evidence without treating observations as final gaps', () => {
  assert.equal(getCoverageForSlot(context, 'slot_usage')?.coverageStatus, 'insufficient');
  assert.equal(getBestCandidatesForSlot(context, 'slot_usage')[0]?.assetId, 'asset_splash');
  assert.equal(getObservationsForSlot(context, 'slot_usage')[0]?.ownership, 'asset_manager_observation_only');
  assert.equal(getMissingIngredientsForSlot(context, 'slot_usage')[0]?.label, 'real use evidence');

  const summary = summarizeCoverageForSlot(context, 'slot_usage');
  assert.match(summary, /insufficient/);
  assert.match(summary, /real use evidence/);
  assert.match(summary, /asset supply observation/);
});

test('asset supply context helpers handle missing contextual coverage gracefully', () => {
  const emptyContext = { ...context, contextualCoverage: undefined };

  assert.equal(getCoverageForSlot(emptyContext, 'slot_usage'), undefined);
  assert.deepEqual(getBestCandidatesForSlot(emptyContext, 'slot_usage'), []);
  assert.deepEqual(getObservationsForSlot(emptyContext, 'slot_usage'), []);
  assert.deepEqual(getMissingIngredientsForSlot(emptyContext, 'slot_usage'), []);
  assert.equal(summarizeCoverageForSlot(emptyContext, 'slot_usage'), 'No asset supply coverage is available for slot_usage.');
});
