import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import type { RenderResult } from '@viral-struct/render-executor';
import type { LLMAuthor, VideoEditContext } from '@viral-struct/video-agent';
import {
  authoredRenderEnabled,
  authoredRenderFromContext,
  rewriteAssetCardUrlsToDisk
} from './authoredRenderService';
import { getDemoAssetDir } from './videoPaths';

test('authoredRenderEnabled honors an explicit override', () => {
  assert.equal(authoredRenderEnabled(true), true);
  assert.equal(authoredRenderEnabled(false), false);
});

test('authoredRenderEnabled defaults to the USE_AUTHORED_RENDER env (off unless exactly "true")', () => {
  const prev = process.env.USE_AUTHORED_RENDER;
  try {
    delete process.env.USE_AUTHORED_RENDER;
    assert.equal(authoredRenderEnabled(), false);
    process.env.USE_AUTHORED_RENDER = 'true';
    assert.equal(authoredRenderEnabled(), true);
    process.env.USE_AUTHORED_RENDER = 'false';
    assert.equal(authoredRenderEnabled(), false);
    process.env.USE_AUTHORED_RENDER = '1';
    assert.equal(authoredRenderEnabled(), false);
  } finally {
    if (prev === undefined) {
      delete process.env.USE_AUTHORED_RENDER;
    } else {
      process.env.USE_AUTHORED_RENDER = prev;
    }
  }
});

test('rewriteAssetCardUrlsToDisk maps demo-asset web urls to on-disk paths (forward slashes)', () => {
  const [card] = rewriteAssetCardUrlsToDisk([
    { id: 'a1', url: '/media/demo-assets/kangshifu_iced_tea/shot.png' }
  ]);
  const expected = path.join(getDemoAssetDir(), 'kangshifu_iced_tea/shot.png').replace(/\\/g, '/');
  assert.equal(card.url, expected);
  assert.ok(!card.url?.includes('\\'), 'url must not contain backslashes');
});

test('rewriteAssetCardUrlsToDisk passes through non-demo, absolute, and missing urls', () => {
  const cards = rewriteAssetCardUrlsToDisk([
    { id: 'a1', url: 'https://cdn.example.com/x.png' },
    { id: 'a2' },
    { id: 'a3', url: '/uploads/local.png' }
  ]);
  assert.equal(cards[0].url, 'https://cdn.example.com/x.png');
  assert.equal(cards[1].url, undefined);
  assert.equal(cards[2].url, '/uploads/local.png');
});

test('rewriteAssetCardUrlsToDisk returns immutable copies', () => {
  const input = [{ id: 'a1', url: '/media/demo-assets/x.png' }];
  const output = rewriteAssetCardUrlsToDisk(input);
  assert.notEqual(output[0], input[0]);
  assert.equal(input[0].url, '/media/demo-assets/x.png');
});

test('authoredRenderFromContext authors a timeline and derives mediaUrl from the executor output', async () => {
  const fakeLlm: LLMAuthor = {
    complete: async () =>
      JSON.stringify({
        beats: [
          {
            id: 'b1',
            segmentRole: 'hook',
            startSeconds: 0,
            endSeconds: 3,
            mediaLayers: [{ media: { assetId: 'a1', type: 'image' }, evidence: { tier: 'real' } }],
            textElements: [{ type: 'headline', content: ['hi'] }]
          }
        ]
      })
  };

  let renderedBeatCount = -1;
  const executorFactory = (outputPath: string) => ({
    render: async (timeline: { beats?: unknown[] }): Promise<RenderResult> => {
      renderedBeatCount = timeline.beats?.length ?? 0;
      return {
        ok: true,
        rendered: true,
        executor: 'fake',
        format: 'mp4',
        outputPath,
        durationMs: 3000,
        frameCount: 90,
        segmentCount: 1,
        unresolvedSegmentIds: [],
        manifest: [],
        contentHash: 'hash',
        warnings: []
      };
    }
  });

  const context = {
    projectId: 'p1',
    structureGraph: { meta: { aspectRatio: '9:16' }, segments: [], shotSlots: [] },
    contentBrief: { productName: 'X', targetAudience: 'a', scenario: 's', sellingPoints: ['p'], cta: 'c' },
    assetCards: [
      { id: 'a1', type: 'image', url: '/disk/a1.png', detectedObjects: [], suitableSlots: [], qualityScore: 0.5 }
    ],
    slotMatches: [],
    materialGaps: [],
    constraints: {
      aspectRatio: '9:16',
      allowAigc: false,
      allowHumanGeneration: false,
      allowedClaimSources: [],
      forbiddenClaims: []
    }
  } as unknown as VideoEditContext;

  const result = await authoredRenderFromContext(context, { llm: fakeLlm, executorFactory });

  assert.ok(result.render.rendered, 'executor should have rendered');
  assert.ok(renderedBeatCount >= 1, 'executor should receive a non-empty authored timeline');
  assert.equal(result.mediaUrl, `/media/renders/${path.basename(result.render.outputPath ?? '')}`);
  assert.ok(['llm', 'mock'].includes(result.source));
});
