import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetCard, OrchestratedTimeline } from '@viral-struct/shared';
import { planAigcBeats } from './aigcHelper';

/* eslint-disable @typescript-eslint/no-explicit-any */

function tl(slots: any[]): OrchestratedTimeline {
  return {
    schemaVersion: 'orchestrated-v1',
    projectId: 'p',
    renderProfile: { width: 720, height: 1280, fps: 30, aspectRatio: '9:16' },
    slots: slots.map((s, i) => ({ index: i, ...s })),
    transitions: [],
    meta: { matchSource: 'rule_based', generatedAt: 'now', planOnly: true, productName: '康师傅冰红茶' },
    warnings: []
  } as unknown as OrchestratedTimeline;
}

function slot(o: { slotId: string; fillStatus?: string; fill: any; startMs?: number; endMs?: number }): any {
  return { role: 'hook', startMs: 0, endMs: 3000, fillStatus: 'matched', ...o };
}

const PRODUCT = 'product.png';
const cards: AssetCard[] = [
  { id: 'img1', type: 'image', url: 'shot.png', detectedObjects: [], suitableSlots: [], qualityScore: 0.8 } as any,
  { id: 'vid1', type: 'video', url: 'clip.mp4', detectedObjects: [], suitableSlots: [], qualityScore: 0.8 } as any
];

const opts = { timeline: undefined as any, assetCards: cards, productImageUrl: PRODUCT, productName: '康师傅冰红茶' };

test('gap beat → r2v anchored on the product image, prompt carries the aigc guidance + product name', () => {
  const plans = planAigcBeats({
    ...opts,
    timeline: tl([slot({ slotId: 's1', fillStatus: 'missing_generation_required', fill: { kind: 'gap', options: [{ id: 'aigc', prompt: '冰爽汇聚镜头', referenceAssetIds: [] }] } })])
  });
  const p = plans[0]!;
  assert.equal(p.kind, 'generate');
  if (p.kind !== 'generate') return;
  assert.equal(p.job.model, 'wan2.7-r2v');
  assert.ok(p.job.media.some((m) => m.url === PRODUCT && m.type === 'reference_image'), 'product image is a reference');
  assert.match(p.job.prompt, /康师傅冰红茶/);
  assert.match(p.job.prompt, /冰爽汇聚镜头/);
});

test('matched real video → real_clip, no generation', () => {
  const plans = planAigcBeats({ ...opts, timeline: tl([slot({ slotId: 's1', fillStatus: 'matched', fill: { kind: 'matched', assetId: 'vid1' } })]) });
  const p = plans[0]!;
  assert.equal(p.kind, 'real_clip');
  if (p.kind !== 'real_clip') return;
  assert.equal(p.clipUrl, 'clip.mp4');
});

test('partial image → r2v with the matched image AND the product anchor', () => {
  const plans = planAigcBeats({ ...opts, timeline: tl([slot({ slotId: 's1', fillStatus: 'partial_asset_support', fill: { kind: 'matched', assetId: 'img1', options: [] } })]) });
  const p = plans[0]!;
  assert.equal(p.kind, 'generate');
  if (p.kind !== 'generate') return;
  assert.equal(p.job.model, 'wan2.7-r2v');
  assert.deepEqual(p.job.media.map((m) => m.url), ['shot.png', PRODUCT]);
});

test('partial video → videoedit with the source clip, prompt is an edit instruction, fallback set', () => {
  const plans = planAigcBeats({ ...opts, timeline: tl([slot({ slotId: 's1', fillStatus: 'partial_asset_support', fill: { kind: 'matched', assetId: 'vid1', options: [] } })]) });
  const p = plans[0]!;
  assert.equal(p.kind, 'generate');
  if (p.kind !== 'generate') return;
  assert.equal(p.job.model, 'wan2.7-videoedit');
  assert.deepEqual(p.job.media, [{ type: 'video_edit_source', url: 'clip.mp4' }]);
  assert.match(p.job.prompt, /保留原片/);
  assert.equal(p.fallbackClipUrl, 'clip.mp4');
});

test('partial video → videoedit frames aigc.prompt as a TARGET to move the real clip toward (not hyperframes, not regenerate)', () => {
  const plans = planAigcBeats({
    ...opts,
    timeline: tl([
      slot({
        slotId: 's1',
        fillStatus: 'partial_asset_support',
        fill: {
          kind: 'matched',
          assetId: 'vid1',
          options: [
            { id: 'aigc', prompt: '清透冷调冰爽质感', referenceAssetIds: [] },
            { id: 'hyperframes', editingGuidanceNL: '这是给hyperframes通道的指引' }
          ]
        }
      })
    ])
  });
  const p = plans[0]!;
  assert.equal(p.kind, 'generate');
  if (p.kind !== 'generate') return;
  assert.equal(p.job.model, 'wan2.7-videoedit');
  assert.match(p.job.prompt, /保留原片/, 'edit framing keeps the source');
  assert.match(p.job.prompt, /清透冷调冰爽质感/, 'aigc.prompt is carried as the target effect');
  assert.doesNotMatch(p.job.prompt, /hyperframes通道/, 'the hyperframes channel guidance is NOT used by videoedit');
});

test('gap with no product image and no matched asset → t2v (no media)', () => {
  const plans = planAigcBeats({
    timeline: tl([slot({ slotId: 's1', fillStatus: 'missing_generation_required', fill: { kind: 'gap', options: [{ id: 'aigc', prompt: 'x', referenceAssetIds: [] }] } })]),
    assetCards: cards,
    productName: '康师傅冰红茶'
  });
  const p = plans[0]!;
  assert.equal(p.kind, 'generate');
  if (p.kind !== 'generate') return;
  assert.equal(p.job.model, 'wan2.7-t2v');
  assert.equal(p.job.media.length, 0);
});

test('duration is rounded to an integer and clamped per model [2, 15]', () => {
  const plans = planAigcBeats({
    ...opts,
    timeline: tl([
      slot({ slotId: 'short', startMs: 0, endMs: 500, fillStatus: 'missing_generation_required', fill: { kind: 'gap', options: [] } }),
      slot({ slotId: 'long', startMs: 0, endMs: 30000, fillStatus: 'missing_generation_required', fill: { kind: 'gap', options: [] } })
    ])
  });
  assert.equal(plans[0]!.kind === 'generate' && plans[0]!.job.parameters.duration, 2);
  assert.equal(plans[1]!.kind === 'generate' && plans[1]!.job.parameters.duration, 15);
});
