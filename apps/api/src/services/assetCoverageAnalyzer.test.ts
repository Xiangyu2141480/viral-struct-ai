import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetCard, ContentBrief, ViralStructureGraph } from '@viral-struct/shared';
import { loadAssetLibrary } from './assetLibraryLoader';
import { analyzeAssetCoverage } from './assetManager/assetCoverageAnalyzer';
import { scoreSlotAffordance } from './assetManager/slotAffordanceScorer';

const brief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏季通勤人群',
  scenario: '午后高温、聚餐和运动后',
  sellingPoints: ['冰爽解腻', '柠檬茶香', '大瓶畅饮'],
  cta: '想要冰爽解腻，就来一瓶康师傅冰红茶。',
  stylePreference: '夏日高点击营销短视频'
};

const graph: ViralStructureGraph = {
  schemaVersion: 'v1',
  meta: {
    duration: 12,
    aspectRatio: '9:16',
    videoType: 'ecommerce',
    style: 'high_click'
  },
  structureSummary: 'Opening splash, product closeup, benefit proof, usage, CTA.',
  segments: [
    {
      id: 'seg_hook',
      role: 'hook',
      start: 0,
      end: 2,
      duration: 2,
      purpose: '用强视觉抓住注意力',
      transferRule: '迁移开场冲击力',
      importance: 5
    },
    {
      id: 'seg_product',
      role: 'selling_point',
      start: 2,
      end: 4,
      duration: 2,
      purpose: '展示商品和瓶身标签',
      transferRule: '迁移中心构图商品确认',
      importance: 5
    },
    {
      id: 'seg_usage',
      role: 'usage',
      start: 4,
      end: 8,
      duration: 4,
      purpose: '展示真实饮用/使用过程',
      transferRule: '迁移使用场景证明',
      importance: 4
    },
    {
      id: 'seg_cta',
      role: 'cta',
      start: 8,
      end: 12,
      duration: 4,
      purpose: '引导购买',
      transferRule: '迁移收口转化',
      importance: 4
    }
  ],
  shotSlots: [
    {
      id: 'slot_opening',
      segmentId: 'seg_hook',
      role: 'opening_attention',
      requiredAsset: { type: 'image', subject: '冰爽冲击视觉', camera: 'medium', motion: 'fast_cut' },
      visualIngredientRequirements: ['lifestyle_context', 'premium_visual'],
      fallbackStrategies: ['selling_point_card'],
      importance: 5,
      intent: {
        purpose: '用高能冰爽画面制造开场注意力',
        energyLevel: 'high',
        motionPattern: '液体飞溅或快速推近',
        compositionPrincipal: '产品居中，周围有动势',
        durationMs: [800, 1600]
      },
      sourceInstance: { productInSource: '源片产品动态入画', specificAction: '高能开场' },
      acceptanceCriteria: {
        anyOf: [{ motionType: 'fast_cut', compositionType: 'center_product', examples: ['冰块飞溅', '产品快速推近'] }]
      }
    },
    {
      id: 'slot_product',
      segmentId: 'seg_product',
      role: 'product_closeup',
      requiredAsset: { type: 'image', subject: '清晰瓶身和标签', camera: 'closeup', motion: 'static' },
      visualIngredientRequirements: ['product_closeup_trait', 'clean_background'],
      fallbackStrategies: ['crop_zoom'],
      importance: 5,
      intent: {
        purpose: '让用户确认商品和包装',
        energyLevel: 'medium',
        motionPattern: '稳定近景',
        compositionPrincipal: '标签清晰',
        durationMs: [1000, 2200]
      },
      sourceInstance: { productInSource: '源片商品近景', specificAction: '正面标签展示' },
      acceptanceCriteria: {
        anyOf: [{ compositionType: 'label_closeup', examples: ['瓶身正面', '包装标签清晰'] }]
      }
    },
    {
      id: 'slot_usage',
      segmentId: 'seg_usage',
      role: 'usage_demo',
      requiredAsset: { type: 'video', subject: '真实饮用过程', camera: 'medium', motion: 'hand_operation' },
      visualIngredientRequirements: ['hand_demo', 'lifestyle_context'],
      humanRequirement: { required: true, framing: 'hands', action: 'holding_product' },
      fallbackStrategies: ['ask_user_for_human_demo', 'selling_point_card'],
      importance: 4,
      intent: {
        purpose: '用使用过程证明冰爽解腻',
        energyLevel: 'medium',
        motionPattern: '手持饮用动作',
        compositionPrincipal: '手和产品同时可见',
        durationMs: [1500, 3000]
      },
      sourceInstance: { productInSource: '源片使用动作', specificAction: '手持操作' },
      acceptanceCriteria: {
        anyOf: [{ motionType: 'hand_operation', compositionType: 'hands_product', examples: ['手持瓶身', '饮用动作'] }],
        rejectIf: ['只有静态产品图']
      }
    },
    {
      id: 'slot_cta',
      segmentId: 'seg_cta',
      role: 'cta_visual',
      requiredAsset: { type: 'text', subject: '购买引导', camera: 'unknown', motion: 'static' },
      fallbackStrategies: ['cta_card'],
      importance: 4,
      intent: {
        purpose: '明确告诉用户下一步行动',
        energyLevel: 'medium',
        motionPattern: '卡片收束',
        compositionPrincipal: '文案清楚',
        durationMs: [1000, 2000]
      },
      sourceInstance: { productInSource: '源片 CTA 收口', specificAction: '购买引导' },
      acceptanceCriteria: {
        anyOf: [{ compositionType: 'cta_card', examples: ['立即购买', '来一瓶'] }]
      }
    }
  ],
  rhythm: { avgShotDuration: 1.6, cutFrequency: 'high', pattern: 'fast opening then proof' },
  packaging: {
    captionDensity: 'high',
    captionPosition: 'bottom_center',
    titleStyle: 'bold summer title',
    cardTypes: ['title_card', 'selling_point_card', 'cta_card'],
    transitions: ['quick_cut', 'push'],
    coverStyle: 'product hero cover'
  },
  creativeIngredients: [],
  edges: []
};

test('scoreSlotAffordance separates product closeup, benefit proof, CTA and usage roles', async () => {
  const assets = await loadAssetLibrary('kangshifu_demo');
  const product = assets.find((asset) => asset.id === 'asset_001');
  const splash = assets.find((asset) => asset.id === 'asset_002');
  assert.ok(product);
  assert.ok(splash);

  const productScores = scoreSlotAffordance(product, brief);
  const splashScores = scoreSlotAffordance(splash, brief);

  assert.ok((productScores.find((score) => score.role === 'product_closeup')?.score ?? 0) >= 75);
  assert.ok((splashScores.find((score) => score.role === 'benefit_proof')?.score ?? 0) >= 65);
  assert.ok((productScores.find((score) => score.role === 'usage_demo')?.score ?? 100) < 50);
  assert.ok((productScores.find((score) => score.role === 'cta')?.score ?? 0) >= 50);
});

test('analyzeAssetCoverage reports weak or missing usage demo coverage for the Kangshifu still-image library', async () => {
  const assets = await loadAssetLibrary('kangshifu_demo');

  const result = analyzeAssetCoverage({ structureGraph: graph, assetCards: assets, contentBrief: brief });

  assert.equal(result.matrix.totalSlotCount, 4);
  assert.ok(result.matrix.coverageRatio > 0);
  assert.equal(result.matrix.slotRows.find((row) => row.slotId === 'slot_product')?.status, 'covered');
  assert.equal(result.matrix.slotRows.find((row) => row.slotId === 'slot_usage')?.status !== 'covered', true);
  assert.ok(result.report.missingRoles.includes('usage_demo') || result.report.weakRoles.includes('usage_demo'));
  assert.ok(result.report.roleCoverage.product_closeup.bestScore >= 75);
  assert.ok(result.report.recommendations.some((item) => item.includes('usage_demo')));
  assert.equal(result.assetCards.every((asset) => asset.analysis?.slotAffordance.primaryRoles.length), true);
});

test('analyzeAssetCoverage falls back to role-level coverage when structureGraph has no shotSlots', async () => {
  const assets = await loadAssetLibrary('kangshifu_demo');
  const result = analyzeAssetCoverage({
    structureGraph: { ...graph, shotSlots: [] },
    assetCards: assets,
    contentBrief: brief
  });

  assert.equal(result.matrix.totalSlotCount, 10);
  assert.ok(result.warnings.some((warning) => warning.includes('role-level coverage')));
  assert.ok(result.report.roleCoverage.product_closeup.status === 'covered');
});

test('analyzeAssetCoverage filters long-video parent cards before downstream coverage', () => {
  const segment = {
    id: 'long_video_seg_001',
    type: 'video',
    url: '/media/uploads/long.mp4',
    spatialDescription: '手持瓶身开盖动作片段。',
    temporalDescription: 'Segment 1 of long_video: 3s-7s.',
    detectedObjects: ['beverage bottle', 'hand', 'product'],
    suitableSlots: ['usage_demo', 'product_closeup'],
    qualityScore: 0.78,
    segmentSource: {
      parentAssetId: 'long_video',
      startSec: 3,
      endSec: 7,
      durationSec: 4,
      segmentIndex: 0,
      label: '开盖动作片段',
      visualSummary: '手持瓶身完成开盖动作。',
      roleHints: ['usage_demo', 'product_closeup'],
      actionTags: ['open_cap', 'hand_operation'],
      confidence: 0.82,
      source: 'deterministic'
    }
  } satisfies AssetCard;
  const parent = {
    id: 'long_video',
    type: 'video',
    url: '/media/uploads/long.mp4',
    spatialDescription: '父级长视频，仅作为媒体来源。',
    detectedObjects: ['beverage bottle', 'product'],
    suitableSlots: ['usage_demo', 'product_closeup', 'cta_visual'],
    qualityScore: 0.8,
    analysis: {
      videoSegments: [{
        id: 'long_video_seg_001',
        parentAssetId: 'long_video',
        startSec: 3,
        endSec: 7,
        durationSec: 4,
        label: '开盖动作片段',
        visualSummary: '手持瓶身完成开盖动作。',
        roleHints: ['usage_demo', 'product_closeup'],
        actionTags: ['open_cap', 'hand_operation'],
        qualityScore: 0.78,
        confidence: 0.82,
        keyframeIds: [],
        source: 'deterministic'
      }]
    }
  } as unknown as AssetCard;

  const result = analyzeAssetCoverage({
    structureGraph: graph,
    assetCards: [parent, segment],
    contentBrief: brief
  });

  assert.equal(result.assetCards.some((asset) => asset.id === 'long_video'), false);
  assert.equal(result.assetCards.some((asset) => asset.id === 'long_video_seg_001'), true);
  assert.ok(result.warnings.some((warning) => warning.includes('long-video parent')));
});
