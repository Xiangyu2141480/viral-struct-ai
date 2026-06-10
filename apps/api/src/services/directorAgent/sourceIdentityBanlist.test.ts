import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ViralStructureGraph } from '@viral-struct/shared';
import { deriveSourceIdentityBanlist } from './sourceIdentityBanlist';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A minimal source graph shape — only the fields the derivation reads as evidence.
const macbookGraph = {
  schemaVersion: 'v1',
  meta: { duration: 229, aspectRatio: '16:9', videoType: 'ecommerce', style: 'premium' },
  shotSlots: [
    {
      id: 'slot_001',
      requiredAsset: { type: 'video', subject: '双手拿出银色苹果笔记本，色彩渐变后打开屏幕' },
      sourceInstance: { productInSource: '苹果MacBook笔记本电脑', specificAction: '双手托举产品悬浮翻转后开盖' }
    }
  ]
} as unknown as ViralStructureGraph;

function clientReturning(obj: unknown) {
  return () => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(obj) } }] }) } }
  }) as any;
}

test('deriveSourceIdentityBanlist parses a complete banlist from the LLM', async () => {
  const banlist = await deriveSourceIdentityBanlist({
    structureGraph: macbookGraph,
    clientFactory: clientReturning({
      sourceProduct: '苹果MacBook笔记本电脑',
      terms: ['MacBook', 'Apple', '苹果', '笔记本', 'laptop', '键盘', 'keyboard', '触控板']
    }),
    model: 'fake-model'
  });
  assert.equal(banlist.sourceProduct, '苹果MacBook笔记本电脑');
  assert.ok(banlist.terms.includes('MacBook'));
  assert.ok(banlist.terms.length >= 4);
});

test('an empty terms list throws after retry — no silent default', async () => {
  await assert.rejects(
    deriveSourceIdentityBanlist({
      structureGraph: macbookGraph,
      clientFactory: clientReturning({ sourceProduct: '苹果MacBook笔记本电脑', terms: [] }),
      model: 'fake-model'
    }),
    /banlist/i
  );
});

test('no LLM model available throws (LLM is mandatory, no fallback)', async () => {
  await assert.rejects(
    deriveSourceIdentityBanlist({
      structureGraph: macbookGraph,
      clientFactory: clientReturning({ sourceProduct: 'x', terms: ['x'] }),
      model: undefined,
      envModel: undefined
    }),
    /LLM_MODEL/
  );
});
