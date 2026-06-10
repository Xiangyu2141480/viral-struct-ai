import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetCard, ContentBrief } from '@viral-struct/shared';
import { VOCAB_ROLES, VOCAB_SUBTYPES } from '@viral-struct/shared';
import { translateCategoryEquivalents } from './categoryEquivalentTranslator';
import { EARPHONE_VOCAB_FIXTURE } from './vocabularyFixture';

/* eslint-disable @typescript-eslint/no-explicit-any */

const brief: ContentBrief = {
  productName: '无线蓝牙耳机',
  category: '电子',
  targetAudience: '年轻上班族',
  scenario: '通勤、运动、办公',
  sellingPoints: ['主动降噪', '超长续航', '佩戴舒适'],
  cta: '现在下单'
};
const cards: AssetCard[] = [
  { id: 'asset_001', type: 'image', url: 'p.png', detectedObjects: [], suitableSlots: [], qualityScore: 0.8 } as any
];

function clientReturning(obj: unknown) {
  return () => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) } }
  }) as any;
}

test('translateCategoryEquivalents parses a complete LLM vocabulary and validates it', async () => {
  const vocab = await translateCategoryEquivalents({
    contentBrief: brief,
    assetCards: cards,
    clientFactory: clientReturning(EARPHONE_VOCAB_FIXTURE),
    model: 'fake-model'
  });
  assert.equal(vocab.product, '无线蓝牙耳机');
  for (const k of VOCAB_SUBTYPES) assert.ok(vocab.bySubtype[k], `subtype ${k} present`);
  for (const k of VOCAB_ROLES) assert.ok(vocab.byRole[k], `role ${k} present`);
});

test('an incomplete vocabulary (missing a subtype) throws after retry — no silent default', async () => {
  const incomplete = { ...EARPHONE_VOCAB_FIXTURE, bySubtype: { opening_transform: EARPHONE_VOCAB_FIXTURE.bySubtype.opening_transform } };
  await assert.rejects(
    translateCategoryEquivalents({ contentBrief: brief, assetCards: cards, clientFactory: clientReturning(incomplete), model: 'fake-model' }),
    /vocabulary/i
  );
});

test('no LLM model available throws (LLM is mandatory, no fallback)', async () => {
  await assert.rejects(
    translateCategoryEquivalents({ contentBrief: brief, assetCards: cards, clientFactory: clientReturning(EARPHONE_VOCAB_FIXTURE), model: undefined, envModel: undefined }),
    /LLM_MODEL/
  );
});
