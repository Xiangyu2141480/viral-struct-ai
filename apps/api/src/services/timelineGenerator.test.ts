import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetCard, Boundary, ContentBrief, GapRepair, SlotMatch, ViralStructureGraph } from '@viral-struct/shared';
import { generateTimelineLLM, generateTimelineMock, generateTimelineWithFallback } from './timelineGenerator';

const matches: SlotMatch[] = [];
const repairs: GapRepair[] = [];

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

test('generateTimelineMock uses default per-variant transitions when boundaries absent', async () => {
  const result = await generateTimelineMock({
    structureGraph: graph,
    newContent: brief,
    matches,
    repairs,
    variant: 'high_click'
  });
  // Without boundaries, high_click variant default is 'quick_cut'
  assert.equal(result.timeline[0].packaging.transition, 'quick_cut');
});

test('generateTimelineMock overrides transition from source boundary mapping', async () => {
  const boundaries: Boundary[] = [
    { id: 'b1', from: 'seg_hook', to: 'seg_sp', transitionType: 'fade', intensity: 'medium' }
  ];
  const result = await generateTimelineMock({
    structureGraph: graph,
    newContent: brief,
    matches,
    repairs,
    variant: 'high_click',
    boundaries
  });
  // The timeline item whose sourceSegmentId is 'seg_hook' (the boundary's from)
  // should get its packaging.transition overridden to 'fade'.
  const endingHook = result.timeline.find(t => t.sourceSegmentId === 'seg_hook')!;
  assert.equal(endingHook.packaging.transition, 'fade');
});

test('generateTimelineMock maps morph boundary to push transition', async () => {
  const boundaries: Boundary[] = [
    { id: 'b1', from: 'seg_hook', to: 'seg_sp', transitionType: 'morph', intensity: 'strong' }
  ];
  const result = await generateTimelineMock({
    structureGraph: graph,
    newContent: brief,
    matches,
    repairs,
    variant: 'high_click',
    boundaries
  });
  const endingHook = result.timeline.find(t => t.sourceSegmentId === 'seg_hook')!;
  assert.equal(endingHook.packaging.transition, 'push');
});

// ---------------------------------------------------------------------------
// LLM script generation tests
// ---------------------------------------------------------------------------

interface FakeClient {
  chat: { completions: { create: (req: unknown) => Promise<{ choices: Array<{ message: { content: string } }> }> } };
}

function makeFakeClientPerSegment(responsesInOrder: string[]): FakeClient {
  let idx = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const content = responsesInOrder[idx % responsesInOrder.length];
          idx += 1;
          return { choices: [{ message: { content } }] };
        }
      }
    }
  };
}

function llmSegmentResponse(itemIds: string[], variant: 'hook' | 'sp' | 'cta'): string {
  const captionStyle = variant === 'hook' ? 'click_large_bottom_bold' : variant === 'sp' ? 'conversion_bold_red' : 'premium_minimal_top';
  return JSON.stringify({
    items: itemIds.map((id) => ({
      itemId: id,
      script: variant === 'hook' ? '冰爆瞬间——午后这一口，凉到指尖。' : variant === 'sp' ? '保温八小时，一口仍是早上的温度。' : '通勤党现在入手。',
      visualAction: 'Ken Burns 推近至飞溅中心',
      captionStyle,
      cardType: variant === 'hook' ? 'title_card' : variant === 'cta' ? 'cta_card' : null,
      subtitles: ['冰爆瞬间——', '午后这一口', '凉到指尖。']
    }))
  });
}

const splashAsset: AssetCard = {
  id: 'asset_splash',
  type: 'image',
  detectedObjects: ['bottle', 'splash'],
  suitableSlots: ['opening_attention'],
  qualityScore: 0.88,
  visualContent: {
    primarySubject: '深棕色饮料瓶',
    subjectPosition: 'center_lower_third',
    kinematicElements: ['liquid_splash', 'ice_cubes_in_flight']
  },
  motionPotential: { isStill: true, implicitMotion: 'high' }
};

test('generateTimelineLLM produces one timeline item per slot with scriptSource llm_generated', async () => {
  const localMatches: SlotMatch[] = [
    {
      slotId: 'slot_hook',
      assetId: 'asset_splash',
      score: 0.9,
      status: 'matched',
      reason: 'matched',
      quality: 0.9,
      treatmentSpec: { motion: 'zoom_in_on_splash', durationMs: 1400 }
    }
  ];
  const result = await generateTimelineLLM({
    structureGraph: graph,
    newContent: brief,
    matches: localMatches,
    repairs: [],
    assets: [splashAsset],
    variant: 'high_click',
    // 3 segments, so 3 stubbed responses (last two empty-ish are fine)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clientFactory: () => makeFakeClientPerSegment([
      llmSegmentResponse(['tl_seg_hook_1'], 'hook'),
      llmSegmentResponse(['tl_seg_sp_1'], 'sp'),
      llmSegmentResponse(['tl_seg_cta_1'], 'cta')
    ]) as any,
    model: 'fake'
  });
  assert.equal(result.timeline.length, 3);
  for (const item of result.timeline) {
    assert.equal(item.scriptSource, 'llm_generated');
  }
  const hookItem = result.timeline.find(t => t.sourceSegmentId === 'seg_hook')!;
  assert.ok(hookItem.script.includes('冰爆'));
  assert.equal(hookItem.assetId, 'asset_splash');
  // treatmentSpec should be carried onto the item
  assert.equal(hookItem.treatmentSpec?.motion, 'zoom_in_on_splash');
  // visualAction should mention the treatment motion
  assert.ok(hookItem.visualAction.includes('zoom_in_on_splash'));
});

test('generateTimelineLLM rejects when LLM returns wrong itemId', async () => {
  const wrong = JSON.stringify({
    items: [{
      itemId: 'tl_wrong_id',
      script: 'x', visualAction: 'y', captionStyle: 'click_large_bottom_bold',
      cardType: null, subtitles: ['x']
    }]
  });
  await assert.rejects(
    generateTimelineLLM({
      structureGraph: graph,
      newContent: brief,
      matches: [],
      repairs: [],
      assets: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: () => makeFakeClientPerSegment([wrong, wrong, wrong]) as any,
      model: 'fake'
    }),
    /missing item/
  );
});

test('generateTimelineWithFallback falls back to template when LLM throws', async () => {
  const result = await generateTimelineWithFallback({
    structureGraph: graph,
    newContent: brief,
    matches: [],
    repairs: [],
    assets: [],
    clientFactory: () => { throw new Error('LLM down'); }
  });
  assert.equal(result.scriptSource, 'template');
  assert.ok(result.warning?.includes('LLM down'));
  for (const item of result.timeline) {
    assert.equal(item.scriptSource, 'template');
  }
});
