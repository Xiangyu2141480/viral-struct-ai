import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ContextualSlotCoverage, MissingMaterialBrief, ShotSlotNode } from '@viral-struct/shared';
import { buildGapResolutionOptions } from './gapResolutionOptionsBuilder';
import { makeContentBrief } from './testFixtures';

const USER_VISIBLE_META_GUARDRAIL_RE =
  /品牌安全|合规|未授权品牌|其它可见品牌|明星|公众人物|医疗|功效保证|价格|促销|宣称|禁止出现|不得加入|只允许使用|仅为生成提示词|非成片|source|电子设备元素|maxRecommendedDurationSec|needsOverlaySupport|notEnoughForStandaloneShot/i;

function makeSlot(role: ShotSlotNode['role'] = 'usage_demo'): ShotSlotNode {
  return {
    id: 'slot_usage',
    segmentId: 'seg_usage',
    role,
    requiredAsset: { type: 'video', subject: 'opening cap and drinking' },
    fallbackStrategies: ['hand_demo']
  };
}

function makeBrief(aigcEligible = true): MissingMaterialBrief {
  return {
    id: 'brief_001',
    affectedSlotId: 'slot_usage',
    slotRole: 'usage_demo',
    slotIntent: 'show the product being used naturally',
    missingIngredients: [],
    potentialImpact: [],
    manualShootBrief: {
      title: '补拍使用过程',
      objective: 'Capture a real usage moment.',
      shotDescription: 'Shoot opening the cap and drinking one sip, hand-only.',
      durationSec: 4,
      framing: 'vertical hand/neck-down shot',
      requiredProps: ['cup', 'bottle'],
      mustCapture: ['open cap', 'drink one sip'],
      avoid: ['other brands', 'celebrity likeness', 'price claims', 'medical claims']
    },
    aigcGenerationBrief: {
      providerHint: 'seedance',
      prompt: 'Prompt brief only, not rendered output. Create a 9:16 usage shot, hand-only.',
      negativePrompt: 'no watermark, no other brands',
      referenceAssetIds: ['asset_usage'],
      expectedDurationSec: 4,
      aspectRatio: '9:16',
      safetyNotes: ['brief only']
    },
    hyperframesBrief: {
      title: 'Usage placeholder input',
      cardType: 'usage_placeholder_card',
      copyIntent: 'Explain the missing usage action with a step card.',
      visualElements: ['康师傅冰红茶', 'reference asset asset_usage'],
      animationHints: ['step 1/2/3 card', 'small product image'],
      durationSec: 3,
      inputAssets: ['asset_usage']
    },
    channelEligibility: [
      {
        channel: 'aigc_video_prompt',
        eligible: aigcEligible,
        confidence: aigcEligible ? 'medium' : 'low',
        reason: 'test',
        requiredInputs: [],
        providedInputs: [],
        missingInputs: [],
        ownership: 'external_generation_adapter'
      }
    ],
    ownership: 'asset_manager_handoff_brief_only'
  };
}

function makeCoverage(role = 'opening_attention'): ContextualSlotCoverage {
  return {
    slotId: `slot_${role}`,
    slotRole: role as ContextualSlotCoverage['slotRole'],
    slotIntent: 'use the current asset to support a beverage-native shot',
    requiredIngredients: [
      {
        id: 'ing_product',
        kind: 'product_evidence',
        label: '清晰产品与包装',
        requiredBy: { slotId: `slot_${role}` },
        importance: 'high'
      },
      {
        id: 'ing_safe_area',
        kind: 'text_safe_area',
        label: '文字安全区',
        requiredBy: { slotId: `slot_${role}` },
        importance: 'medium'
      }
    ],
    availableIngredients: [
      {
        requiredIngredientId: 'ing_product',
        assetId: 'plain_001_table_product_pan',
        score: 72,
        evidence: [
          '画面可见瓶身冷凝水珠',
          '同框有冰块和柠檬片',
          '镜头有稳定平移运动轨迹',
          'ranking=0.30*roleAffordance(87.3) + 0.20*quality(74)'
        ]
      }
    ],
    missingIngredients: [
      {
        requiredIngredientId: 'ing_safe_area',
        label: '文字安全区',
        reason: '现有素材需要定格或卡片层补足文字空间',
        evidence: ['主体占画面较满']
      }
    ],
    weakIngredients: [],
    coverageStatus: 'weak',
    candidateAssets: [
      {
        assetId: 'plain_001_table_product_pan',
        score: 64,
        fitStatus: 'usable',
        usableAs: 'video_clip',
        constraints: {
          maxRecommendedDurationSec: 10,
          needsOverlaySupport: true,
          notEnoughForStandaloneShot: true
        },
        evidence: {
          affordanceScore: 66,
          qualityScore: 72,
          semanticSignals: ['清晰瓶身', '冷凝水珠', '冰块', '柠檬片', '平移运动轨迹', '可定格尾帧'],
          reasons: [
            '画面可见瓶身冷凝水珠',
            '同框有冰块和柠檬片',
            '镜头有稳定平移轨迹可裁切推近',
            'plain_001_table_product_pan -> slot_native_02_reveal: 可覆盖; role=87.3, intent/criteria fit included.'
          ],
          warnings: []
        },
        mediaReadiness: {
          hasUsableUrl: true,
          hasLocalPath: false,
          hasThumbnail: true,
          hasKeyframe: true,
          hasDuration: true
        }
      }
    ],
    confidence: 'medium',
    evidence: ['existing asset supports cooling product evidence but needs edit layers'],
    limitations: []
  };
}

test('gap tier can offer three options: reshoot / hyperframes / aigc', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  assert.deepEqual(options.map((o) => o.id).sort(), ['aigc', 'hyperframes', 'reshoot']);
});

test('partial tier offers all three channels and still recommends hyperframes', () => {
  const { options, recommendedOptionId } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'partial',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage'],
    chosenAssetId: 'asset_usage',
    fillStatus: 'partial_asset_support'
  });
  assert.equal(recommendedOptionId, 'hyperframes'); // §6.4: edit the real asset, don't auto-replace it
  assert.deepEqual(options.map((o) => o.id).sort(), ['aigc', 'hyperframes', 'reshoot']);
});

test('partial opening prompt is asset-evidence-first and recommends HyperFrames instead of AIGC', () => {
  const { options, recommendedOptionId } = buildGapResolutionOptions({
    slot: makeSlot('opening_attention'),
    tier: 'partial',
    missingBrief: makeBrief(),
    coverage: makeCoverage('opening_attention'),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['plain_001_table_product_pan'],
    chosenAssetId: 'plain_001_table_product_pan',
    fillStatus: 'partial_asset_support'
  });

  assert.equal(recommendedOptionId, 'hyperframes');
  const hyper = options.find((option) => option.id === 'hyperframes')!;
  assert.ok(hyper.id === 'hyperframes');
  assert.match(hyper.editingGuidanceNL, /复用素材 plain_001_table_product_pan/);
  assert.match(hyper.editingGuidanceNL, /冷凝水|冰块|柠檬|液滴|冷雾/);
  assert.match(hyper.editingGuidanceNL, /裁切|推近/);
  assert.match(hyper.editingGuidanceNL, /运动轨迹/);
  assert.match(hyper.editingGuidanceNL, /定格/);
  assert.match(hyper.editingGuidanceNL, /文字安全区|图层/);

  const aigc = options.find((option) => option.id === 'aigc')!;
  assert.ok(aigc.id === 'aigc');
  assert.match(aigc.prompt, /可选替代|可作为替代/);
  assert.doesNotMatch(aigc.prompt, /recommended|推荐/i);
});

test('matched/covered tier offers all three channels as alternatives and recommends hyperframes', () => {
  const { options, recommendedOptionId } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'matched',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage'],
    chosenAssetId: 'asset_usage',
    fillStatus: 'matched'
  });
  assert.deepEqual(options.map((o) => o.id).sort(), ['aigc', 'hyperframes', 'reshoot']);
  // covered → the channels are alternatives; HyperFrames (edit the placed asset) is the safe default.
  assert.equal(recommendedOptionId, 'hyperframes');
});

test('matched prompts are optional alternatives and do not claim the material is insufficient', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot('product_closeup'),
    tier: 'matched',
    coverage: { ...makeCoverage('product_closeup'), coverageStatus: 'covered' },
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['plain_001_table_product_pan'],
    chosenAssetId: 'plain_001_table_product_pan',
    fillStatus: 'matched'
  });
  const visibleText = options.map((option) => {
    if (option.id === 'reshoot') return option.guidanceNL;
    if (option.id === 'hyperframes') return option.editingGuidanceNL;
    return option.prompt;
  }).join('\n');

  assert.match(visibleText, /可选|替代|增强/);
  assert.doesNotMatch(visibleText, /当前素材不足|素材不足/);
});

test('gap tier recommends aigc, but falls back to hyperframes when aigc is not eligible', () => {
  const eligible = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(true),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  assert.equal(eligible.recommendedOptionId, 'aigc');

  const ineligible = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(false),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  assert.equal(ineligible.recommendedOptionId, 'hyperframes');
});

test('true missing generation does not claim reusable real media unless it is only a visual reference', () => {
  const { options, recommendedOptionId } = buildGapResolutionOptions({
    slot: makeSlot('opening_attention'),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['plain_001_table_product_pan'],
    fillStatus: 'missing_generation_required'
  });
  assert.equal(recommendedOptionId, 'aigc');
  const hyper = options.find((option) => option.id === 'hyperframes')!;
  assert.ok(hyper.id === 'hyperframes');
  assert.doesNotMatch(hyper.editingGuidanceNL, /复用现有素材|复用素材/);
  assert.match(hyper.editingGuidanceNL, /视觉参考|参考/);
});

test('reshoot option is Chinese and carries framing + mustCapture in its guidance', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  const reshoot = options.find((o) => o.id === 'reshoot')!;
  assert.ok(reshoot.id === 'reshoot');
  assert.ok(reshoot.framing.length > 0);
  assert.ok(reshoot.mustCapture.length >= 1);
  // usage role -> Chinese must-capture, surfaced in the guidance
  assert.match(reshoot.guidanceNL, /补拍/);
  assert.match(reshoot.guidanceNL, /务必拍到/);
  assert.match(reshoot.guidanceNL, /开盖/);
});

test('hyperframes option is Chinese and references card type + assets', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'partial',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  const hyper = options.find((o) => o.id === 'hyperframes')!;
  assert.ok(hyper.id === 'hyperframes');
  assert.equal(hyper.cardType, 'usage_placeholder_card');
  assert.deepEqual(hyper.referencedAssetIds, ['asset_usage']);
  assert.ok(hyper.editingGuidanceNL.length > 0);
  // Visible prompt should stay creative and executable.
  assert.match(hyper.editingGuidanceNL, /包装与标签清晰可见/);
  assert.doesNotMatch(hyper.editingGuidanceNL, USER_VISIBLE_META_GUARDRAIL_RE);
});

test('aigc option prompt is Chinese and stays a leak-safe job card', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  const aigc = options.find((o) => o.id === 'aigc')!;
  assert.ok(aigc.id === 'aigc');
  assert.match(aigc.prompt, /竖屏 9:16/);
  assert.match(aigc.prompt, /康师傅冰红茶/);
  assert.doesNotMatch(aigc.prompt, USER_VISIBLE_META_GUARDRAIL_RE);
  assert.equal(aigc.ownership, 'external_generation_job_card_only');
});

test('user-facing resolution prompts do not expose brand-safety or compliance wording', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot('cta_visual'),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  const visibleText = options.map((option) => {
    if (option.id === 'reshoot') return option.guidanceNL;
    if (option.id === 'hyperframes') return option.editingGuidanceNL;
    return option.prompt;
  }).join('\n');

  assert.match(visibleText, /康师傅冰红茶/);
  assert.doesNotMatch(visibleText, USER_VISIBLE_META_GUARDRAIL_RE);
});

test('resolution prompts translate internal diagnostics into human-readable gaps', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot('benefit_visual'),
    tier: 'partial',
    coverage: makeCoverage('benefit_visual'),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['plain_001_table_product_pan'],
    chosenAssetId: 'plain_001_table_product_pan',
    fillStatus: 'partial_asset_support'
  });
  const visibleText = options.map((option) => {
    if (option.id === 'reshoot') return option.guidanceNL;
    if (option.id === 'hyperframes') return option.editingGuidanceNL;
    return option.prompt;
  }).join('\n');

  assert.match(visibleText, /只取|截取|最强片段|图层|局部镜头|底板/);
  assert.doesNotMatch(visibleText, USER_VISIBLE_META_GUARDRAIL_RE);
});

test('core roles produce concrete shot language instead of slot-template reports', () => {
  const cases: Array<[ShotSlotNode['role'], RegExp]> = [
    ['opening_attention', /冷凝水|冰块|柠檬|液滴|冷雾/],
    ['product_closeup', /标签|瓶身|冷凝水|瓶盖/],
    ['benefit_visual', /冰块|柠檬|茶色|卖点|场景/],
    ['usage_demo', /开盖|倒入|喝|手部|饮用/],
    ['social_proof' as ShotSlotNode['role'], /分享|多人|聚餐|同框|场景/],
    ['cta_visual', /尾帧|CTA|留白|定格|收口/]
  ];

  for (const [role, expected] of cases) {
    const { options } = buildGapResolutionOptions({
      slot: makeSlot(role),
      tier: 'partial',
      coverage: makeCoverage(role),
      contentBrief: makeContentBrief(),
      referenceAssetIds: ['plain_001_table_product_pan'],
      chosenAssetId: 'plain_001_table_product_pan',
      fillStatus: 'partial_asset_support'
    });
    const visibleText = options.map((option) => {
      if (option.id === 'reshoot') return option.guidanceNL;
      if (option.id === 'hyperframes') return option.editingGuidanceNL;
      return option.prompt;
    }).join('\n');

    assert.match(visibleText, expected, `${role} should contain concrete category-native shot language`);
    assert.doesNotMatch(visibleText, /maxRecommendedDurationSec|needsOverlaySupport|notEnoughForStandaloneShot|当前素材不足：|ranking=|roleAffordance|intent\/criteria/);
  }
});

test('aigc prompt carries a per-slot Chinese abstract-transfer line from the motion grammar', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage'],
    motionTokens: ['chaos_to_order', 'snap_open']
  });
  const aigc = options.find((o) => o.id === 'aigc')!;
  if (aigc.id === 'aigc') {
    assert.match(aigc.prompt, /保留源片可迁移的动作语法/);
    assert.match(aigc.prompt, /由乱到序/); // chaos_to_order -> Chinese
    assert.match(aigc.prompt, /利落开启/); // snap_open -> Chinese
    assert.ok(!/chaos_to_order|snap_open/.test(aigc.prompt), 'raw tokens must be translated, not leaked');
  }
});

test('收敛: options reference only the single chosen asset, not a pool', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'partial',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage', 'asset_other_1', 'asset_other_2'],
    chosenAssetId: 'asset_usage',
    fillStatus: 'partial_asset_support'
  });
  const hyper = options.find((o) => o.id === 'hyperframes')!;
  if (hyper.id === 'hyperframes') assert.deepEqual(hyper.referencedAssetIds, ['asset_usage']);
  const aigc = options.find((o) => o.id === 'aigc')!;
  if (aigc.id === 'aigc') assert.deepEqual(aigc.referenceAssetIds, ['asset_usage']);
});

test('aigc option is job-card only', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage']
  });
  const aigc = options.find((o) => o.id === 'aigc')!;
  assert.ok(aigc.id === 'aigc');
  assert.equal(aigc.ownership, 'external_generation_job_card_only');
});

test('synthesizes all three options from the role template when no brief exists', () => {
  const { options, recommendedOptionId } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'partial',
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage'],
    chosenAssetId: 'asset_usage',
    fillStatus: 'needs_hyperframes_enhancement'
  });
  assert.deepEqual(options.map((o) => o.id).sort(), ['aigc', 'hyperframes', 'reshoot']);
  assert.equal(recommendedOptionId, 'hyperframes');
});

test('kinetic assembly brief produces beverage-native reshoot, hyperframes and AIGC prompts', () => {
  const slot: ShotSlotNode = {
    ...makeSlot('usage_demo'),
    id: 'slot_block_004_asset_001',
    requiredAsset: { type: 'video', subject: 'surreal kinetic assembly reveal' },
    intent: {
      purpose: 'dynamic assembly and CTA reveal',
      energyLevel: 'high',
      motionPattern: 'component cascade, chaos to order, assembly completion, interaction activation, spectacle burst, cta reveal',
      compositionPrincipal: 'kinetic assembly reveal',
      durationMs: [1200, 3200]
    }
  };
  const brief = makeBrief();
  brief.id = 'brief_kinetic_004';
  brief.affectedSlotId = slot.id;
  brief.motifContext = {
    motifAnnotationId: 'motif_kinetic_004',
    motifType: 'kinetic_assembly_reveal',
    motionTokens: [
      'component_cascade',
      'chaos_to_order',
      'assembly_completion',
      'interaction_activation',
      'spectacle_burst',
      'cta_reveal'
    ],
    missingMotionTokens: ['component_cascade', 'chaos_to_order', 'spectacle_burst', 'cta_reveal'],
    sanitizedIntent: 'dynamic assembly, interaction activation, spectacle burst and CTA reveal',
    targetMotifHints: ['ice cubes', 'lemon slices', 'tea droplets', 'cold mist', 'CTA lock-up'],
    confidence: 0.92,
    evidence: ['test motif context']
  };

  const { options } = buildGapResolutionOptions({
    slot,
    tier: 'partial',
    missingBrief: brief,
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['plain_002_hand_pickup'],
    chosenAssetId: 'plain_002_hand_pickup',
    motionTokens: [
      'component_cascade',
      'chaos_to_order',
      'assembly_completion',
      'interaction_activation',
      'spectacle_burst',
      'cta_reveal'
    ]
  });

  const allPositiveText = options
    .flatMap((option) => {
      if (option.id === 'reshoot') return [option.guidanceNL, option.framing, ...option.mustCapture];
      if (option.id === 'hyperframes') return [option.editingGuidanceNL, option.copy?.headline, option.copy?.subline, option.copy?.cta];
      return [option.prompt];
    })
    .filter(Boolean)
    .join('\n');

  assert.match(allPositiveText, /级联|汇聚|由散到聚|由乱到序/);
  assert.match(allPositiveText, /激活/);
  assert.match(allPositiveText, /冷雾|茶滴|水汽|茶花|爆发/);
  assert.match(allPositiveText, /CTA|收口|锁定/);
  assert.match(allPositiveText, /冰块|柠檬|红茶/);
  assert.doesNotMatch(allPositiveText, /MacBook|keyboard|laptop|touchpad|rocket|hardware|键盘|笔记本|触控板|火箭|硬件/);
});

test('source-specific slots are abstracted into distinct beverage equivalents instead of one repeated template', () => {
  const scenarios: Array<{
    name: string;
    slot: ShotSlotNode;
    expected: RegExp;
    forbidden?: RegExp;
  }> = [
    {
      name: 'opening transform',
      slot: {
        ...makeSlot('opening_attention'),
        id: 'slot_opening_transform',
        requiredAsset: { type: 'video', subject: 'MacBook product color transform and screen opening' },
        intent: {
          purpose: '双手从纯白空白画面中拿出银色苹果笔记本，悬浮过程中色彩渐变，放置桌面后打开屏幕',
          energyLevel: 'high',
          motionPattern: 'symmetric hand presenting, object transform, screen opening',
          compositionPrincipal: 'hero reveal',
          durationMs: [0, 3000]
        }
      },
      expected: /热浪|冰爽入场|英雄亮相|夏日场景/,
      forbidden: /侧边接口|多窗口|跨设备/
    },
    {
      name: 'interface reveal',
      slot: {
        ...makeSlot('product_closeup'),
        id: 'slot_interface_reveal',
        requiredAsset: { type: 'video', subject: 'side port hardware interface camera module reveal' },
        intent: {
          purpose: '镜头移动展示笔记本侧边接口，圆形镜片飞入变成摄像头，放大展示摄像头镜片细节',
          energyLevel: 'medium',
          motionPattern: 'sequential interface reveal then object assembly',
          compositionPrincipal: 'detail reveal',
          durationMs: [3000, 6000]
        }
      },
      expected: /标签扫光|冷凝水擦除|瓶身微距|瓶盖特写/,
      forbidden: /多窗口|手递|热浪破开/
    },
    {
      name: 'ui sequence',
      slot: {
        ...makeSlot('usage_demo'),
        id: 'slot_ui_sequence',
        requiredAsset: { type: 'video', subject: 'keyboard touchpad multi window app UI switching' },
        intent: {
          purpose: '双手操作触控板和键盘，依次切换展示多个应用界面，涵盖网页浏览、视频剪辑、AI 训练计划',
          energyLevel: 'medium',
          motionPattern: 'sequential ui switch with hand interaction',
          compositionPrincipal: 'multi-window feature demo',
          durationMs: [6000, 9000]
        }
      },
      expected: /卖点卡|场景卡|卡片连跳|信息卡/,
      forbidden: /侧边接口|摄像头|多瓶阵列/
    },
    {
      name: 'device handoff',
      slot: {
        ...makeSlot('usage_demo'),
        id: 'slot_device_handoff',
        requiredAsset: { type: 'video', subject: 'iPhone cross-device handoff to laptop screen' },
        intent: {
          purpose: '手持 iPhone 操作聊天界面，将手机放到笔记本旁边隔空投送图片，笔记本接力显示地图导航界面',
          energyLevel: 'medium',
          motionPattern: 'seamless cross device transition',
          compositionPrincipal: 'handoff interaction',
          durationMs: [9000, 12000]
        }
      },
      expected: /手递|场景切换|分享|通勤|社交/,
      forbidden: /侧边接口|摄像头|多窗口/
    },
    {
      name: 'cta lockup',
      slot: {
        ...makeSlot('cta_visual'),
        id: 'slot_cta_lockup',
        requiredAsset: { type: 'image', subject: 'MacBook Neo From $599 logo lockup end frame' },
        intent: {
          purpose: '依次展示产品全配色，弹出产品名与售价信息，最后通过拼接动画呈现品牌标识完成收尾',
          energyLevel: 'low',
          motionPattern: 'static centered reveal with sequential assembly',
          compositionPrincipal: 'cta lockup',
          durationMs: [12000, 14000]
        }
      },
      expected: /多瓶阵列|CTA 尾帧|购买引导|干净收口/,
      forbidden: /侧边接口|多窗口|热浪破开/
    }
  ];

  const normalizedPrompts = new Set<string>();
  for (const scenario of scenarios) {
    const { options } = buildGapResolutionOptions({
      slot: scenario.slot,
      tier: 'partial',
      contentBrief: makeContentBrief(),
      referenceAssetIds: ['plain_002_hand_pickup'],
      chosenAssetId: 'plain_002_hand_pickup'
    });
    const positiveText = options
      .flatMap((option) => {
        if (option.id === 'reshoot') return [option.guidanceNL, option.framing, ...option.mustCapture];
        if (option.id === 'hyperframes') return [option.editingGuidanceNL, option.copy?.headline, option.copy?.subline, option.copy?.cta];
        return [option.prompt];
      })
      .filter(Boolean)
      .join('\n');
    assert.match(positiveText, scenario.expected, `${scenario.name} should have a distinct beverage mapping`);
    if (scenario.forbidden) {
      assert.doesNotMatch(positiveText, scenario.forbidden, `${scenario.name} should not reuse another subtype mapping`);
    }
    assert.doesNotMatch(positiveText, /MacBook|keyboard|laptop|touchpad|rocket|hardware|键盘|笔记本|触控板|火箭|硬件/);
    normalizedPrompts.add(positiveText.replace(/\d+(?:\.\d+)? 秒/g, 'N 秒').slice(0, 240));
  }

  assert.equal(normalizedPrompts.size, scenarios.length, 'each subtype should produce a distinct prompt body');
});
