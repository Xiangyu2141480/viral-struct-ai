import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeAssetsMock } from './assetAnalyzer';
import { planGapRepairs } from './gapRepairPlanner';
import { matchSlots } from './slotMatcher';
import { extractCreativeIngredientsMock } from './visualIngredientExtractor';

const blockedTerms = [
  '高颜值',
  '美女',
  '帅哥',
  '颜值',
  '近脸',
  '上脸',
  '肤质',
  'face_closeup',
  'beauty_demo'
];

test('mock creative ingredients avoid appearance and sensitive-attribute language', () => {
  assertSafeText(JSON.stringify(extractCreativeIngredientsMock()));
});

test('asset analyzer avoids face and beauty ingredient outputs', async () => {
  const assets = await analyzeAssetsMock([
    {
      originalname: 'host-beauty-swatch.mp4',
      path: '/tmp/host-beauty-swatch.mp4'
    } as Express.Multer.File
  ]);

  assertSafeText(JSON.stringify(assets));
  assert.ok(assets[0]?.detectedIngredients?.includes('human_presence'));
  assert.ok(!assets[0]?.detectedIngredients?.includes('face_closeup'));
  assert.ok(!assets[0]?.detectedIngredients?.includes('beauty_demo'));
});

test('gap repair copy avoids appearance and sensitive-attribute language', () => {
  const repairs = planGapRepairs([
    {
      slotId: 'slot_1',
      type: 'missing_face_closeup',
      role: 'opening_attention',
      reason: 'test',
      impact: 'test',
      severity: 'high'
    },
    {
      slotId: 'slot_2',
      type: 'missing_beauty_demo',
      role: 'usage_demo',
      reason: 'test',
      impact: 'test',
      severity: 'medium'
    }
  ], []);

  assertSafeText(JSON.stringify(repairs));
});

test('slot matcher sanitizes legacy appearance ingredient gaps before output', () => {
  const result = matchSlots({
    meta: { duration: 5, aspectRatio: '9:16', videoType: 'ecommerce', style: 'unknown' },
    structureSummary: 'test',
    segments: [{
      id: 'seg_1',
      role: 'usage',
      start: 0,
      end: 5,
      duration: 5,
      purpose: 'test',
      transferRule: 'test',
      importance: 3
    }],
    shotSlots: [{
      id: 'slot_1',
      segmentId: 'seg_1',
      role: 'usage_demo',
      requiredAsset: { type: 'video', subject: 'test' },
      visualIngredientRequirements: ['face_closeup', 'beauty_demo'],
      fallbackStrategies: ['hand_demo'],
      importance: 3
    }],
    rhythm: { avgShotDuration: 5, cutFrequency: 'low', pattern: 'test' },
    packaging: {
      captionDensity: 'low',
      captionPosition: 'mixed',
      titleStyle: 'test',
      cardTypes: [],
      transitions: [],
      coverStyle: 'test'
    },
    creativeIngredients: [],
    edges: []
  }, []);

  assertSafeText(JSON.stringify(result));
  assert.deepEqual(result.gaps[0]?.missingIngredients, ['human_presence', 'hand_demo']);
  assert.equal(result.gaps[0]?.type, 'missing_human_host');
});

function assertSafeText(value: string) {
  for (const term of blockedTerms) {
    assert.ok(!value.includes(term), `blocked term leaked: ${term}`);
  }
}
