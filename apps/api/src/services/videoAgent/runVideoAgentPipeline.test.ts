import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetCard } from '@viral-struct/shared';
import { runVideoAgentPipeline } from './runVideoAgentPipeline';
import { makeContentBrief, makeGraph } from '../directorAgent/testFixtures';

function makeLongVideoParentAndSegment(): AssetCard[] {
  const segment: AssetCard = {
    id: 'long_video_seg_002',
    type: 'video',
    url: '/media/uploads/long_video.mp4',
    spatialDescription: '手持瓶身开盖并饮用的子片段。',
    temporalDescription: 'Segment 2 of long_video: 6s-11s.',
    detectedObjects: ['product', 'hand', 'usage scene'],
    suitableSlots: ['usage_demo'],
    qualityScore: 0.95,
    detectedIngredients: [],
    candidateSlotRoles: [{ role: 'usage_demo', confidence: 0.98 }],
    analysis: {
      profileVersion: 'asset_analysis_v1',
      analyzedAt: '1970-01-01T00:00:00.000Z',
      source: 'deterministic',
      fallbackUsed: false,
      warnings: [],
      media: { kind: 'video', sourceUrl: '/media/uploads/long_video.mp4', durationSec: 5, keyframes: [] },
      semantic: { summary: '手持瓶身开盖并饮用的子片段。', detectedObjects: ['product', 'hand'], detectedIngredients: [], visualStyleTags: [] },
      quality: {
        overallScore: 0.95,
        resolution: 0.95,
        sharpness: 0.95,
        brightness: 0.95,
        contrast: 0.95,
        clarity: 0.95,
        composition: 0.95,
        lighting: 0.95,
        subjectProminence: 0.95,
        productFocus: 0.95,
        textSafeArea: 0.7,
        issues: []
      },
      slotAffordance: {
        suitableSlots: ['usage_demo'],
        primaryRoles: [{ role: 'usage_demo', confidence: 0.98 }],
        missingRoles: [],
        rationale: 'Segment-level role evidence.'
      },
      editability: { canCropZoom: true, canUseAsBackground: true, canLoop: true, canExtendWithCards: true, suggestedEdits: [] },
      safety: { status: 'passed', brandRisk: 'low', ipRisk: 'low', claimRisk: 'low', reasons: [] },
      search: { tags: ['usage_demo'], keywords: ['open_cap'], embeddingText: 'usage segment' },
      videoSegments: [{
        id: 'long_video_seg_002',
        parentAssetId: 'long_video',
        startSec: 6,
        endSec: 11,
        durationSec: 5,
        label: '开盖饮用片段',
        visualSummary: '手持瓶身开盖并饮用。',
        roleHints: ['usage_demo'],
        actionTags: ['open_cap', 'drink'],
        qualityScore: 0.95,
        confidence: 0.95,
        keyframeIds: [],
        source: 'deterministic'
      }]
    },
    segmentSource: {
      parentAssetId: 'long_video',
      startSec: 6,
      endSec: 11,
      durationSec: 5,
      segmentIndex: 1,
      label: '开盖饮用片段',
      visualSummary: '手持瓶身开盖并饮用。',
      roleHints: ['usage_demo'],
      actionTags: ['open_cap', 'drink'],
      confidence: 0.95,
      source: 'deterministic'
    }
  };

  const parent = {
    ...segment,
    id: 'long_video',
    segmentSource: undefined,
    temporalDescription: 'Parent long video, media source only.',
    analysis: {
      ...segment.analysis!,
      media: { ...segment.analysis!.media, durationSec: 20 },
      semantic: { ...segment.analysis!.semantic, summary: 'Parent long video.' },
      videoSegments: segment.analysis!.videoSegments
    }
  } as AssetCard;

  return [parent, segment];
}

test('runVideoAgentPipeline filters long-video parents and offsets segment media ranges', async () => {
  const result = await runVideoAgentPipeline({
    structureGraph: makeGraph(),
    assetCards: makeLongVideoParentAndSegment(),
    contentBrief: makeContentBrief()
  });

  assert.equal(result.matches.some((match) => match.assetId === 'long_video'), false);
  assert.ok(result.matches.some((match) => match.assetId === 'long_video_seg_002'));

  const mediaLayers = result.authoredTimeline.beats.flatMap((beat) => beat.mediaLayers);
  assert.equal(mediaLayers.some((layer) => layer.media.assetId === 'long_video'), false);
  const usageLayer = mediaLayers.find((layer) => layer.media.assetId === 'long_video_seg_002');
  assert.ok(usageLayer);
  assert.equal(usageLayer.media.resolvedPath, '/media/uploads/long_video.mp4');
  // The deterministic author trims to a centered 4s beat inside the 5s segment,
  // then the API layer offsets that local range back onto the parent video.
  assert.equal(usageLayer.media.startSec, 6.5);
  assert.equal(usageLayer.media.endSec, 10.5);
});
