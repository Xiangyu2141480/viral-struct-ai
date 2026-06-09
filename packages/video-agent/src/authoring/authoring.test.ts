import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthoredTimelineSchema, beatIsUnresolved } from '@viral-struct/shared';
import type { VideoEditContext } from '../context/VideoEditContext';
import { deterministicMockAuthor } from './deterministicMockAuthor';
import { canonicalizeAuthoredTimeline, clampSourceRange } from './canonicalizer';
import { authorTimeline } from './timelineAuthor';
import type { LLMAuthor } from './llmAuthor';

function makeContext(): VideoEditContext {
  return {
    projectId: 'test',
    structureGraph: {
      meta: { duration: 12, aspectRatio: '9:16', videoType: 'ecommerce', style: 'fast_pace' },
      structureSummary: 'test graph',
      segments: [
        { id: 'seg1', role: 'hook', start: 0, end: 4, duration: 4, purpose: 'grab attention', transferRule: 'reinvent the hook for the new product', importance: 5 },
        { id: 'seg2', role: 'proof', start: 4, end: 8, duration: 4, purpose: 'prove the claim', transferRule: 're-ground proof in real evidence', importance: 4 },
        { id: 'seg3', role: 'cta', start: 8, end: 12, duration: 4, purpose: 'drive action', transferRule: 'adapt the cta', importance: 3 }
      ],
      shotSlots: [
        { id: 'slot1', segmentId: 'seg1', role: 'opening_attention', requiredAsset: { type: 'image', subject: 'product reveal' }, fallbackStrategies: [] },
        { id: 'slot2', segmentId: 'seg2', role: 'product_closeup', requiredAsset: { type: 'video', subject: 'usage demo' }, fallbackStrategies: [] },
        { id: 'slot3', segmentId: 'seg3', role: 'cta_visual', requiredAsset: { type: 'image', subject: 'cta card' }, fallbackStrategies: [] }
      ],
      rhythm: { avgShotDuration: 2, cutFrequency: 'high', pattern: 'fast cuts' },
      packaging: { captionDensity: 'high', captionPosition: 'center', titleStyle: 'bold', cardTypes: [], transitions: [], coverStyle: 'punchy' },
      creativeIngredients: [],
      edges: []
    },
    contentBrief: { productName: 'TeaX', targetAudience: 'young adults', scenario: 'summer refreshment', sellingPoints: ['ice cold', 'zero sugar'], cta: 'buy now' },
    assetCards: [{ id: 'a1', type: 'image', url: '/tmp/a1.png', detectedObjects: ['product'], suitableSlots: [], qualityScore: 0.8 }],
    slotMatches: [{ slotId: 'slot1', assetId: 'a1', status: 'matched', score: 0.9, reason: 'matched' }],
    // slot2 is a real-proof gap (usage demo) with no asset → must become an honest substitute.
    materialGaps: [{ slotId: 'slot2', role: 'product_closeup', type: 'missing_usage_demo', severity: 'high', reason: 'no real demo', impact: 'proof lost' }],
    constraints: { aspectRatio: '9:16', allowAigc: true, allowHumanGeneration: false, allowedClaimSources: [], forbiddenClaims: [] }
  };
}

test('deterministicMockAuthor emits a schema-valid AuthoredTimeline', () => {
  const timeline = deterministicMockAuthor(makeContext());
  assert.equal(AuthoredTimelineSchema.safeParse(timeline).success, true);
  assert.equal(timeline.beats.length, 3);
  assert.equal(timeline.beats[0]!.segmentRole, 'hook');
});

test('mock author is deterministic (same input → identical output)', () => {
  const a = deterministicMockAuthor(makeContext());
  const b = deterministicMockAuthor(makeContext());
  assert.deepEqual(a, b);
});

test('mock author composites the matched real asset on the hook beat', () => {
  const timeline = deterministicMockAuthor(makeContext());
  const hook = timeline.beats[0]!;
  assert.equal(hook.mediaLayers.length, 1);
  assert.equal(hook.mediaLayers[0]!.media.assetId, 'a1');
  assert.equal(hook.mediaLayers[0]!.media.resolvedPath, '/tmp/a1.png');
  assert.equal(hook.mediaLayers[0]!.evidence.tier, 'real');
});

test('mock author marks a real-proof gap as an honest substitute (never fabricated)', () => {
  const timeline = deterministicMockAuthor(makeContext());
  const proof = timeline.beats.find((b) => b.segmentRole === 'proof')!;
  assert.ok(proof.unresolvedReason, 'proof beat with an unmatched real-proof slot must carry unresolvedReason');
  assert.equal(beatIsUnresolved(proof), true);
  assert.equal(proof.mediaLayers.length, 0);
});

test('mock author uses the NEW product brief copy, not the sample captions', () => {
  const timeline = deterministicMockAuthor(makeContext());
  const allText = timeline.beats.flatMap((b) => b.textElements.flatMap((t) => t.content)).join(' ');
  assert.ok(allText.includes('TeaX'));
  assert.ok(allText.includes('buy now'));
});

test('canonicalizer forces AIGC-in-real-proof to an honest substitute', () => {
  const raw = {
    schemaVersion: '1.0',
    renderProfile: { width: 1080, height: 1920, fps: 30, format: 'mp4' },
    beats: [
      {
        id: 'b1',
        segmentRole: 'proof',
        startSeconds: 0,
        endSeconds: 4,
        mediaLayers: [{ id: 'm1', media: { assetId: 'a1', type: 'aigc_image_to_video', aigcProvider: 'seedance' }, evidence: { tier: 'real' } }],
        textElements: [{ type: 'headline', content: ['proven!'] }]
      }
    ]
  };
  const { timeline } = canonicalizeAuthoredTimeline(raw, makeContext());
  const beat = timeline.beats[0]!;
  assert.ok(beat.unresolvedReason, 'AIGC in a proof beat must be downgraded to unresolved');
  assert.equal(beatIsUnresolved(beat), true);
});

test('canonicalizer drops a layer with an unknown assetId and marks the beat unresolved', () => {
  const raw = {
    beats: [
      {
        id: 'b1',
        segmentRole: 'proof',
        startSeconds: 0,
        endSeconds: 4,
        mediaLayers: [{ id: 'm1', media: { assetId: 'does_not_exist', type: 'image' }, evidence: { tier: 'real' } }],
        textElements: [{ type: 'headline', content: ['x'] }]
      }
    ]
  };
  const { timeline } = canonicalizeAuthoredTimeline(raw, makeContext());
  const beat = timeline.beats[0]!;
  assert.equal(beat.mediaLayers.length, 0);
  assert.ok(beat.unresolvedReason);
});

test('canonicalizer tolerantly extracts JSON wrapped in code fences / prose', () => {
  const wrapped = 'Sure! Here you go:\n```json\n' + JSON.stringify({ beats: [{ id: 'b1', segmentRole: 'hook', startSeconds: 0, endSeconds: 3, mediaLayers: [{ media: { assetId: 'a1', type: 'image' }, evidence: { tier: 'real' } }], textElements: [{ type: 'headline', content: ['hi'] }] }] }) + '\n```\nHope that helps.';
  const { timeline } = canonicalizeAuthoredTimeline(wrapped, makeContext());
  assert.equal(AuthoredTimelineSchema.safeParse(timeline).success, true);
  assert.equal(timeline.beats[0]!.mediaLayers[0]!.media.resolvedPath, '/tmp/a1.png');
});

test('authorTimeline falls back to the mock author when no LLM is injected', async () => {
  const result = await authorTimeline(makeContext(), {});
  assert.equal(result.source, 'mock');
  assert.equal(AuthoredTimelineSchema.safeParse(result.timeline).success, true);
});

test('authorTimeline uses the injected LLM when it returns valid JSON', async () => {
  const llm: LLMAuthor = {
    complete: async () =>
      JSON.stringify({ beats: [{ id: 'b1', segmentRole: 'hook', startSeconds: 0, endSeconds: 3, mediaLayers: [{ media: { assetId: 'a1', type: 'image' }, evidence: { tier: 'real' } }], textElements: [{ type: 'headline', content: ['hi'] }] }] })
  };
  const result = await authorTimeline(makeContext(), { llm });
  assert.equal(result.source, 'llm');
  assert.equal(AuthoredTimelineSchema.safeParse(result.timeline).success, true);
});

test('authorTimeline falls back to the mock author when the LLM returns garbage', async () => {
  const llm: LLMAuthor = { complete: async () => 'I cannot help with that.' };
  const result = await authorTimeline(makeContext(), { llm });
  assert.equal(result.source, 'mock');
  assert.equal(AuthoredTimelineSchema.safeParse(result.timeline).success, true);
});

// --- canonicalizer hardening, locked against the REAL Doubao output shape observed in the P1 spike ---

test('canonicalizer accepts the model "segments" key, ignores graph-shaped meta, snaps hard_cut, splits "/" captions', () => {
  const raw = JSON.stringify({
    schemaVersion: '1.0',
    meta: { duration: 30, aspectRatio: '9:16', videoType: 'ecommerce', style: 'fast_pace' }, // graph-shaped meta → must be ignored
    segments: [
      { segmentRole: 'hook', startSeconds: 0, endSeconds: 6, mediaLayers: [{ media: { assetId: 'a1', type: 'image' }, motion: { kind: 'pop_scale' } }], textElements: [{ content: '一 / 二 / 三' }], transitionOut: { kind: 'hard_cut' } }
    ]
  });
  const { timeline } = canonicalizeAuthoredTimeline(raw, makeContext());
  assert.equal(AuthoredTimelineSchema.safeParse(timeline).success, true);
  assert.equal(timeline.beats.length, 1);
  const beat = timeline.beats[0]!;
  assert.equal(beat.transitionOut?.kind, 'cut');
  assert.deepEqual(beat.textElements[0]!.content, ['一', '二', '三']);
  assert.equal(beat.mediaLayers[0]!.media.resolvedPath, '/tmp/a1.png');
});

test('a beat with real media is NOT a substitute even if the LLM cautiously set unresolvedReason', () => {
  const raw = { segments: [{ segmentRole: 'hook', startSeconds: 0, endSeconds: 6, unresolvedReason: 'wish I had more shots', mediaLayers: [{ media: { assetId: 'a1', type: 'image' }, evidence: { tier: 'real' } }], textElements: [{ type: 'headline', content: ['hi'] }] }] };
  const { timeline } = canonicalizeAuthoredTimeline(raw, makeContext());
  const beat = timeline.beats[0]!;
  assert.equal(beat.mediaLayers.length, 1);
  assert.equal(beatIsUnresolved(beat), false);
});

test('canonicalizer drops empty-assetId layers (blank slots) leaving a legitimate text card', () => {
  const raw = { segments: [{ segmentRole: 'cta', startSeconds: 0, endSeconds: 4, mediaLayers: [{ media: { assetId: '', type: 'image' } }], textElements: [{ type: 'headline', content: ['buy'] }] }] };
  const { timeline } = canonicalizeAuthoredTimeline(raw, makeContext());
  const beat = timeline.beats[0]!;
  assert.equal(beat.mediaLayers.length, 0);
  assert.equal(beatIsUnresolved(beat), false);
});

// --- Source sub-range trimming (clip/sourceRange seam) ---

// A context whose single matched asset is a VIDEO with a known full duration.
function makeVideoContext(durationSec = 20): VideoEditContext {
  const ctx = makeContext();
  return {
    ...ctx,
    assetCards: [
      {
        id: 'v1',
        type: 'video',
        url: '/tmp/v1.mp4',
        detectedObjects: ['product'],
        suitableSlots: [],
        qualityScore: 0.8,
        analysis: { media: { kind: 'video', durationSec, keyframes: [] } }
      }
    ],
    slotMatches: [{ slotId: 'slot1', assetId: 'v1', status: 'matched', score: 0.9, reason: 'matched' }]
    // Partial AssetCard.analysis (only media.durationSec matters here) → cast through unknown for the fixture.
  } as unknown as VideoEditContext;
}

test('clampSourceRange: no inputs / start=0 with no end → no trim ({})', () => {
  assert.deepEqual(clampSourceRange(undefined, undefined, 20), {});
  assert.deepEqual(clampSourceRange(0, undefined, 20), {});
});

test('clampSourceRange: a valid in/out within duration is kept', () => {
  assert.deepEqual(clampSourceRange(8, 12, 20), { startSec: 8, endSec: 12 });
});

test('clampSourceRange: clamps an out-point past the asset duration', () => {
  assert.deepEqual(clampSourceRange(5, 30, 20), { startSec: 5, endSec: 20 });
});

test('clampSourceRange: drops an out-point at/below the in-point (play to natural end)', () => {
  assert.deepEqual(clampSourceRange(5, 5, 20), { startSec: 5, endSec: undefined });
  assert.deepEqual(clampSourceRange(5, 3, 20), { startSec: 5, endSec: undefined });
});

test('clampSourceRange: NaN/negative start is treated as 0; pins start below duration', () => {
  assert.deepEqual(clampSourceRange(Number.NaN, 5, 20), { startSec: 0, endSec: 5 });
  assert.deepEqual(clampSourceRange(25, 30, 20), { startSec: 19.9, endSec: 20 });
});

test('mock author trims a long video asset to a centered window the length of the beat', () => {
  const timeline = deterministicMockAuthor(makeVideoContext(20));
  assert.equal(AuthoredTimelineSchema.safeParse(timeline).success, true);
  const hook = timeline.beats[0]!; // seg1, duration 4
  const media = hook.mediaLayers[0]!.media;
  assert.equal(media.type, 'video');
  // centered window: start = (20 - 4) / 2 = 8, end = 12
  assert.equal(media.startSec, 8);
  assert.equal(media.endSec, 12);
});

test('mock author leaves a short video (≤ beat) untrimmed (plays whole)', () => {
  const timeline = deterministicMockAuthor(makeVideoContext(3)); // 3s < 4s beat
  const media = timeline.beats[0]!.mediaLayers[0]!.media;
  assert.equal(media.startSec, undefined);
  assert.equal(media.endSec, undefined);
});

test('canonicalizer threads an LLM video in/out onto the layer, clamped to the asset duration', () => {
  const raw = {
    segments: [
      {
        segmentRole: 'hook',
        startSeconds: 0,
        endSeconds: 4,
        mediaLayers: [{ media: { assetId: 'v1', type: 'video', startSec: 6, endSec: 25 }, evidence: { tier: 'real' } }],
        textElements: [{ type: 'headline', content: ['hi'] }]
      }
    ]
  };
  const { timeline } = canonicalizeAuthoredTimeline(raw, makeVideoContext(20));
  const media = timeline.beats[0]!.mediaLayers[0]!.media;
  assert.equal(media.startSec, 6);
  assert.equal(media.endSec, 20); // 25 clamped to the 20s asset
});

test('canonicalizer never puts a source range on an image layer', () => {
  const raw = {
    segments: [
      {
        segmentRole: 'hook',
        startSeconds: 0,
        endSeconds: 4,
        mediaLayers: [{ media: { assetId: 'a1', type: 'image', startSec: 3, endSec: 5 }, evidence: { tier: 'real' } }],
        textElements: [{ type: 'headline', content: ['hi'] }]
      }
    ]
  };
  const { timeline } = canonicalizeAuthoredTimeline(raw, makeContext());
  const media = timeline.beats[0]!.mediaLayers[0]!.media;
  assert.equal(media.type, 'image');
  assert.equal(media.startSec, undefined);
  assert.equal(media.endSec, undefined);
});
