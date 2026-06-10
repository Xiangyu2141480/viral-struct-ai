import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthoredTimelineSchema } from '@viral-struct/shared';
import { buildOrchestratedTimeline } from '../directorAgent/orchestratedTimelineBuilder';
import { makeAssets, makeContentBrief, makeFakeClient, makeGraph } from '../directorAgent/testFixtures';
import { orchestratedToAuthored } from './orchestratedToAuthored';

async function makeTimeline() {
  return buildOrchestratedTimeline({
    projectId: 'p1',
    structureGraph: makeGraph(),
    assetCards: makeAssets(),
    contentBrief: makeContentBrief(),
    clientFactory: makeFakeClient({
      slot_open: { assetId: 'asset_open', quality: 0.9 },
      slot_usage: { assetId: 'asset_usage', quality: 0.6 },
      slot_cta: { assetId: null, quality: 0.2 }
    }),
    model: 'fake-model'
  });
}

test('maps one beat per orchestrated slot and validates as an AuthoredTimeline', async () => {
  const timeline = await makeTimeline();
  const authored = orchestratedToAuthored(timeline, { assetCards: makeAssets() });
  assert.equal(authored.beats.length, timeline.slots.length);
  AuthoredTimelineSchema.parse(authored); // throws if invalid
  assert.equal(authored.renderProfile.format, 'mp4');
});

test('matched / partial slots become media beats; gap slots become honest-substitute beats', async () => {
  const timeline = await makeTimeline();
  const authored = orchestratedToAuthored(timeline, { assetCards: makeAssets() });

  const open = authored.beats.find((b) => b.id === 'slot_open')!;
  assert.equal(open.mediaLayers.length, 1);
  assert.equal(open.mediaLayers[0].evidence.sourceAssetId, 'asset_open');
  assert.equal(open.mediaLayers[0].media.resolvedPath, '/open.png'); // url passthrough, not a render

  const cta = authored.beats.find((b) => b.id === 'slot_cta')!;
  assert.equal(cta.mediaLayers.length, 0);
  assert.match(cta.unresolvedReason ?? '', /^gap:/);
  assert.match(cta.unresolvedReason ?? '', /recommended option/);
});

test('each non-final beat carries a transitionOut; the last does not', async () => {
  const timeline = await makeTimeline();
  const authored = orchestratedToAuthored(timeline, { assetCards: makeAssets() });
  for (let i = 0; i < authored.beats.length - 1; i += 1) {
    assert.ok(authored.beats[i].transitionOut, `beat ${i} should have a transitionOut`);
  }
  assert.equal(authored.beats[authored.beats.length - 1].transitionOut, undefined);
});

test('without assetCards the timeline carries asset ids but no resolved paths (Video Agent resolves later)', async () => {
  const timeline = await makeTimeline();
  const authored = orchestratedToAuthored(timeline);
  const open = authored.beats.find((b) => b.id === 'slot_open')!;
  assert.equal(open.mediaLayers[0].media.assetId, 'asset_open');
  assert.equal(open.mediaLayers[0].media.resolvedPath, undefined);
});

test('video segment AssetCard timing is passed through as media startSec/endSec', async () => {
  const timeline = await makeTimeline();
  const target = timeline.slots.find((slot) => slot.slotId === 'slot_usage')!;
  if (target.fill.kind !== 'matched') throw new Error('fixture expected matched usage slot');
  target.fill.assetId = 'asset_usage_seg_002';
  target.fill.mediaStartSec = 6;
  target.fill.mediaEndSec = 11.5;

  const authored = orchestratedToAuthored(timeline, {
    assetCards: [{
      id: 'asset_usage_seg_002',
      type: 'video',
      url: '/usage.mp4',
      detectedObjects: ['product'],
      suitableSlots: ['usage_demo'],
      qualityScore: 0.82,
      segmentSource: {
        parentAssetId: 'asset_usage',
        startSec: 6,
        endSec: 11.5,
        durationSec: 5.5,
        segmentIndex: 1,
        label: 'open cap and pour',
        actionTags: ['open_cap', 'pour_to_cup'],
        source: 'deterministic'
      }
    }]
  });

  const usage = authored.beats.find((beat) => beat.id === 'slot_usage')!;
  assert.equal(usage.mediaLayers[0].media.resolvedPath, '/usage.mp4');
  assert.equal(usage.mediaLayers[0].media.startSec, 6);
  assert.equal(usage.mediaLayers[0].media.endSec, 11.5);
});
