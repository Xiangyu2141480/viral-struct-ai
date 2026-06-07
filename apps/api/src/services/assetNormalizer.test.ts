import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { AssetCard } from '@viral-struct/shared';
import { AssetCardSchema, AssetSupplyContextSchema } from '@viral-struct/shared';
import { loadAssetLibrary } from './assetLibraryLoader';
import { normalizeAssetCard } from './assetManager/assetNormalizer';

const legacyImageCard: AssetCard = {
  id: 'asset_001',
  type: 'image',
  url: '/media/demo-assets/kangshifu_iced_tea/kangshifu-iced-tea-product-shot.png',
  spatialDescription: '冰红茶瓶身居中，纯白背景，正面近景构图。',
  detectedObjects: ['beverage bottle', 'label', 'product'],
  suitableSlots: ['product_closeup', 'cta_visual'],
  qualityScore: 0.84,
  detectedIngredients: ['product_closeup_trait', 'clean_background', 'premium_visual'],
  humanPresence: { hasHuman: false },
  visualStyleTags: ['clean_background', 'premium_visual']
};

test('normalizeAssetCard adds deterministic analysis defaults to a legacy AssetCard', () => {
  const normalized = normalizeAssetCard(legacyImageCard);

  AssetCardSchema.parse(normalized);
  assert.equal(normalized.id, legacyImageCard.id);
  assert.equal(normalized.analysis?.media.kind, 'image');
  assert.equal(normalized.analysis?.media.sourceUrl, legacyImageCard.url);
  assert.equal(normalized.analysis?.semantic.detectedObjects.length, 3);
  assert.equal(normalized.analysis?.quality.overallScore, legacyImageCard.qualityScore);
  assert.equal(normalized.analysis?.slotAffordance.primaryRoles[0]?.role, 'product_closeup');
  assert.equal(normalized.analysis?.slotAffordance.suitableSlots.length, 2);
  assert.equal(normalized.analysis?.editability.canCropZoom, true);
  assert.equal(normalized.analysis?.safety.status, 'passed');
  assert.equal(normalized.analysis?.search.tags.includes('product'), true);
});

test('normalizeAssetCard preserves existing analysis values while filling missing sections', () => {
  const normalized = normalizeAssetCard({
    ...legacyImageCard,
    analysis: {
      profileVersion: 'asset_analysis_v1',
      analyzedAt: '2026-01-01T00:00:00.000Z',
      fallbackUsed: false,
      warnings: [],
      media: {
        kind: 'image',
        sourceUrl: legacyImageCard.url,
        keyframes: []
      },
      semantic: {
        summary: 'custom summary',
        detectedObjects: ['custom object'],
        detectedIngredients: [],
        visualStyleTags: []
      },
      quality: {
        overallScore: 0.42,
        resolution: 0.42,
        sharpness: 0.42,
        brightness: 0.42,
        contrast: 0.42,
        clarity: 0.42,
        composition: 0.42,
        lighting: 0.42,
        subjectProminence: 0.42,
        productFocus: 0.42,
        textSafeArea: 0.42,
        issues: [{ type: 'low_resolution', severity: 'medium', message: 'manual flag' }]
      },
      slotAffordance: {
        suitableSlots: ['cta_visual'],
        primaryRoles: [{ role: 'cta_visual', confidence: 0.91 }],
        missingRoles: ['usage_demo'],
        rationale: 'manual rationale'
      },
      editability: {
        canCropZoom: false,
        canUseAsBackground: true,
        canLoop: false,
        canExtendWithCards: true,
        suggestedEdits: ['manual_edit']
      },
      safety: {
        status: 'needs_review',
        reasons: ['manual review'],
        brandRisk: 'medium',
        ipRisk: 'low',
        claimRisk: 'low'
      },
      search: {
        tags: ['manual'],
        keywords: ['manual keyword'],
        embeddingText: 'manual embedding'
      }
    }
  });

  assert.equal(normalized.analysis?.semantic.summary, 'custom summary');
  assert.equal(normalized.analysis?.quality.overallScore, 0.42);
  assert.equal(normalized.analysis?.slotAffordance.primaryRoles[0]?.confidence, 0.91);
  assert.equal(normalized.analysis?.safety.status, 'needs_review');
});

test('loadAssetLibrary keeps the legacy Kangshifu library loadable and normalized', async () => {
  const cards = await loadAssetLibrary('kangshifu_demo');

  assert.equal(cards.length, 3);
  for (const card of cards) {
    AssetCardSchema.parse(card);
    assert.equal(card.analysis?.profileVersion, 'asset_analysis_v1');
    assert.equal(card.analysis?.media.kind, card.type);
    assert.ok(card.analysis?.slotAffordance.suitableSlots.length);
  }
});

test('AssetSupplyContext sample validates against shared schema and excludes fallback cards', async () => {
  const samplePath = fileURLToPath(
    new URL('../../../../docs/examples/asset-supply-context.sample.json', import.meta.url)
  );
  const sample = JSON.parse(await readFile(samplePath, 'utf8'));
  const parsed = AssetSupplyContextSchema.parse(sample);

  assert.equal(parsed.protocolVersion, 'asset-supply-v1');
  assert.equal(parsed.assets.length, 3);
  assert.equal(parsed.contextualCoverage?.slotCoverages.length, 3);
  assert.ok(parsed.contextualCoverage?.observations.length >= 2);
  assert.equal(JSON.stringify(parsed).includes('fallbackCards'), false);
  assert.equal(JSON.stringify(parsed).includes('suggestedRepair'), false);
});
