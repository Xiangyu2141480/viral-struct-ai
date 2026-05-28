import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AssetCardSchema, type AssetCard } from '@viral-struct/shared';
import { analyzeAssetsLLM, analyzeAssetsMock, analyzeAssetsWithFallback, parseAssetCardResponse } from './assetAnalyzer';

// 1×1 transparent PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

function happyJsonResponse(): string {
  return JSON.stringify({
    spatialDescription: '深棕色饮料瓶居中下方，深色背景。',
    temporalDescription: null,
    detectedObjects: ['beverage bottle', 'ice cubes'],
    suitableSlots: ['opening_attention', 'benefit_visual'],
    qualityScore: 0.88,
    detectedIngredients: ['product_closeup_trait', 'premium_visual'],
    humanPresence: { hasHuman: false },
    visualStyleTags: ['premium_visual', 'lifestyle_context'],
    visualContent: {
      primarySubject: '深棕色饮料瓶',
      subjectPosition: 'center_lower_third',
      negativeSpace: 'dark_gradient_upper_two_thirds',
      kinematicElements: ['liquid_splash', 'ice_cubes_in_flight'],
      lighting: 'high_contrast_studio',
      colorPalette: ['#1a0e08 dark_brown', '#d4a574 amber']
    },
    motionPotential: {
      isStill: true,
      implicitMotion: 'high',
      canSimulateMotion: ['zoom_in_on_splash', 'ken_burns_pan_left'],
      canSimulateDurationMs: [600, 2400]
    },
    candidateSlotRoles: [
      { role: 'opening_attention', confidence: 0.92, caveat: null },
      { role: 'benefit_visual', confidence: 0.78, caveat: "需配字幕'冰爽'增强" }
    ]
  });
}

// ---------------------------------------------------------------------------
// parseAssetCardResponse: schema + null-stripping
// ---------------------------------------------------------------------------

test('parseAssetCardResponse parses well-formed JSON with v1 fields', () => {
  const card = parseAssetCardResponse(happyJsonResponse(), {
    id: 'asset_001',
    type: 'image',
    url: '/tmp/img.png'
  });
  assert.equal(card.id, 'asset_001');
  assert.equal(card.analysisSource, 'llm_multimodal');
  assert.equal(card.visualContent?.primarySubject, '深棕色饮料瓶');
  assert.deepEqual(card.motionPotential?.canSimulateDurationMs, [600, 2400]);
  assert.equal(card.candidateSlotRoles?.length, 2);
  assert.equal(card.candidateSlotRoles?.[0].confidence, 0.92);
  // null caveat should have been stripped before schema parsing
  assert.equal(card.candidateSlotRoles?.[0].caveat, undefined);
});

test('parseAssetCardResponse tolerates ```json fenced output', () => {
  const fenced = '```json\n' + happyJsonResponse() + '\n```';
  const card = parseAssetCardResponse(fenced, { id: 'asset_002', type: 'image' });
  assert.equal(card.visualContent?.lighting, 'high_contrast_studio');
});

test('parseAssetCardResponse rejects malformed kinematicElements', () => {
  const bad = JSON.stringify({
    spatialDescription: 'x',
    detectedObjects: [],
    suitableSlots: ['cta_visual'],
    qualityScore: 0.5,
    visualContent: {
      primarySubject: 'x',
      subjectPosition: 'x',
      kinematicElements: 'not-an-array' // schema violation
    }
  });
  assert.throws(() => parseAssetCardResponse(bad, { id: 'asset_001', type: 'image' }));
});

// ---------------------------------------------------------------------------
// analyzeAssetsLLM with mocked client
// ---------------------------------------------------------------------------

interface FakeClient {
  chat: { completions: { create: (req: unknown) => Promise<{ choices: Array<{ message: { content: string } }> }> } };
}

function makeFakeClient(responseJson: string): FakeClient {
  return {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: responseJson } }] })
      }
    }
  };
}

test('analyzeAssetsLLM round-trips an image through the mocked client', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'asset-analyzer-test-'));
  const imgPath = path.join(dir, 'kangshifu-iced-tea-splash.png');
  await writeFile(imgPath, TINY_PNG);
  try {
    const fakeFile = {
      originalname: 'kangshifu-iced-tea-splash.png',
      path: imgPath
    } as Express.Multer.File;
    const cards = await analyzeAssetsLLM({
      files: [fakeFile],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: () => makeFakeClient(happyJsonResponse()) as any,
      model: 'fake-model-id'
    });
    assert.equal(cards.length, 1);
    AssetCardSchema.parse(cards[0]); // sanity
    assert.equal(cards[0].id, 'asset_001');
    assert.equal(cards[0].analysisSource, 'llm_multimodal');
    assert.equal(cards[0].visualContent?.kinematicElements.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('analyzeAssetsLLM rejects video files (not yet supported)', async () => {
  const fakeVideo = { originalname: 'demo.mp4', path: '/tmp/demo.mp4' } as Express.Multer.File;
  await assert.rejects(
    analyzeAssetsLLM({
      files: [fakeVideo],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: () => makeFakeClient(happyJsonResponse()) as any,
      model: 'fake'
    }),
    /does not yet support video/
  );
});

// ---------------------------------------------------------------------------
// analyzeAssetsWithFallback
// ---------------------------------------------------------------------------

test('analyzeAssetsWithFallback falls back to mock when LLM throws', async () => {
  const fakeFile = {
    originalname: 'kangshifu-iced-tea-splash.png',
    path: '/nonexistent/path/that/will/fail.png'
  } as Express.Multer.File;
  const cards = await analyzeAssetsWithFallback({
    files: [fakeFile],
    // Throwing client triggers fallback
    clientFactory: () => { throw new Error('LLM unreachable'); }
  });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].analysisSource, 'mock_filename_rules');
});

// ---------------------------------------------------------------------------
// Mock keeps producing valid AssetCards (no regression)
// ---------------------------------------------------------------------------

test('analyzeAssetsMock output still validates against AssetCardSchema', async () => {
  const fakeFile = { originalname: 'hand-demo.mp4', path: '/tmp/x.mp4' } as Express.Multer.File;
  const cards = await analyzeAssetsMock([fakeFile], 'demo brief text');
  assert.equal(cards.length, 2); // file + text_brief
  for (const c of cards) {
    AssetCardSchema.parse(c);
    assert.equal(c.analysisSource, 'mock_filename_rules');
  }
});

// ---------------------------------------------------------------------------
// Schema backward compatibility
// ---------------------------------------------------------------------------

test('AssetCardSchema still accepts v0 cards without v1 fields', () => {
  const v0Card: AssetCard = {
    id: 'asset_001',
    type: 'image',
    detectedObjects: ['product'],
    suitableSlots: ['product_closeup'],
    qualityScore: 0.8
  };
  AssetCardSchema.parse(v0Card);
});
