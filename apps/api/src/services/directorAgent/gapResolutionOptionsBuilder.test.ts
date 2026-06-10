import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ContentBrief, MissingMaterialBrief, ShotSlotNode } from '@viral-struct/shared';
import { buildGapResolutionOptions } from './gapResolutionOptionsBuilder';
import { makeContentBrief } from './testFixtures';
import { EARPHONE_VOCAB_FIXTURE } from './vocabularyFixture';

/** Non-beverage content brief for no-leak assertions; selling points contain no beverage terms. */
function makeEarphoneContentBrief(): ContentBrief {
  return {
    productName: '无线蓝牙耳机',
    targetAudience: 'commuters and remote workers',
    scenario: 'daily commute and focus work',
    sellingPoints: ['主动降噪', '长续航', '轻量舒适'],
    cta: '立即选购',
    category: 'electronics'
  };
}

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

test('gap tier can offer three options: reshoot / hyperframes / aigc', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage'],
    vocab: EARPHONE_VOCAB_FIXTURE
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
    fillStatus: 'partial_asset_support',
    vocab: EARPHONE_VOCAB_FIXTURE
  });
  assert.equal(recommendedOptionId, 'hyperframes'); // §6.4: edit the real asset, don't auto-replace it
  assert.deepEqual(options.map((o) => o.id).sort(), ['aigc', 'hyperframes', 'reshoot']);
});

test('matched/covered tier offers all three channels as alternatives and recommends hyperframes', () => {
  const { options, recommendedOptionId } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'matched',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage'],
    chosenAssetId: 'asset_usage',
    fillStatus: 'matched',
    vocab: EARPHONE_VOCAB_FIXTURE
  });
  assert.deepEqual(options.map((o) => o.id).sort(), ['aigc', 'hyperframes', 'reshoot']);
  // covered → the channels are alternatives; HyperFrames (edit the placed asset) is the safe default.
  assert.equal(recommendedOptionId, 'hyperframes');
});

test('gap tier recommends aigc, but falls back to hyperframes when aigc is not eligible', () => {
  const eligible = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(true),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage'],
    vocab: EARPHONE_VOCAB_FIXTURE
  });
  assert.equal(eligible.recommendedOptionId, 'aigc');

  const ineligible = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(false),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage'],
    vocab: EARPHONE_VOCAB_FIXTURE
  });
  assert.equal(ineligible.recommendedOptionId, 'hyperframes');
});

test('reshoot option is Chinese and carries framing + mustCapture in its guidance', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage'],
    vocab: EARPHONE_VOCAB_FIXTURE
  });
  const reshoot = options.find((o) => o.id === 'reshoot')!;
  assert.ok(reshoot.id === 'reshoot');
  assert.ok(reshoot.framing.length > 0);
  assert.ok(reshoot.mustCapture.length >= 1);
  // usage role -> Chinese must-capture from injected vocab, surfaced in the guidance
  assert.match(reshoot.guidanceNL, /补拍/);
  assert.match(reshoot.guidanceNL, /务必拍到/);
  // vocab-driven mustCapture item appears in guidanceNL (earphone fixture: 耳机外形完整)
  assert.match(reshoot.guidanceNL, /耳机/);
});

test('no beverage strings leak into a non-beverage product when earphone vocab is injected', () => {
  // Use an earphone-native content brief (no beverage selling points) to ensure the no-leak
  // assertion is only testing the vocab/template layer, not the content brief's own selling points.
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeEarphoneContentBrief(),
    referenceAssetIds: ['asset_usage'],
    vocab: EARPHONE_VOCAB_FIXTURE
  });
  const blob = JSON.stringify(options);
  assert.doesNotMatch(blob, /冰块|柠檬|瓶身|红茶|倒茶|喝一口/, 'no beverage leaks into a non-beverage product');
});

test('hyperframes option is Chinese and references card type + assets', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'partial',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage'],
    vocab: EARPHONE_VOCAB_FIXTURE
  });
  const hyper = options.find((o) => o.id === 'hyperframes')!;
  assert.ok(hyper.id === 'hyperframes');
  assert.equal(hyper.cardType, 'usage_placeholder_card');
  assert.deepEqual(hyper.referencedAssetIds, ['asset_usage']);
  assert.ok(hyper.editingGuidanceNL.length > 0);
  // Chinese guardrail clause must be present
  assert.match(hyper.editingGuidanceNL, /包装与标签清晰可见/);
  assert.match(hyper.editingGuidanceNL, /不得加入未授权品牌/);
});

test('aigc option prompt is Chinese and stays a leak-safe job card', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    missingBrief: makeBrief(),
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage'],
    vocab: EARPHONE_VOCAB_FIXTURE
  });
  const aigc = options.find((o) => o.id === 'aigc')!;
  assert.ok(aigc.id === 'aigc');
  assert.match(aigc.prompt, /仅为生成提示词/);
  assert.match(aigc.prompt, /康师傅冰红茶/);
  assert.equal(aigc.ownership, 'external_generation_job_card_only');
});

test('aigc prompt carries a per-slot Chinese abstract-transfer line from the motion grammar', () => {
  const { options } = buildGapResolutionOptions({
    slot: makeSlot(),
    tier: 'gap',
    contentBrief: makeContentBrief(),
    referenceAssetIds: ['asset_usage'],
    motionTokens: ['chaos_to_order', 'component_cascade'],
    vocab: EARPHONE_VOCAB_FIXTURE
  });
  const aigc = options.find((o) => o.id === 'aigc')!;
  if (aigc.id === 'aigc') {
    assert.match(aigc.prompt, /保留源片可迁移的动作语法/);
    assert.match(aigc.prompt, /由散到聚/); // chaos_to_order -> earphone vocab translation
    assert.match(aigc.prompt, /单元零件归位/); // component_cascade -> earphone vocab translation
    assert.ok(!/chaos_to_order|component_cascade/.test(aigc.prompt), 'raw tokens must be translated, not leaked');
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
    fillStatus: 'partial_asset_support',
    vocab: EARPHONE_VOCAB_FIXTURE
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
    referenceAssetIds: ['asset_usage'],
    vocab: EARPHONE_VOCAB_FIXTURE
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
    fillStatus: 'needs_hyperframes_enhancement',
    vocab: EARPHONE_VOCAB_FIXTURE
  });
  assert.deepEqual(options.map((o) => o.id).sort(), ['aigc', 'hyperframes', 'reshoot']);
  assert.equal(recommendedOptionId, 'hyperframes');
});

test('kinetic assembly brief produces vocab-native reshoot, hyperframes and AIGC prompts', () => {
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
    ],
    vocab: EARPHONE_VOCAB_FIXTURE
  });

  const allPositiveText = options
    .flatMap((option) => {
      if (option.id === 'reshoot') return [option.guidanceNL, option.framing, ...option.mustCapture];
      if (option.id === 'hyperframes') return [option.editingGuidanceNL, option.copy?.headline, option.copy?.subline, option.copy?.cta];
      return [option.prompt];
    })
    .filter(Boolean)
    .join('\n');

  // Structural kinetic grammar terms (product-neutral)
  assert.match(allPositiveText, /级联|汇聚|由散到聚/);
  assert.match(allPositiveText, /激活/);
  assert.match(allPositiveText, /CTA|收口|锁定/);
  // Earphone-native kinetic actions from vocab fixture
  assert.match(allPositiveText, /单元汇聚揭示|单元入仓|降噪激活|零件由散到聚/);
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
      chosenAssetId: 'plain_002_hand_pickup',
      vocab: EARPHONE_VOCAB_FIXTURE
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
