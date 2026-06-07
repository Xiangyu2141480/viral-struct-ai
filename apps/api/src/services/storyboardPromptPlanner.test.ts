import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  AssetCard,
  ContentBrief,
  GapRepair,
  MaterialGap,
  SlotMatch,
  TimelineItem,
  ViralStructureGraph
} from '@viral-struct/shared';
import { planStoryboardFrames } from './storyboardPromptPlanner';

const brief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏季通勤人群',
  scenario: '午后高温',
  sellingPoints: ['冰爽解腻', '柠檬茶香'],
  cta: '想要冰爽解腻，就来一瓶康师傅冰红茶。',
  stylePreference: '清爽高点击'
};

const graph: ViralStructureGraph = {
  schemaVersion: 'v1',
  meta: { duration: 10, aspectRatio: '9:16', videoType: 'ecommerce', style: 'high_click' },
  structureSummary: 'Hook -> product -> usage -> CTA',
  segments: [
    { id: 'seg_hook', role: 'hook', start: 0, end: 2, duration: 2, purpose: '强开场停留', transferRule: '迁移高能开头', importance: 5 },
    { id: 'seg_product', role: 'selling_point', start: 2, end: 4, duration: 2, purpose: '产品特写', transferRule: '迁移产品中心构图', importance: 5 },
    { id: 'seg_usage', role: 'usage', start: 4, end: 7, duration: 3, purpose: '使用场景', transferRule: '迁移场景表达', importance: 4 },
    { id: 'seg_cta', role: 'cta', start: 7, end: 10, duration: 3, purpose: '行动号召', transferRule: '迁移结尾收束', importance: 4 }
  ],
  shotSlots: [
    {
      id: 'slot_hook',
      segmentId: 'seg_hook',
      role: 'opening_attention',
      requiredAsset: { type: 'image', subject: '冰块飞溅开场', motion: 'push_in' },
      fallbackStrategies: ['text_card'],
      importance: 5,
      intent: {
        purpose: '用高能飞溅开场制造停留',
        energyLevel: 'high',
        motionPattern: '快速推近到产品和冰块',
        compositionPrincipal: '产品居中，飞溅围绕',
        durationMs: [1000, 1800]
      },
      sourceInstance: { productInSource: '源片电子产品', specificAction: '快速入画', colorSignature: '高对比' },
      acceptanceCriteria: {
        anyOf: [{ motionType: 'splash', compositionType: 'center_focus', examples: ['冰块飞溅', '快速推近'] }],
        rejectIf: ['照搬源片商品']
      }
    },
    {
      id: 'slot_product',
      segmentId: 'seg_product',
      role: 'product_closeup',
      requiredAsset: { type: 'image', subject: '瓶身特写', camera: 'closeup' },
      fallbackStrategies: ['crop_zoom'],
      importance: 5
    },
    {
      id: 'slot_usage',
      segmentId: 'seg_usage',
      role: 'usage_demo',
      requiredAsset: { type: 'video', subject: '饮用场景', motion: 'hand_operation' },
      fallbackStrategies: ['selling_point_card'],
      importance: 4
    },
    {
      id: 'slot_cta',
      segmentId: 'seg_cta',
      role: 'cta_visual',
      requiredAsset: { type: 'generated', subject: 'CTA 卡片' },
      fallbackStrategies: ['cta_card'],
      importance: 4
    }
  ],
  rhythm: { avgShotDuration: 2.5, cutFrequency: 'high', pattern: 'fast_opening_to_cta' },
  packaging: {
    captionDensity: 'medium',
    captionPosition: 'bottom_center',
    titleStyle: 'large_bold',
    cardTypes: ['title_card', 'selling_point_card', 'cta_card'],
    transitions: ['quick_cut'],
    coverStyle: 'product_cover'
  },
  creativeIngredients: [],
  edges: []
};

const timeline: TimelineItem[] = [
  {
    id: 'tl_hook',
    start: 0,
    end: 2,
    segmentRole: 'hook',
    sourceSegmentId: 'seg_hook',
    slotId: 'slot_hook',
    assetId: 'asset_splash',
    script: '热到没精神？先冰一下。',
    subtitles: ['热到没精神', '先冰一下'],
    visualAction: '冰块飞溅中推近康师傅冰红茶瓶身',
    packaging: { captionStyle: 'bold_title', cardType: 'title_card', transition: 'quick_cut', motion: 'push_in' },
    scriptSource: 'template'
  },
  {
    id: 'tl_product',
    start: 2,
    end: 4,
    segmentRole: 'selling_point',
    sourceSegmentId: 'seg_product',
    slotId: 'slot_product',
    assetId: 'asset_bottle',
    script: '冰爽解腻，柠檬茶香。',
    subtitles: ['冰爽解腻', '柠檬茶香'],
    visualAction: '瓶身特写展示水珠和柠檬元素',
    packaging: { captionStyle: 'selling_point_card', cardType: 'selling_point_card', transition: 'zoom_in', motion: 'crop_zoom' },
    scriptSource: 'template'
  },
  {
    id: 'tl_usage',
    start: 4,
    end: 7,
    segmentRole: 'usage',
    sourceSegmentId: 'seg_usage',
    slotId: 'slot_usage',
    script: '运动后和饭后来一口。',
    subtitles: ['运动后', '饭后', '来一口'],
    visualAction: '用卖点卡补足饮用动作缺口',
    packaging: { captionStyle: 'clean', cardType: 'selling_point_card', transition: 'push', motion: 'static' },
    repair: {
      slotId: 'slot_usage',
      strategy: 'selling_point_card',
      explanation: '缺少真实饮用动作，用场景卖点卡补足表达。'
    },
    scriptSource: 'template'
  },
  {
    id: 'tl_cta',
    start: 7,
    end: 10,
    segmentRole: 'cta',
    sourceSegmentId: 'seg_cta',
    slotId: 'slot_cta',
    script: '想要冰爽解腻，就来一瓶康师傅冰红茶。',
    subtitles: ['现在来一瓶'],
    visualAction: '红色 CTA 卡片收束',
    packaging: { captionStyle: 'cta', cardType: 'cta_card', transition: 'fade', motion: 'static' },
    scriptSource: 'template'
  }
];

const assetCards: AssetCard[] = [
  {
    id: 'asset_splash',
    type: 'image',
    url: '/media/demo-assets/kangshifu_iced_tea/splash.png',
    detectedObjects: ['bottle', 'ice'],
    suitableSlots: ['opening_attention'],
    qualityScore: 0.9,
    spatialDescription: '康师傅冰红茶瓶身与冰块飞溅'
  },
  {
    id: 'asset_bottle',
    type: 'image',
    url: '/media/demo-assets/kangshifu_iced_tea/bottle.png',
    detectedObjects: ['bottle', 'lemon'],
    suitableSlots: ['product_closeup'],
    qualityScore: 0.92,
    spatialDescription: '瓶身正面特写'
  }
];

const slotMatches: SlotMatch[] = [
  { slotId: 'slot_hook', assetId: 'asset_splash', score: 0.9, status: 'matched', reason: '飞溅画面适合高能开场' },
  { slotId: 'slot_product', assetId: 'asset_bottle', score: 0.92, status: 'matched', reason: '瓶身特写适合产品槽位' },
  { slotId: 'slot_usage', score: 0.2, status: 'missing', reason: '缺少真实饮用动作' }
];

const materialGaps: MaterialGap[] = [
  {
    slotId: 'slot_usage',
    role: 'usage_demo',
    type: 'missing_usage_demo',
    severity: 'high',
    reason: '没有手持饮用动作素材',
    impact: '使用场景表达不足',
    gapSpecSource: 'rule_based'
  }
];

const repairs: GapRepair[] = [
  {
    slotId: 'slot_usage',
    strategy: 'selling_point_card',
    explanation: '用场景卖点卡补足饮用动作缺口。'
  }
];

test('planStoryboardFrames selects high-value timeline items and returns prompt-ready placeholders', () => {
  const result = planStoryboardFrames({
    timeline,
    structureGraph: graph,
    contentBrief: brief,
    assetCards,
    slotMatches,
    materialGaps,
    repairs
  });

  assert.equal(result.frames.length, 5);
  assert.deepEqual(result.frames.map((frame) => frame.frameType), [
    'opening_hook',
    'product_closeup',
    'benefit_usage',
    'gap_repair',
    'cta_cover'
  ]);
  assert.ok(result.frames.length <= 5);
  assert.ok(result.frames.every((frame) => frame.imagePrompt.positivePrompt.includes('康师傅冰红茶')));
  assert.ok(result.frames.every((frame) => frame.imagePrompt.negativePrompt.includes('不要照搬源片商品')));
  assert.ok(result.frames.every((frame) => frame.generatedVisualAsset?.url.startsWith('data:image/svg+xml')));
  assert.ok(result.frames.every((frame) => frame.generatedVisualAsset?.generationSource === 'placeholder'));
  assert.ok(result.frames.every((frame) => frame.safetyStatus.status !== 'blocked'));

  const gapFrame = result.frames.find((frame) => frame.frameType === 'gap_repair');
  assert.ok(gapFrame);
  assert.equal(gapFrame.repair?.strategy, 'selling_point_card');
  assert.equal(gapFrame.materialGap?.type, 'missing_usage_demo');
});
