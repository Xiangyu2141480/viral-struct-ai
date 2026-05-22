import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VideoAnalysis } from '@viral-struct/shared';
import { ViralStructureGraphSchema } from '@viral-struct/shared';
import { extractStructureGraph } from './structureExtractor';

test('extractStructureGraph derives segments from transcript keywords and validates schema', async () => {
  const graph = await extractStructureGraph(buildAnalysis({
    transcript: [
      { start: 0, end: 2, text: '你还在这样选咖啡杯吗？' },
      { start: 2, end: 5, text: '普通杯不保温还容易漏。' },
      { start: 5, end: 9, text: '这款杯子保温八小时，杯身清晰好看。' },
      { start: 9, end: 12, text: '我们做了倒置实测，一滴都不漏。' },
      { start: 12, end: 15, text: '点击下单，今天就用上。' }
    ]
  }));

  const parsed = ViralStructureGraphSchema.parse(graph);
  assert.deepEqual(parsed.segments.map((segment) => segment.role), [
    'hook',
    'pain_point',
    'selling_point',
    'proof',
    'cta'
  ]);
  assert.equal(parsed.meta.aspectRatio, '9:16');
  assert.equal(parsed.packaging.captionDensity, 'high');
  assert.ok(parsed.segments[0]?.purpose.includes('transcript 0s-2s'));
  assert.ok(parsed.creativeIngredients.some((ingredient) =>
    ingredient.evidence.some((evidence) => evidence.type === 'transcript')
  ));
});

test('extractStructureGraph falls back to shots and keyframes without transcript', async () => {
  const graph = await extractStructureGraph(buildAnalysis({ transcript: [] }));

  const parsed = ViralStructureGraphSchema.parse(graph);
  assert.equal(parsed.segments.length, 5);
  assert.equal(parsed.segments[0]?.role, 'hook');
  assert.equal(parsed.segments.at(-1)?.role, 'cta');
  assert.ok(parsed.segments.some((segment) => segment.transferRule.includes('shot shot_3')));
  assert.ok(parsed.creativeIngredients.some((ingredient) =>
    ingredient.evidence.some((evidence) => evidence.type === 'frame')
  ));
});

test('extractStructureGraph distributes one long transcript across shot-backed segments', async () => {
  const graph = await extractStructureGraph(buildAnalysis({
    transcript: [
      {
        start: 0,
        end: 15,
        text: '你还在这样选杯子吗？普通杯不保温还容易漏。这款杯子保温八小时。我们做了倒置实测，一滴都不漏。点击下单今天就用上。'
      }
    ]
  }));

  const parsed = ViralStructureGraphSchema.parse(graph);
  assert.equal(parsed.segments.length, 5);
  assert.equal(parsed.segments[0]?.role, 'hook');
  assert.equal(parsed.segments.at(-1)?.role, 'cta');
  assert.ok(parsed.segments.some((segment) => segment.purpose.includes('keyframe /mock/frame_3.jpg 卖点卡片')));
});

test('extractStructureGraph ignores empty transcript rows for density and evidence', async () => {
  const graph = await extractStructureGraph(buildAnalysis({
    transcript: [{ start: 0, end: 15, text: '   ' }]
  }));

  const parsed = ViralStructureGraphSchema.parse(graph);
  assert.equal(parsed.packaging.captionDensity, 'low');
  assert.ok(parsed.creativeIngredients.every((ingredient) =>
    ingredient.evidence.every((evidence) => evidence.type !== 'transcript' || evidence.value.trim().length > 0)
  ));
});

test('extractStructureGraph handles short videos without invalid timing', async () => {
  const graph = await extractStructureGraph(buildAnalysis({
    metadata: {
      videoId: 'short-demo.mp4',
      duration: 5,
      fps: 30,
      width: 1080,
      height: 1920,
      aspectRatio: '9:16'
    },
    shots: [
      { id: 'shot_1', start: 0, end: 1.5, description: '开头强视觉' },
      { id: 'shot_2', start: 1.5, end: 3.5, description: '商品特写' },
      { id: 'shot_3', start: 3.5, end: 5, description: '结尾 CTA' }
    ],
    transcript: []
  }));

  const parsed = ViralStructureGraphSchema.parse(graph);
  assert.equal(parsed.meta.duration, 5);
  assert.ok(parsed.segments.length >= 3);
  assert.ok(parsed.segments.every((segment) => segment.duration > 0));
  assert.equal(parsed.rhythm.cutFrequency, 'high');
});

test('extractStructureGraph preserves horizontal aspect ratio in meta and packaging', async () => {
  const graph = await extractStructureGraph(buildAnalysis({
    metadata: {
      videoId: 'brand-horizontal.mp4',
      duration: 20,
      fps: 24,
      width: 1920,
      height: 1080,
      aspectRatio: '16:9'
    }
  }));

  const parsed = ViralStructureGraphSchema.parse(graph);
  assert.equal(parsed.meta.aspectRatio, '16:9');
  assert.match(parsed.packaging.coverStyle, /^16:9_cover_/);
});

test('extractStructureGraph returns schema-valid mock fallback without videoAnalysis', async () => {
  const graph = await extractStructureGraph();
  const parsed = ViralStructureGraphSchema.parse(graph);

  assert.equal(parsed.meta.duration, 15);
  assert.equal(parsed.segments[0]?.role, 'hook');
  assert.ok(parsed.creativeIngredients.length > 0);
});

test('extractStructureGraph fallback avoids appearance and sensitive-attribute requirements', async () => {
  const graph = await extractStructureGraph();
  const parsed = ViralStructureGraphSchema.parse(graph);
  const slotRequirements = parsed.shotSlots.flatMap((slot) => slot.visualIngredientRequirements ?? []);
  const ingredientTypes = parsed.creativeIngredients.map((ingredient) => ingredient.type);
  const humanFramings = parsed.shotSlots.map((slot) => slot.humanRequirement?.framing).filter(Boolean);

  assert.ok(!slotRequirements.includes('face_closeup'));
  assert.ok(!slotRequirements.includes('beauty_demo'));
  assert.ok(!ingredientTypes.includes('face_closeup'));
  assert.ok(!ingredientTypes.includes('beauty_demo'));
  assert.ok(!humanFramings.includes('face_closeup'));
});

function buildAnalysis(overrides: Partial<VideoAnalysis> = {}): VideoAnalysis {
  return {
    metadata: {
      videoId: 'sample-coffee-cup.mp4',
      duration: 15,
      fps: 30,
      width: 1080,
      height: 1920,
      aspectRatio: '9:16'
    },
    shots: [
      { id: 'shot_1', start: 0, end: 2, keyframeUrl: '/mock/frame_1.jpg', description: '快速吸引注意的开头镜头' },
      { id: 'shot_2', start: 2, end: 4, keyframeUrl: '/mock/frame_2.jpg', description: '痛点字幕镜头' },
      { id: 'shot_3', start: 4, end: 8, keyframeUrl: '/mock/frame_3.jpg', description: '商品特写与卖点展示' },
      { id: 'shot_4', start: 8, end: 12, keyframeUrl: '/mock/frame_4.jpg', description: '对比证明镜头' },
      { id: 'shot_5', start: 12, end: 15, keyframeUrl: '/mock/frame_5.jpg', description: 'CTA 结尾镜头' }
    ],
    keyframes: [
      { time: 1, url: '/mock/frame_1.jpg', description: '大标题 + 产品推近' },
      { time: 3, url: '/mock/frame_2.jpg', description: '痛点字幕' },
      { time: 6, url: '/mock/frame_3.jpg', description: '卖点卡片' },
      { time: 10, url: '/mock/frame_4.jpg', description: '对比卡片' },
      { time: 14, url: '/mock/frame_5.jpg', description: 'CTA 卡片' }
    ],
    transcript: [
      { start: 0, end: 2, text: '你还在这样选咖啡杯吗？' },
      { start: 2, end: 4, text: '普通杯不保温还容易漏。' },
      { start: 4, end: 8, text: '这款杯子保温八小时。' },
      { start: 8, end: 12, text: '倒置也不漏。' },
      { start: 12, end: 15, text: '通勤党放心带。' }
    ],
    ...overrides
  };
}
