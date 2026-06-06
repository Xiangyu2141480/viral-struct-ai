import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetCard, ContentBrief } from '@viral-struct/shared';
import { normalizeAssetCard } from './assetManager/assetNormalizer';
import { enrichAssetsWithOptionalVlm } from './assetManager/optionalVlmAssetAnalyzer';

interface FakeClient {
  chat: { completions: { create: (req: unknown) => Promise<{ choices: Array<{ message: { content: string } }> }> } };
}

const brief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏季通勤人群',
  scenario: '午后高温',
  sellingPoints: ['冰爽解腻', '柠檬茶香'],
  cta: '来一瓶冰红茶'
};

function makeCard(): AssetCard {
  return normalizeAssetCard({
    id: 'asset_001',
    type: 'image',
    url: '/tmp/kangshifu.png',
    spatialDescription: 'Deterministic product image.',
    detectedObjects: ['product'],
    suitableSlots: ['product_closeup'],
    qualityScore: 0.78
  });
}

function makeClient(responseJson: string, requests: unknown[] = []): FakeClient {
  return {
    chat: {
      completions: {
        create: async (req: unknown) => {
          requests.push(req);
          return { choices: [{ message: { content: responseJson } }] };
        }
      }
    }
  };
}

function happyVlmResponse(): string {
  return JSON.stringify({
    shortCaption: 'Cold iced tea bottle with bright lemon and ice cues.',
    sceneType: 'product_packshot',
    productVisible: true,
    productVisibilityScore: 93,
    detectedObjects: ['beverage bottle', 'lemon slice', 'ice cubes'],
    textVisible: true,
    suggestedRoles: ['product_closeup', 'cover'],
    rationale: 'The centered bottle label and clean negative space support product closeup and cover roles.',
    risks: []
  });
}

test('enrichAssetsWithOptionalVlm is disabled by default and does not call the VLM client', async () => {
  let called = false;
  const result = await enrichAssetsWithOptionalVlm({
    assetCards: [makeCard()],
    contentBrief: brief,
    enabled: false,
    model: 'fake-vlm',
    clientFactory: () => {
      called = true;
      return makeClient(happyVlmResponse()) as never;
    }
  });

  assert.equal(called, false);
  assert.equal(result.vlmStatus, 'disabled');
  assert.equal(result.assetCards[0].analysis?.vlm, undefined);
  assert.deepEqual(result.warnings, []);
});

test('enrichAssetsWithOptionalVlm accepts a validated mock VLM JSON response and enriches analysis fields', async () => {
  const requests: unknown[] = [];
  const result = await enrichAssetsWithOptionalVlm({
    assetCards: [makeCard()],
    contentBrief: brief,
    enabled: true,
    model: 'fake-vlm',
    clientFactory: () => makeClient(happyVlmResponse(), requests) as never
  });

  const enriched = result.assetCards[0];
  assert.equal(result.vlmStatus, 'enhanced');
  assert.equal(enriched.analysis?.vlm?.shortCaption, 'Cold iced tea bottle with bright lemon and ice cues.');
  assert.equal(enriched.analysis?.vlm?.productVisibilityScore, 93);
  assert.ok(enriched.analysis?.semantic.detectedObjects.includes('lemon slice'));
  assert.equal(enriched.analysis?.quality.productFocus, 0.93);
  assert.match(JSON.stringify(requests[0]), /Do not invent product efficacy claims/);
});

test('enrichAssetsWithOptionalVlm falls back to deterministic analysis on malformed JSON', async () => {
  const original = makeCard();
  const result = await enrichAssetsWithOptionalVlm({
    assetCards: [original],
    contentBrief: brief,
    enabled: true,
    model: 'fake-vlm',
    clientFactory: () => makeClient('not-json') as never
  });

  assert.equal(result.vlmStatus, 'fallback');
  assert.equal(result.assetCards[0].analysis?.vlm, undefined);
  assert.equal(result.assetCards[0].analysis?.semantic.summary, original.analysis?.semantic.summary);
  assert.ok(result.assetCards[0].analysis?.warnings.some((warning) => warning.includes('Optional VLM analyzer failed')));
  assert.ok(result.warnings.some((warning) => warning.includes('asset_001')));
});
