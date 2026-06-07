import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetCard, ContentBrief, ViralStructureGraph } from '@viral-struct/shared';
import { buildAssetSupplyContext } from './assetManager/assetSupplyContextBuilder';

const brief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏季通勤人群',
  scenario: '午后高温',
  sellingPoints: ['冰爽解腻', '柠檬茶香'],
  cta: '立即来一瓶康师傅冰红茶。',
  stylePreference: '高点击夏日营销短视频'
};

const graph: ViralStructureGraph = {
  meta: { duration: 12, aspectRatio: '9:16', videoType: 'ecommerce', style: 'high_click' },
  structureSummary: 'Opening, product, usage, comparison, CTA.',
  segments: [
    { id: 'seg_hook', role: 'hook', start: 0, end: 2, duration: 2, purpose: '开场吸引', transferRule: '迁移高能开场', importance: 5 },
    { id: 'seg_product', role: 'selling_point', start: 2, end: 4, duration: 2, purpose: '商品确认', transferRule: '迁移商品近景', importance: 5 },
    { id: 'seg_usage', role: 'usage', start: 4, end: 8, duration: 4, purpose: '使用证明', transferRule: '迁移使用动作', importance: 4 },
    { id: 'seg_compare', role: 'comparison', start: 8, end: 10, duration: 2, purpose: '对比证明', transferRule: '迁移对比段落', importance: 3 },
    { id: 'seg_cta', role: 'cta', start: 10, end: 12, duration: 2, purpose: '行动引导', transferRule: '迁移 CTA 收口', importance: 4 }
  ],
  shotSlots: [
    {
      id: 'slot_hook',
      segmentId: 'seg_hook',
      role: 'opening_attention',
      requiredAsset: { type: 'image', subject: '冰爽冲击视觉', camera: 'medium', motion: 'fast_cut', minDuration: 1 },
      visualIngredientRequirements: ['premium_visual'],
      fallbackStrategies: ['selling_point_card'],
      importance: 5,
      intent: { purpose: '用冰爽高能画面抓住注意力', energyLevel: 'high', motionPattern: '快速推近', compositionPrincipal: '产品居中', durationMs: [800, 1600] }
    },
    {
      id: 'slot_product',
      segmentId: 'seg_product',
      role: 'product_closeup',
      requiredAsset: { type: 'image', subject: '清晰瓶身标签', camera: 'closeup', motion: 'static' },
      fallbackStrategies: ['crop_zoom'],
      importance: 5,
      intent: { purpose: '让用户确认商品和包装', energyLevel: 'medium', motionPattern: '稳定近景', compositionPrincipal: '标签清晰', durationMs: [1000, 2200] }
    },
    {
      id: 'slot_usage',
      segmentId: 'seg_usage',
      role: 'usage_demo',
      requiredAsset: { type: 'video', subject: '手持饮用过程', camera: 'medium', motion: 'hand_operation', minDuration: 2 },
      humanRequirement: { required: true, framing: 'hands', action: 'holding_product' },
      fallbackStrategies: ['ask_user_for_human_demo'],
      importance: 4,
      intent: { purpose: '用真实使用过程证明冰爽解腻', energyLevel: 'medium', motionPattern: '手持饮用', compositionPrincipal: '手和产品同时可见', durationMs: [1500, 3000] }
    },
    {
      id: 'slot_compare',
      segmentId: 'seg_compare',
      role: 'comparison',
      requiredAsset: { type: 'image', subject: '对比或陈列', camera: 'wide', motion: 'static' },
      fallbackStrategies: ['selling_point_card'],
      importance: 3,
      intent: { purpose: '展示对比或系列陈列', energyLevel: 'medium', motionPattern: '稳定展示', compositionPrincipal: '对比关系清楚', durationMs: [1000, 2000] }
    },
    {
      id: 'slot_cta',
      segmentId: 'seg_cta',
      role: 'cta_visual',
      requiredAsset: { type: 'text', subject: '购买引导', camera: 'unknown', motion: 'static', minDuration: 1 },
      fallbackStrategies: ['cta_card'],
      importance: 4,
      intent: { purpose: '明确给出下一步行动', energyLevel: 'medium', motionPattern: '卡片收束', compositionPrincipal: '文字清楚', durationMs: [1000, 2000] }
    }
  ],
  rhythm: { avgShotDuration: 1.8, cutFrequency: 'high', pattern: 'fast hook then proof' },
  packaging: {
    captionDensity: 'high',
    captionPosition: 'bottom_center',
    titleStyle: 'bold summer',
    cardTypes: ['title_card', 'selling_point_card', 'cta_card'],
    transitions: ['quick_cut'],
    coverStyle: 'product'
  },
  creativeIngredients: [],
  edges: []
};

const oldProductAsset: AssetCard = {
  id: 'asset_product',
  type: 'image',
  url: '/media/demo-assets/kangshifu_iced_tea/kangshifu-iced-tea-product-shot.png',
  spatialDescription: '瓶身标签清晰，白底产品近景。',
  detectedObjects: ['beverage bottle', 'label', 'product'],
  suitableSlots: ['product_closeup', 'cta_visual'],
  qualityScore: 0.84,
  detectedIngredients: ['product_closeup_trait', 'clean_background'],
  humanPresence: { hasHuman: false },
  visualStyleTags: ['clean_background']
};

const splashAsset: AssetCard = {
  id: 'asset_splash',
  type: 'image',
  url: '/media/demo-assets/kangshifu_iced_tea/kangshifu-iced-tea-splash.png',
  spatialDescription: '冰块和茶饮飞溅，产品有夏日冲击感。',
  detectedObjects: ['beverage bottle', 'ice cubes', 'liquid splash', 'product'],
  suitableSlots: ['opening_attention', 'benefit_visual'],
  qualityScore: 0.88,
  detectedIngredients: ['premium_visual', 'lifestyle_context'],
  humanPresence: { hasHuman: false },
  visualStyleTags: ['premium_visual', 'lifestyle_context']
};

const lowSafeAreaText: AssetCard = {
  id: 'asset_text_low_safe_area',
  type: 'text',
  text: '立即来一瓶，冰爽解腻。',
  detectedObjects: ['cta_copy'],
  suitableSlots: ['cta_visual'],
  qualityScore: 0.62,
  analysis: {
    profileVersion: 'asset_analysis_v1',
    analyzedAt: '1970-01-01T00:00:00.000Z',
    fallbackUsed: true,
    warnings: ['Provided text is usable as copy but has no visual backing asset.'],
    media: { kind: 'text', textLength: 11, keyframes: [] },
    semantic: { summary: 'CTA copy only.', detectedObjects: ['cta_copy'], detectedIngredients: [], visualStyleTags: [] },
    quality: {
      overallScore: 0.62,
      resolution: 0.62,
      sharpness: 0.62,
      brightness: 0.62,
      contrast: 0.62,
      clarity: 0.62,
      composition: 0.62,
      lighting: 0.62,
      subjectProminence: 0.62,
      productFocus: 0.35,
      textSafeArea: 0.4,
      issues: []
    },
    slotAffordance: {
      suitableSlots: ['cta_visual'],
      primaryRoles: [{ role: 'cta_visual', confidence: 0.72 }],
      missingRoles: ['opening_attention', 'product_closeup', 'usage_demo', 'benefit_visual', 'comparison', 'testimonial'],
      rationale: 'CTA copy supports overlay only.'
    },
    editability: { canCropZoom: false, canUseAsBackground: false, canLoop: false, canExtendWithCards: true, suggestedEdits: ['use_as_cta_copy'] },
    safety: { status: 'passed', brandRisk: 'low', ipRisk: 'low', claimRisk: 'low', reasons: [] },
    search: { tags: ['cta_copy'], keywords: ['立即来一瓶'], embeddingText: 'CTA copy only.' }
  }
};

const plainProductPanVideo: AssetCard = {
  id: 'plain_product_pan',
  type: 'video',
  url: 'seed_assets/user_test/kangshifu_plain_uploads/plain_001_table_product_pan.mp4',
  spatialDescription: 'Plain user-shot Kangshifu iced tea product on table with a slow pan.',
  temporalDescription: '10s vertical product pan; no hand action, no drinking, no pouring.',
  detectedObjects: ['beverage bottle', 'product'],
  suitableSlots: ['product_closeup', 'cta_visual'],
  qualityScore: 0.74,
  detectedIngredients: ['product_closeup_trait'],
  humanPresence: { hasHuman: false },
  visualStyleTags: ['clean_background'],
  motionPotential: {
    isStill: false,
    implicitMotion: 'medium',
    canSimulateMotion: ['trim_to_highlight', 'crop_to_vertical'],
    canSimulateDurationMs: [1200, 4200]
  }
};

const plainHandPickupVideo: AssetCard = {
  id: 'plain_hand_pickup',
  type: 'video',
  url: 'seed_assets/user_test/kangshifu_plain_uploads/plain_002_hand_pickup.mp4',
  spatialDescription: 'Plain user-shot Kangshifu iced tea hand pickup clip.',
  temporalDescription: '10s vertical hand pickup; no open cap, no drinking, no pouring.',
  detectedObjects: ['beverage bottle', 'product', 'hand', 'usage scene'],
  suitableSlots: ['usage_demo', 'product_closeup', 'cta_visual'],
  qualityScore: 0.74,
  detectedIngredients: ['product_closeup_trait', 'hand_demo', 'human_presence'],
  humanPresence: { hasHuman: true, actions: ['holding_product'] },
  visualStyleTags: ['clean_background'],
  motionPotential: {
    isStill: false,
    implicitMotion: 'high',
    canSimulateMotion: ['trim_to_highlight', 'crop_to_vertical'],
    canSimulateDurationMs: [1200, 4200]
  }
};

const plainOpenCapVideo: AssetCard = {
  id: 'plain_open_cap',
  type: 'video',
  url: 'seed_assets/user_test/kangshifu_plain_uploads/plain_003_open_cap.mp4',
  spatialDescription: 'Plain user-shot Kangshifu iced tea bottle cap opening clip.',
  temporalDescription: '10s vertical open cap product operation; no UI assembly, no keyboard, no multi-device transfer.',
  detectedObjects: ['beverage bottle', 'product', 'hand'],
  suitableSlots: ['usage_demo', 'product_closeup'],
  qualityScore: 0.74,
  detectedIngredients: ['product_closeup_trait', 'hand_demo', 'human_presence'],
  humanPresence: { hasHuman: true, actions: ['holding_product'] },
  visualStyleTags: ['clean_background'],
  motionPotential: {
    isStill: false,
    implicitMotion: 'high',
    canSimulateMotion: ['trim_to_highlight', 'crop_to_vertical'],
    canSimulateDurationMs: [1200, 4200]
  }
};

const plainDrinkVideo: AssetCard = {
  id: 'plain_drink_neck_down',
  type: 'video',
  url: 'seed_assets/user_test/kangshifu_plain_uploads/plain_004_drink_neck_down.mp4',
  spatialDescription: 'Plain user-shot neck-down drinking clip with Kangshifu iced tea bottle.',
  temporalDescription: '10s vertical drinking usage clip; no product assembly, no UI transition, no comparison lineup.',
  detectedObjects: ['beverage bottle', 'product', 'hand', 'usage scene'],
  suitableSlots: ['usage_demo', 'benefit_visual', 'product_closeup'],
  qualityScore: 0.74,
  detectedIngredients: ['product_closeup_trait', 'hand_demo', 'human_presence', 'lifestyle_context'],
  humanPresence: { hasHuman: true, actions: ['holding_product'] },
  visualStyleTags: ['clean_background', 'lifestyle_context'],
  motionPotential: {
    isStill: false,
    implicitMotion: 'high',
    canSimulateMotion: ['trim_to_highlight', 'crop_to_vertical'],
    canSimulateDurationMs: [1200, 4200]
  }
};

const badDarkShakyVideo: AssetCard = {
  ...plainProductPanVideo,
  id: 'plain_bad_dark_shaky',
  spatialDescription: 'Bad dark shaky product clip with visible bottle.',
  temporalDescription: '10s dark shaky vertical clip.',
  qualityScore: 0.38,
  analysis: {
    profileVersion: 'asset_analysis_v1',
    analyzedAt: '1970-01-01T00:00:00.000Z',
    fallbackUsed: false,
    warnings: ['Filename indicates a bad/dark/shaky test clip.'],
    media: {
      kind: 'video',
      sourceUrl: 'seed_assets/user_test/kangshifu_plain_uploads/plain_009_bad_dark_shaky.mp4',
      fileSizeBytes: 2000000,
      format: 'mp4',
      durationSec: 10,
      fps: 24,
      width: 720,
      height: 1280,
      aspectRatio: '9:16',
      hasAudio: true,
      keyframes: []
    },
    semantic: {
      summary: 'Bad dark shaky product clip with visible bottle.',
      detectedObjects: ['beverage bottle', 'product'],
      detectedIngredients: ['product_closeup_trait'],
      visualStyleTags: [],
      humanPresence: { hasHuman: false },
      motionPotential: { isStill: false, implicitMotion: 'medium' }
    },
    quality: {
      overallScore: 0.38,
      resolution: 0.38,
      sharpness: 0.35,
      brightness: 0.32,
      contrast: 0.38,
      clarity: 0.36,
      composition: 0.38,
      lighting: 0.3,
      subjectProminence: 0.38,
      productFocus: 0.45,
      textSafeArea: 0.4,
      issues: [{ type: 'low_quality', severity: 'medium', message: 'Dark or shaky footage should remain weak evidence.' }]
    },
    slotAffordance: {
      suitableSlots: ['product_closeup'],
      primaryRoles: [{ role: 'product_closeup', confidence: 0.45 }],
      missingRoles: ['opening_attention', 'usage_demo', 'benefit_visual', 'comparison', 'testimonial', 'cta_visual'],
      rationale: 'Low quality clip should not strongly cover slots.'
    },
    editability: { canCropZoom: true, canUseAsBackground: false, canLoop: true, canExtendWithCards: false, suggestedEdits: ['trim_to_highlight'] },
    safety: { status: 'passed', brandRisk: 'low', ipRisk: 'low', claimRisk: 'low', reasons: [] },
    search: { tags: ['video', 'product_closeup'], keywords: ['bad dark shaky product'], embeddingText: 'bad dark shaky product' }
  }
};

test('buildAssetSupplyContext emits deterministic legacy analysis warnings and stable output', () => {
  const first = buildAssetSupplyContext({
    structureGraph: graph,
    assetCards: [oldProductAsset, splashAsset, lowSafeAreaText],
    contentBrief: brief,
    libraryId: 'kangshifu_demo'
  });
  const second = buildAssetSupplyContext({
    structureGraph: graph,
    assetCards: [oldProductAsset, splashAsset, lowSafeAreaText],
    contentBrief: brief,
    libraryId: 'kangshifu_demo'
  });

  assert.deepEqual(first, second);
  assert.equal(first.protocolVersion, 'asset-supply-v1');
  assert.ok(first.warnings.some((warning) => warning.includes('legacy AssetCard')));
  assert.equal(JSON.stringify(first).includes('fallbackCards'), false);
  assert.equal(JSON.stringify(first).includes('suggestedRepair'), false);
});

test('buildAssetSupplyContext extracts richer role-specific required ingredients', () => {
  const context = buildAssetSupplyContext({
    structureGraph: graph,
    assetCards: [oldProductAsset, splashAsset, lowSafeAreaText],
    contentBrief: brief,
    libraryId: 'kangshifu_demo'
  });
  const rows = context.contextualCoverage?.slotCoverages ?? [];

  const hookKinds = rows.find((row) => row.slotId === 'slot_hook')?.requiredIngredients.map((item) => item.kind) ?? [];
  assert.ok(hookKinds.includes('visual_subject'));
  assert.ok(hookKinds.includes('motion'));
  assert.ok(hookKinds.includes('text_safe_area'));
  assert.ok(hookKinds.includes('aspect_ratio'));
  assert.ok(hookKinds.includes('duration'));
  assert.ok(hookKinds.includes('packaging_surface'));

  const productKinds = rows.find((row) => row.slotId === 'slot_product')?.requiredIngredients.map((item) => item.kind) ?? [];
  assert.ok(productKinds.includes('product_evidence'));
  assert.ok(productKinds.includes('visual_subject'));
  assert.ok(productKinds.includes('shot_type'));
  assert.ok(productKinds.includes('text_safe_area'));
  assert.ok(productKinds.includes('aspect_ratio'));

  const ctaKinds = rows.find((row) => row.slotId === 'slot_cta')?.requiredIngredients.map((item) => item.kind) ?? [];
  assert.ok(ctaKinds.includes('cta_surface'));
  assert.ok(ctaKinds.includes('product_evidence'));
  assert.ok(ctaKinds.includes('text_safe_area'));
  assert.ok(ctaKinds.includes('duration'));
});

test('buildAssetSupplyContext distinguishes weak/insufficient coverage and candidate constraints', () => {
  const context = buildAssetSupplyContext({
    structureGraph: graph,
    assetCards: [oldProductAsset, splashAsset, lowSafeAreaText],
    contentBrief: brief,
    libraryId: 'kangshifu_demo'
  });
  const rows = context.contextualCoverage?.slotCoverages ?? [];
  const usage = rows.find((row) => row.slotId === 'slot_usage');
  const cta = rows.find((row) => row.slotId === 'slot_cta');

  assert.equal(usage?.coverageStatus, 'insufficient');
  assert.ok((usage?.missingIngredients.length ?? 0) > 0);
  assert.ok(usage?.candidateAssets.some((candidate) => candidate.constraints.notEnoughForStandaloneShot));
  assert.ok(usage?.candidateAssets.some((candidate) => candidate.constraints.needsOverlaySupport));
  assert.ok(context.contextualCoverage?.observations.some((observation) => observation.affectedSlotId === 'slot_usage' && observation.observationType === 'missing_usage_evidence'));

  assert.ok(cta?.candidateAssets.some((candidate) => candidate.constraints.textSafeAreaRisk));
});

test('plain product pan video does not over-cover usage or comparison slots', () => {
  const context = buildAssetSupplyContext({
    structureGraph: graph,
    assetCards: [plainProductPanVideo],
    contentBrief: brief,
    libraryId: 'plain_product_pan_only'
  });
  const rows = context.contextualCoverage?.slotCoverages ?? [];
  const product = rows.find((row) => row.slotId === 'slot_product');
  const usage = rows.find((row) => row.slotId === 'slot_usage');
  const comparison = rows.find((row) => row.slotId === 'slot_compare');

  assert.equal(product?.coverageStatus, 'covered');
  assert.notEqual(usage?.coverageStatus, 'covered');
  assert.equal(comparison?.coverageStatus, 'insufficient');
  assert.ok((context.contextualCoverage?.observations.length ?? 0) > 0);
  assert.ok(context.contextualCoverage?.observations.some((observation) => observation.observationType === 'missing_comparison_evidence'));
  assert.ok(JSON.stringify(context).includes('fallbackCards') === false);
  assert.ok(JSON.stringify(context).includes('suggestedRepair') === false);
});

test('plain product pan plus hand pickup is partial material supply, not full coverage', () => {
  const context = buildAssetSupplyContext({
    structureGraph: graph,
    assetCards: [plainProductPanVideo, plainHandPickupVideo],
    contentBrief: brief,
    libraryId: 'plain_two_video_test'
  });
  const summary = context.contextualCoverage?.coverageSummary;
  const rows = context.contextualCoverage?.slotCoverages ?? [];
  const product = rows.find((row) => row.slotId === 'slot_product');
  const usage = rows.find((row) => row.slotId === 'slot_usage');
  const comparison = rows.find((row) => row.slotId === 'slot_compare');

  assert.equal(product?.coverageStatus, 'covered');
  assert.notEqual(usage?.coverageStatus, 'covered');
  assert.equal(comparison?.coverageStatus, 'insufficient');
  assert.ok((summary?.coverageScore ?? 100) < 100);
  assert.ok((summary?.insufficientSlots ?? 0) > 0);
  assert.ok((context.contextualCoverage?.observations.length ?? 0) > 0);
  assert.ok(context.contextualCoverage?.observations.some((observation) => observation.observationType === 'missing_usage_evidence'));
  assert.ok(context.contextualCoverage?.observations.some((observation) => observation.observationType === 'missing_comparison_evidence'));
});

test('hand pickup alone supports usage only weakly and does not cover CTA', () => {
  const context = buildAssetSupplyContext({
    structureGraph: graph,
    assetCards: [plainHandPickupVideo],
    contentBrief: brief,
    libraryId: 'plain_hand_pickup_only'
  });
  const rows = context.contextualCoverage?.slotCoverages ?? [];
  const usage = rows.find((row) => row.slotId === 'slot_usage');
  const cta = rows.find((row) => row.slotId === 'slot_cta');

  assert.equal(usage?.coverageStatus, 'weak');
  assert.notEqual(cta?.coverageStatus, 'covered');
  assert.ok((context.contextualCoverage?.observations.length ?? 0) > 0);
});

test('bad dark shaky product footage remains weak evidence', () => {
  const context = buildAssetSupplyContext({
    structureGraph: graph,
    assetCards: [badDarkShakyVideo],
    contentBrief: brief,
    libraryId: 'plain_bad_dark_shaky'
  });
  const product = context.contextualCoverage?.slotCoverages.find((row) => row.slotId === 'slot_product');

  assert.notEqual(product?.coverageStatus, 'covered');
  assert.ok(product?.candidateAssets.some((candidate) => candidate.fitStatus === 'weak' || candidate.evidence.warnings.length > 0));
  assert.ok((context.contextualCoverage?.observations.length ?? 0) > 0);
});

test('open cap and drinking clips do not cover unrelated assembly or UI usage slots', () => {
  const actionGraph: ViralStructureGraph = {
    ...graph,
    shotSlots: [
      ...graph.shotSlots,
      {
        id: 'slot_usage_assembly',
        segmentId: 'seg_usage',
        role: 'usage_demo',
        requiredAsset: { type: 'video', subject: '功能部件组装和按键操作', camera: 'medium', motion: 'hand_operation', minDuration: 2 },
        humanRequirement: { required: true, framing: 'hands', action: 'holding_product' },
        fallbackStrategies: ['ask_user_for_human_demo'],
        importance: 4,
        intent: {
          purpose: '通过配件组装、按键操作和 UI 切换展示复杂功能流程',
          energyLevel: 'medium',
          motionPattern: 'manual_part_assembly and smooth_ui_transition',
          compositionPrincipal: '产品和操作手同时可见',
          durationMs: [1500, 3000]
        },
        acceptanceCriteria: {
          anyOf: [
            {
              motionType: 'manual_part_assembly',
              compositionType: 'centered_product_clean_background',
              examples: ['配件对准卡槽嵌入机身', '手指按压按键', '多应用界面平滑轮播']
            }
          ],
          rejectIf: ['只有开盖、饮用或普通拿起动作']
        }
      }
    ]
  };
  const context = buildAssetSupplyContext({
    structureGraph: actionGraph,
    assetCards: [plainProductPanVideo, plainHandPickupVideo, plainOpenCapVideo, plainDrinkVideo],
    contentBrief: brief,
    libraryId: 'plain_four_video_test'
  });
  const rows = context.contextualCoverage?.slotCoverages ?? [];
  const drinkUsage = rows.find((row) => row.slotId === 'slot_usage');
  const assemblyUsage = rows.find((row) => row.slotId === 'slot_usage_assembly');

  assert.equal(drinkUsage?.coverageStatus, 'covered');
  assert.notEqual(assemblyUsage?.coverageStatus, 'covered');
  assert.ok(assemblyUsage?.limitations.some((limitation) => /specific|action|usage/i.test(limitation)));
  assert.ok(context.contextualCoverage?.observations.some((observation) => observation.affectedSlotId === 'slot_usage_assembly'));
});

test('kinetic assembly slots preserve motif context in coverage, observations and handoff briefs', () => {
  const kineticGraph: ViralStructureGraph = {
    ...graph,
    shotSlots: [
      ...graph.shotSlots,
      {
        id: 'slot_block_004_asset_001',
        segmentId: 'seg_usage',
        role: 'usage_demo',
        requiredAsset: { type: 'video', subject: 'surreal product assembly and activation spectacle', camera: 'medium', motion: 'fast_cut', minDuration: 2 },
        fallbackStrategies: ['ask_user_for_human_demo'],
        importance: 4,
        intent: {
          purpose: '键盘碎片在空中飞舞后落到笔记本上自动组装完成，手指按触控板控制屏幕里的火箭飞出笔记本炸开撒彩屑，按圆形按键弹出购买窗口。',
          energyLevel: 'high',
          motionPattern: 'component cascade, chaos to order, assembly completion, interaction activation, spectacle burst, CTA reveal',
          compositionPrincipal: 'surreal kinetic assembly reveal',
          durationMs: [1600, 4200]
        },
        sourceInstance: {
          productInSource: 'MacBook',
          specificAction: 'keyboard fragments assemble, touchpad controls rocket, circular button opens purchase window'
        },
        acceptanceCriteria: {
          anyOf: [
            {
              motionType: 'keyboard fragments fly then assemble on laptop',
              compositionType: 'hardware activation spectacle',
              examples: ['rocket flies out of laptop', 'purchase window pops up']
            }
          ]
        }
      }
    ]
  };
  const context = buildAssetSupplyContext({
    structureGraph: kineticGraph,
    assetCards: [plainProductPanVideo],
    contentBrief: brief,
    libraryId: 'motif_context_test'
  });

  const kineticCoverage = context.contextualCoverage?.slotCoverages.find((row) => row.slotId === 'slot_block_004_asset_001') as any;
  const plainUsageCoverage = context.contextualCoverage?.slotCoverages.find((row) => row.slotId === 'slot_usage') as any;
  const observation = context.contextualCoverage?.observations.find((item) => item.affectedSlotId === 'slot_block_004_asset_001') as any;
  const missingBrief = context.missingMaterialBriefs?.find((item) => item.affectedSlotId === 'slot_block_004_asset_001') as any;

  assert.equal(kineticCoverage?.motifContext?.motifType, 'kinetic_assembly_reveal');
  assert.ok(kineticCoverage?.motifContext?.missingMotionTokens.includes('chaos_to_order'));
  assert.ok(kineticCoverage?.evidence.some((item: string) => item.includes('motif=kinetic_assembly_reveal')));
  assert.equal(observation?.motifType, 'kinetic_assembly_reveal');
  assert.ok(observation?.missingMotionTokens.includes('assembly_completion'));
  assert.ok(observation?.targetMotifHints.some((item: string) => /ice cubes|cold mist|CTA lock-up/i.test(item)));
  assert.equal(missingBrief?.motifContext?.motifType, 'kinetic_assembly_reveal');
  assert.match(missingBrief?.aigcGenerationBrief?.prompt ?? '', /chaos-to-order ingredient cascade/i);

  assert.equal(plainUsageCoverage?.motifContext, undefined);
});

test('single image only scenario produces completion briefs without owning repair strategy', () => {
  const context = buildAssetSupplyContext({
    structureGraph: graph,
    assetCards: [oldProductAsset],
    contentBrief: brief,
    libraryId: 'single_image_only'
  });
  const scenario = context.materialScenario;
  const usage = context.contextualCoverage?.slotCoverages.find((row) => row.slotId === 'slot_usage');
  const usageBrief = context.missingMaterialBriefs?.find((item) => item.affectedSlotId === 'slot_usage');

  assert.equal(scenario?.scenarioType, 'single_image_only');
  assert.ok((scenario?.completionFeasibilityScore ?? 0) > (scenario?.evidenceCoverageScore ?? 100));
  assert.equal(scenario?.recommendedDownstreamMode, 'single_image_motion_reuse');
  assert.equal(usage?.coverageStatus, 'insufficient');
  assert.ok(usageBrief);
  assert.equal(usageBrief?.ownership, 'asset_manager_handoff_brief_only');
  assert.ok(usageBrief?.manualShootBrief?.mustCapture.some((item) => /喝|开盖|倒|drink|pour|cap/i.test(item)));
  assert.ok(usageBrief?.aigcGenerationBrief?.prompt.includes('9:16'));
  assert.ok(usageBrief?.aigcGenerationBrief?.negativePrompt.includes('no text overlays'));
  assert.ok(usageBrief?.hyperframesBrief?.cardType === 'usage_placeholder_card');
  assert.equal(JSON.stringify(context).includes('fallbackCards'), false);
  assert.equal(JSON.stringify(context).includes('suggestedRepair'), false);
});

test('partial real footage scenario keeps weak usage evidence and missing material briefs', () => {
  const context = buildAssetSupplyContext({
    structureGraph: graph,
    assetCards: [plainProductPanVideo, plainHandPickupVideo],
    contentBrief: brief,
    libraryId: 'partial_real_footage'
  });
  const scenario = context.materialScenario;
  const usage = context.contextualCoverage?.slotCoverages.find((row) => row.slotId === 'slot_usage');

  assert.equal(scenario?.scenarioType, 'partial_real_footage');
  assert.equal(scenario?.realFootageCount, 2);
  assert.ok(['real_footage_editing', 'mixed_repair_workflow'].includes(scenario?.recommendedDownstreamMode ?? ''));
  assert.notEqual(usage?.coverageStatus, 'covered');
  assert.ok((context.missingMaterialBriefs?.length ?? 0) > 0);
  assert.ok(context.missingMaterialBriefs?.some((briefItem) => briefItem.slotRole === 'usage_demo'));
});

test('aigc ready scenario emits safe prompt briefs but no rendered-media claim', () => {
  const plannedAigcAsset: AssetCard = {
    ...oldProductAsset,
    id: 'planned_aigc_product_reference',
    type: 'image',
    url: undefined,
    spatialDescription: 'Planned generation descriptor for a product reference, not rendered output.',
    analysisSource: 'planned_generation',
    detectedObjects: ['beverage bottle', 'planned generation reference'],
    suitableSlots: ['product_closeup']
  };
  const context = buildAssetSupplyContext({
    structureGraph: graph,
    assetCards: [plannedAigcAsset],
    contentBrief: brief,
    libraryId: 'aigc_ready',
    options: { userCanGenerate: true }
  });
  const scenario = context.materialScenario;
  const promptBriefs = context.missingMaterialBriefs?.filter((item) => item.aigcGenerationBrief) ?? [];

  assert.equal(scenario?.scenarioType, 'aigc_ready');
  assert.ok((scenario?.generatedAssetCount ?? 0) > 0);
  assert.equal(scenario?.recommendedDownstreamMode, 'aigc_missing_material_generation');
  assert.ok(promptBriefs.length > 0);
  assert.ok(promptBriefs.every((item) => item.aigcGenerationBrief?.negativePrompt.includes('no watermark')));
  assert.ok(promptBriefs.every((item) => item.aigcGenerationBrief?.safetyNotes.some((note) => /brief|prompt|not rendered/i.test(note))));
  assert.equal(JSON.stringify(context).includes('real rendered output'), false);
  assert.equal(JSON.stringify(context).includes('fallbackCards'), false);
  assert.equal(JSON.stringify(context).includes('suggestedRepair'), false);
});
