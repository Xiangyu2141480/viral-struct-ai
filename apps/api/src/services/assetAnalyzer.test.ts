import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AssetCardSchema, type AssetCard } from '@viral-struct/shared';
import { analyzeAssetsMock, analyzeAssetsWithFallback } from './assetAnalyzer';

// ---------------------------------------------------------------------------
// analyzeAssetsWithFallback
// ---------------------------------------------------------------------------

test('analyzeAssetsWithFallback uses deterministic analysis without an LLM key', async () => {
  const fakeFile = {
    originalname: 'kangshifu-iced-tea-splash.png',
    path: '/nonexistent/path/that/will/fail.png'
  } as Express.Multer.File;
  const cards = await analyzeAssetsWithFallback({
    files: [fakeFile],
    // Deterministic analysis should not call the LLM client.
    clientFactory: () => { throw new Error('LLM unreachable'); }
  });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].analysisSource, 'deterministic');
  assert.equal(cards[0].analysis?.source, 'deterministic');
  assert.equal(cards[0].analysis?.fallbackUsed, true);
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
  }
  assert.equal(cards[0].analysisSource, 'mock_filename_rules');
  assert.equal(cards[1].analysisSource, 'manual_text_brief');
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
