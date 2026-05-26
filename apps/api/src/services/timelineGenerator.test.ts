import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ContentBrief, ViralStructureGraph } from '@viral-struct/shared';
import { generateTimelineMock } from './timelineGenerator';

const graph: ViralStructureGraph = {
  meta: { duration: 10, aspectRatio: '9:16', videoType: 'ecommerce', style: 'high_click' },
  structureSummary: 'Hook -> selling point -> proof -> CTA',
  segments: [
    {
      id: 'seg_hook',
      role: 'hook',
      start: 0,
      end: 2,
      duration: 2,
      purpose: '抓注意力',
      transferRule: '迁移为新商品痛点',
      importance: 5
    },
    {
      id: 'seg_sp',
      role: 'selling_point',
      start: 2,
      end: 6,
      duration: 4,
      purpose: '展示卖点',
      transferRule: '迁移为核心卖点',
      importance: 5
    },
    {
      id: 'seg_cta',
      role: 'cta',
      start: 6,
      end: 10,
      duration: 4,
      purpose: '促成行动',
      transferRule: '迁移为 CTA',
      importance: 4
    }
  ],
  shotSlots: [
    {
      id: 'slot_hook',
      segmentId: 'seg_hook',
      role: 'opening_attention',
      requiredAsset: { type: 'video', subject: '强视觉开头' },
      fallbackStrategies: ['text_card'],
      importance: 5
    },
    {
      id: 'slot_sp',
      segmentId: 'seg_sp',
      role: 'product_closeup',
      requiredAsset: { type: 'image', subject: '产品特写' },
      fallbackStrategies: ['selling_point_card'],
      importance: 5
    },
    {
      id: 'slot_cta',
      segmentId: 'seg_cta',
      role: 'cta_visual',
      requiredAsset: { type: 'generated', subject: '结尾行动卡' },
      fallbackStrategies: ['cta_card'],
      importance: 4
    }
  ],
  rhythm: { avgShotDuration: 2, cutFrequency: 'high', pattern: 'fast_hook' },
  packaging: {
    captionDensity: 'high',
    captionPosition: 'bottom_center',
    titleStyle: 'large_bold',
    cardTypes: ['title_card'],
    transitions: ['quick_cut'],
    coverStyle: 'product_title'
  },
  creativeIngredients: [],
  edges: []
};

const brief: ContentBrief = {
  productName: '便携咖啡杯',
  targetAudience: '通勤上班族',
  scenario: '早高峰通勤',
  sellingPoints: ['保温 8 小时', '倒置不漏', '单手开盖'],
  cta: '通勤党现在入手。'
};

test('generateTimelineMock creates distinct high-click and premium variants', async () => {
  const highClick = await generateTimelineMock({
    structureGraph: graph,
    newContent: brief,
    matches: [],
    repairs: [],
    variant: 'high_click'
  });
  const premium = await generateTimelineMock({
    structureGraph: graph,
    newContent: brief,
    matches: [],
    repairs: [],
    variant: 'premium'
  });

  assert.match(highClick.script[0].text, /3 秒/);
  assert.match(premium.script[0].text, /质感/);
  assert.equal(highClick.timeline[0].packaging.transition, 'quick_cut');
  assert.equal(premium.timeline[0].packaging.transition, 'fade');
  assert.notEqual(highClick.timeline[0].script, premium.timeline[0].script);
});

test('generateTimelineMock puts proof and CTA emphasis into high-conversion variant', async () => {
  const result = await generateTimelineMock({
    structureGraph: graph,
    newContent: brief,
    matches: [],
    repairs: [],
    variant: 'high_conversion'
  });

  assert.match(result.script.at(-1)?.text ?? '', /立即/);
  assert.ok(result.timeline.every((item) => item.packaging.captionStyle.includes('conversion')));
});
