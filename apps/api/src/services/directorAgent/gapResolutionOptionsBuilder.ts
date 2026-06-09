import type {
  AigcOption,
  AssetSupplyContext,
  ContentBrief,
  ContextualSlotCoverage,
  DirectorFillStatus,
  GapResolutionOption,
  GapResolutionOptionId,
  HyperframesOption,
  MissingMaterialBrief,
  ReshootOption,
  ShotSlotNode,
  SourceSpecificTransferSubtype,
  ViralMotifAnnotation
} from '@viral-struct/shared';
import { DEFAULT_ASPECT_RATIO, SAFE_NEGATIVE_PROMPT_ZH } from './constants';
import { containsSourceSpecificTerm } from '../motifs/motionGrammarSanitizer';
import { inferSourceSpecificTransferSubtype } from './sourceSpecificAbstraction';

/**
 * P2 (§6) — partial/gap slots get honest resolution options: reshoot + HyperFrames by default, and AIGC
 * only for true missing/generation slots. Existing asset support should not be presented as "needs AIGC".
 *
 * Output language: **Chinese**. The Asset Manager's per-slot MissingMaterialBrief is English, and §12
 * forbids rewriting ②, so the Director authors the human-readable prose (guidanceNL / editingGuidanceNL /
 * prompt / mustCapture / avoid) itself in Chinese from a role template + the content brief, while still
 * reusing ②'s **structured** signals where they are language-neutral: referenced asset ids, durations,
 * providerHint, card type and channel eligibility. When no brief exists (the rare gate-blocked-but-covered
 * slot) the role template alone produces the three options.
 *
 * Recommendation follows the degradation ladder (§6.4, 方案二): partial → `hyperframes` (edit the usable
 * asset — cheapest + IP-safe); gap → `aigc` only when it is eligible, otherwise `hyperframes`. `reshoot`
 * is always offered, never auto.
 */
export interface BuildGapResolutionOptionsArgs {
  slot: ShotSlotNode;
  tier: 'partial' | 'gap';
  coverage?: ContextualSlotCoverage;
  missingBrief?: MissingMaterialBrief;
  assetSupplyContext?: AssetSupplyContext;
  contentBrief: ContentBrief;
  referenceAssetIds: string[];
  /** The single asset chosen for this slot (the partial/gap match). Options reference only this asset. */
  chosenAssetId?: string;
  /** The slot's detected motion-grammar tokens — drive the per-slot abstract-transfer line in the aigc prompt. */
  motionTokens?: string[];
  fillStatus?: DirectorFillStatus;
  motif?: ViralMotifAnnotation;
}

export interface GapResolutionOptionsResult {
  options: GapResolutionOption[];
  recommendedOptionId: GapResolutionOptionId;
}

export function buildGapResolutionOptions(args: BuildGapResolutionOptionsArgs): GapResolutionOptionsResult {
  const brief =
    args.missingBrief
    ?? args.assetSupplyContext?.missingMaterialBriefs?.find((entry) => entry.affectedSlotId === args.slot.id);

  const spec = buildDirectorSpec(args, brief);
  const product = args.contentBrief.productName;

  const reshoot = buildReshootOption(spec, product, brief);
  const hyperframes = buildHyperframesOption(args, spec, product, brief);
  const aigc = buildAigcOption(args, spec, product, brief);
  const options: GapResolutionOption[] = [reshoot, hyperframes];
  if (shouldOfferAigc(args, brief, aigc)) {
    options.push(aigc);
  }

  return {
    options,
    recommendedOptionId: recommend(args, brief, aigc, options)
  };
}

// --- recommendation ---------------------------------------------------------

function recommend(
  args: BuildGapResolutionOptionsArgs,
  brief: MissingMaterialBrief | undefined,
  aigc: AigcOption,
  options: GapResolutionOption[]
): GapResolutionOptionId {
  if (args.tier === 'partial') {
    return 'hyperframes';
  }
  return options.some((option) => option.id === 'aigc') && isAigcEligible(brief, aigc) ? 'aigc' : 'hyperframes';
}

function shouldOfferAigc(
  args: BuildGapResolutionOptionsArgs,
  brief: MissingMaterialBrief | undefined,
  aigc: AigcOption
): boolean {
  if (args.tier !== 'gap') {
    return false;
  }
  return isAigcEligible(brief, aigc);
}

function isAigcEligible(brief: MissingMaterialBrief | undefined, aigc: AigcOption): boolean {
  const channel = brief?.channelEligibility?.find((entry) => entry.channel === 'aigc_video_prompt');
  if (channel) {
    return channel.eligible;
  }
  return aigc.referenceAssetIds.length > 0;
}

// --- reshoot (Chinese) ------------------------------------------------------

function buildReshootOption(spec: ZhRoleSpec, product: string, brief?: MissingMaterialBrief): ReshootOption {
  const durationSec = positive(brief?.manualShootBrief?.durationSec ?? spec.durationSec, spec.durationSec);
  const mustCapture = spec.mustCapture;
  const avoid = AVOID_ZH;
  const guidanceNL =
    `补拍一个约 ${durationSec} 秒的竖屏「${spec.label}」镜头：${spec.reshootShot}。`
    + `务必拍到：${mustCapture.join('、')}。`
    + `注意避免：${avoid.slice(0, 4).join('、')}。`
    + `保持 ${product} 的包装与标签清晰可见、背景干净。`;
  return {
    id: 'reshoot',
    title: `补拍「${spec.label}」素材`,
    guidanceNL,
    framing: spec.framing,
    durationSec,
    mustCapture,
    avoid
  };
}

// --- hyperframes (Chinese editing guidance) ---------------------------------

function buildHyperframesOption(
  args: BuildGapResolutionOptionsArgs,
  spec: ZhRoleSpec,
  product: string,
  brief?: MissingMaterialBrief
): HyperframesOption {
  // 收敛 (Q2): reference only the single asset chosen for this slot.
  const referencedAssetIds = singleReference(args);
  const cardType = brief?.hyperframesBrief?.cardType ?? spec.cardType;
  const durationMs = positive(Math.round((brief?.hyperframesBrief?.durationSec ?? 3) * 1000), 3000);
  const refLine = referencedAssetIds.length ? `复用现有素材：${referencedAssetIds.join('、')}。` : '';

  const motifLine = spec.motifLine ? `${spec.motifLine}。` : '';
  const editingGuidanceNL =
    `以 ${product} 为画面主体，${spec.hyperframesIntent}。`
    + motifLine
    + `用${spec.animationHints.join('、')}等动效承接「${spec.label}」。`
    + refLine
    + `保持 ${product} 原始包装与标签清晰可见，不得加入未授权品牌、价格承诺或健康功效宣称。`;

  const copy = buildCopy(args);

  return {
    id: 'hyperframes',
    title: `「${spec.label}」卡片`,
    editingGuidanceNL,
    cardType,
    ...(copy ? { copy } : {}),
    referencedAssetIds,
    durationMs
  };
}

function buildCopy(args: BuildGapResolutionOptionsArgs): HyperframesOption['copy'] | undefined {
  const headline = args.contentBrief.sellingPoints[0];
  const cta = isCtaRole(args.slot.role) ? args.contentBrief.cta : undefined;
  const copy: NonNullable<HyperframesOption['copy']> = {};
  if (headline) copy.headline = headline;
  if (cta) copy.cta = cta;
  return Object.keys(copy).length > 0 ? copy : undefined;
}

// --- aigc (Chinese prompt; job-card only) -----------------------------------

function buildAigcOption(
  args: BuildGapResolutionOptionsArgs,
  spec: ZhRoleSpec,
  product: string,
  brief?: MissingMaterialBrief
): AigcOption {
  const referenceAssetIds = singleReference(args);
  const providerHint = brief?.aigcGenerationBrief?.providerHint ?? inferProvider(args.slot.role);
  const expectedDurationSec = positive(brief?.aigcGenerationBrief?.expectedDurationSec ?? spec.durationSec, spec.durationSec);

  // Per-slot abstract transfer (Q3): the source motion grammar (motifTokens) is what makes each slot's
  // prompt distinct and carries the "keep the grammar, swap the objects" intent — rendered in Chinese,
  // so no two slots with different grammar get the same prompt, and no source object leaks.
  const grammar = (args.motionTokens ?? []).map((token) => MOTION_TOKEN_ZH[token] ?? token).filter(Boolean);
  const transferLine = grammar.length
    ? `保留源片可迁移的动作语法（${grammar.join('、')}），用目标品类的等效动作重新演绎，不照搬源产品或源场景。`
    : '';

  const sellingPoints = args.contentBrief.sellingPoints ?? [];
  const sellingLine = sellingPoints.length ? `卖点仅限：${sellingPoints.join('、')}。` : '';

  const prompt =
    '仅为生成提示词，非成片。'
    + `为 ${product} 生成一个竖屏 9:16、普通手机拍摄风格的「${spec.label}」镜头：${spec.aigcScene}。`
    + (spec.motifLine ? `${spec.motifLine}。` : '')
    + transferLine
    + sellingLine
    + '不得编造价格、促销、医疗功效、明星代言或其它品牌。';

  return {
    id: 'aigc',
    prompt,
    negativePrompt: SAFE_NEGATIVE_PROMPT_ZH,
    referenceAssetIds,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    expectedDurationSec,
    providerHint,
    ownership: 'external_generation_job_card_only'
  };
}

function inferProvider(role: string): AigcOption['providerHint'] {
  return role === 'usage_demo' || role === 'opening_attention' ? 'seedance' : 'generic';
}

// --- Chinese role templates -------------------------------------------------

interface ZhRoleSpec {
  label: string;
  reshootShot: string;
  mustCapture: string[];
  framing: string;
  durationSec: number;
  hyperframesIntent: string;
  animationHints: string[];
  aigcScene: string;
  cardType: string;
  motifLine?: string;
}

const AVOID_ZH = [
  '其它可见品牌或标识',
  '明星或公众人物肖像',
  '未经证实的价格或促销承诺',
  '医疗或功效保证类宣称',
  '直接照搬源视频的画面构图'
];

/** Source motion-grammar tokens → Chinese. These ARE the abstract transfer: keep the grammar, swap objects. */
const MOTION_TOKEN_ZH: Record<string, string> = {
  dynamic_entry: '动感入场',
  component_cascade: '部件级联汇聚',
  chaos_to_order: '由乱到序',
  assembly_completion: '组装完成',
  interaction_activation: '交互激活',
  spectacle_burst: '奇观爆发',
  cta_reveal: 'CTA 揭示',
  falling_object: '物体坠落',
  impact_beat: '冲击节拍',
  snap_open: '利落开启',
  assembly_reveal: '组装揭示',
  activation_moment: '激活时刻',
  pour_flow: '倾倒流动',
  drink_action: '饮用动作',
  bottle_rotation: '瓶身旋转',
  lineup_sweep: '阵列扫过',
  card_drop: '卡片落下',
  clean_hold: '干净定格',
  quick_cut: '快速切换',
  push_in: '镜头推近',
  match_cut: '匹配剪辑',
  morph: '形变过渡'
};

const ZH_ROLE_SPECS: Record<string, ZhRoleSpec> = {
  opening: {
    label: '开场吸睛',
    reshootShot: '快速拿起或亮出产品，营造夏日清爽的强开场',
    mustCapture: ['产品快速入画', '标签或外形清晰', '有活力的动作'],
    framing: '竖屏中近景，产品居中，上下留出文字安全区',
    durationSec: 3,
    hyperframesIntent: '用强开场动效抓住前 3 秒注意力',
    animationHints: ['快速推近', '冰感微光', '大标题揭示'],
    aigcScene: '高能量开场动作，产品清晰可见，带冰爽或夏日氛围',
    cardType: 'hook_card'
  },
  product_closeup: {
    label: '产品特写',
    reshootShot: '拍摄产品瓶身、标签与包装细节，背景干净',
    mustCapture: ['标签清晰可读', '产品外形完整', '画面稳定对焦'],
    framing: '竖屏特写，标签可读，产品占画面 60%-80%',
    durationSec: 2.5,
    hyperframesIntent: '在卖点之前让产品形象清晰可辨',
    animationHints: ['缓慢推近', '标签高光', '光线扫过'],
    aigcScene: '干净的竖屏产品特写，保持包装原样且清晰',
    cardType: 'timeline_bridge_card'
  },
  usage: {
    label: '使用演示',
    reshootShot: '真实的使用动作：开盖、喝一口或倒入杯中，尽量只露手或颈部以下',
    mustCapture: ['开盖动作', '喝或倒等清晰使用动作', '产品可见'],
    framing: '竖屏只露手/颈部以下，产品与动作均可见',
    durationSec: 4,
    hyperframesIntent: '用步骤卡承接缺失的真实使用动作',
    animationHints: ['步骤 1/2/3 卡片', '小幅产品图', '简单箭头动效'],
    aigcScene: '普通用户风格的真实使用片段：只露手或颈部以下，开盖、喝或倒，真实自然',
    cardType: 'usage_placeholder_card'
  },
  comparison: {
    label: '对比/陈列',
    reshootShot: '拍摄并排陈列或前后对比关系，不做未经证实的优劣宣称',
    mustCapture: ['清晰的对比或陈列关系', '产品清晰可见'],
    framing: '竖屏中景或全景，左右关系清晰',
    durationSec: 3,
    hyperframesIntent: '用对比卡呈现差异',
    animationHints: ['分屏', '前后标签', '柔和滑动转场'],
    aigcScene: '竖屏对比或陈列镜头，呈现简单清爽的对比，不做未证实宣称',
    cardType: 'comparison_card'
  },
  benefit: {
    label: '卖点证明',
    reshootShot: '拍摄能支撑卖点的画面线索（如冰块、柠檬茶、分享场景）',
    mustCapture: ['产品可见', '卖点线索可见', '画面稳定可读'],
    framing: '竖屏中景产品场景，留足文字安全区',
    durationSec: 3,
    hyperframesIntent: '把卖点做成简洁的利益点卡',
    animationHints: ['利益点徽章', '小幅产品抠像', '轻微动效'],
    aigcScene: '竖屏卖点证明场景，视觉上支撑卖点，不新增任何宣称',
    cardType: 'benefit_card'
  },
  cta: {
    label: '结尾行动引导',
    reshootShot: '拍摄干净的结尾画面，为 CTA 文字留出空间',
    mustCapture: ['产品可见', '留有清晰的文案空白区', '结尾画面稳定'],
    framing: '竖屏产品镜头，留有干净负空间',
    durationSec: 2,
    hyperframesIntent: '收束到干净的 CTA 锁定卡',
    animationHints: ['CTA 揭示', '产品定格', '轻微弹动'],
    aigcScene: '干净的竖屏 CTA 底图，产品可见，留出文案空白区，不加文字',
    cardType: 'cta_card'
  },
  instruction: {
    label: '说明卡',
    reshootShot: '拍摄清晰的说明或步骤画面',
    mustCapture: ['信息清晰', '产品或要点可见'],
    framing: '竖屏，要点清晰可读',
    durationSec: 3,
    hyperframesIntent: '用说明卡承接讲解要点',
    animationHints: ['要点逐条出现', '简洁图示'],
    aigcScene: '竖屏说明或步骤画面，信息清晰',
    cardType: 'timeline_bridge_card'
  },
  generic: {
    label: '结构槽位',
    reshootShot: '拍摄一个满足该结构意图的竖屏镜头',
    mustCapture: ['产品可见', '该镜头动作可见'],
    framing: '竖屏，产品与动作均可见',
    durationSec: 3,
    hyperframesIntent: '用卡片承接缺失的画面证据',
    animationHints: ['简单揭示', '简短文案', '产品参考'],
    aigcScene: '竖屏支撑镜头，符合该结构意图',
    cardType: 'timeline_bridge_card'
  }
};

function zhRoleSpec(role: string): ZhRoleSpec {
  return ZH_ROLE_SPECS[normalizeRole(role)] ?? ZH_ROLE_SPECS.generic;
}

function buildDirectorSpec(args: BuildGapResolutionOptionsArgs, brief?: MissingMaterialBrief): ZhRoleSpec {
  const base = zhRoleSpec(args.slot.role);
  if (isKineticAssemblyContext(args, brief)) {
    return {
      ...base,
      label: '冰爽级联组装揭示',
      reshootShot:
        '让冰块、柠檬片和红茶水滴从画面四周级联汇聚到产品周围，再用开盖、倒茶或触碰瓶身完成激活，最后收束到干净 CTA 尾帧',
      mustCapture: [
        '冰块或柠檬片级联入画',
        '由散到聚的汇聚过程',
        '开盖/倒茶/触碰瓶身的激活动作',
        '冷雾、水汽或茶滴爆发',
        '干净 CTA 收口画面'
      ],
      framing: '竖屏产品居中，前半段留出级联运动空间，尾帧留出 CTA 文案安全区',
      durationSec: positive(brief?.manualShootBrief?.durationSec ?? 4, 4),
      hyperframesIntent: '把源片的“部件级联 -> 由散到聚 -> 激活爆发 -> CTA 揭示”抽象成饮料语境的结构动效',
      animationHints: ['冰块雨', '柠檬片扫过', '红茶水滴汇聚', '冷雾爆发', 'CTA 锁定'],
      aigcScene:
        '冰块、柠檬片、红茶水滴和冷雾围绕产品形成由散到聚的级联组装，开盖或倒茶触发冰爽爆发，最终进入产品 CTA 收口',
      cardType: brief?.hyperframesBrief?.cardType ?? 'timeline_bridge_card',
      motifLine: '迁移的是抽象运动语法：级联、汇聚、激活、爆发、CTA 收口；目标画面只使用冰块、柠檬、红茶水滴、冷雾和产品尾帧'
    };
  }

  if (!containsSourceSpecificTerm(buildSlotText(args.slot))) {
    return base;
  }

  return buildSourceSpecificSpec(base, inferSourceSpecificTransferSubtype(args.slot, args.motif));
}

function isKineticAssemblyContext(args: BuildGapResolutionOptionsArgs, brief?: MissingMaterialBrief): boolean {
  const motifType = args.motif?.motifType ?? brief?.motifContext?.motifType;
  return motifType === 'kinetic_assembly_reveal';
}

function buildSourceSpecificSpec(base: ZhRoleSpec, subtype: SourceSpecificTransferSubtype): ZhRoleSpec {
  switch (subtype) {
    case 'opening_transform':
      return {
        ...base,
        label: '冰爽英雄入场',
        reshootShot: '用热浪背景被冰块和瓶身入画破开，完成从夏日闷热到冰爽入场的英雄亮相',
        mustCapture: ['热浪或夏日场景铺垫', '产品快速入画形成冰爽入场', '标签清晰可见', '第一帧留出强 hook 标题区'],
        framing: '竖屏中近景，产品从侧前方或中央进入，顶部留标题安全区',
        durationSec: base.durationSec,
        hyperframesIntent: '把开场变形亮相抽象成“热到冷”的第一秒冲击',
        animationHints: ['热浪破开', '冰块擦屏', '产品英雄亮相', '大标题定格'],
        aigcScene: '夏日热浪被冰块和产品入画破开，产品完成冰爽英雄亮相，画面清爽明亮，标签清晰',
        cardType: 'hook_card',
        motifLine: '只迁移“强开场变换入场”的抽象节奏；目标等价物是热浪、冰块、夏日场景、产品英雄亮相和标题定格'
      };
    case 'interface_detail':
      return {
        ...base,
        label: '瓶身细节扫光',
        reshootShot: '用瓶盖特写、标签扫光、冷凝水擦除和瓶身微距替代源品类的接口/镜片细节展示',
        mustCapture: ['瓶盖特写', '标签扫光', '冷凝水擦除', '瓶身微距', '包装文字保持清晰'],
        framing: '竖屏微距到中近景，镜头沿瓶身或标签缓慢扫过',
        durationSec: base.durationSec,
        hyperframesIntent: '把细节巡礼抽象成饮料包装和冰爽质感的连续扫光',
        animationHints: ['标签扫光', '冷凝水擦除', '瓶盖高光', '茶色流动'],
        aigcScene: '瓶盖、标签、冷凝水和瓶身曲线的微距扫光，冰块和柠檬作为背景质感，包装保持真实清晰',
        cardType: base.cardType,
        motifLine: '只迁移“细节逐步揭示”的抽象结构；目标等价物是瓶盖、标签、冷凝水、瓶身微距和茶色流动'
      };
    case 'assembly_detail':
      return {
        ...base,
        label: '冰柠元素汇聚',
        reshootShot: '让冰块、柠檬片、茶滴和冷雾从不同方向汇聚到产品周围，形成由散到聚的卖点揭示',
        mustCapture: ['冰块进入画面', '柠檬片扫过', '红茶茶滴或茶色流动', '元素汇聚到产品周围', '产品标签保持清晰'],
        framing: '竖屏产品居中，四周留出元素汇聚空间',
        durationSec: base.durationSec,
        hyperframesIntent: '把部件归位抽象成冰爽元素汇聚到产品卖点',
        animationHints: ['冰块汇聚', '柠檬扫过', '茶滴环绕', '卖点卡落下'],
        aigcScene: '冰块、柠檬片、茶滴和冷雾由散到聚地汇聚到产品周围，形成冰爽卖点揭示，最后产品稳定定格',
        cardType: 'timeline_bridge_card',
        motifLine: '只迁移“由散到聚、卖点完成”的抽象结构；目标等价物是冰块、柠檬、茶滴、冷雾和产品卖点定格'
      };
    case 'ui_sequence':
      return {
        ...base,
        label: '卖点场景卡连跳',
        reshootShot: '围绕产品拍摄干净底图，再用卖点卡、场景卡和信息卡连跳展示不同饮用场景与利益点',
        mustCapture: ['产品稳定底图', '卖点卡出现空间', '场景卡或信息卡连跳节奏', '至少一个真实使用或冰爽证据'],
        framing: '竖屏产品偏中下，左右或上方留卡片运动空间',
        durationSec: base.durationSec,
        hyperframesIntent: '把多界面切换抽象成卖点卡和场景卡的连续信息节奏',
        animationHints: ['卖点卡连跳', '场景卡切换', '信息卡叠入', '快速卡点'],
        aigcScene: '产品作为稳定主视觉，卖点卡、场景卡和信息卡依次连跳，展示夏日解渴、柠檬茶味和分享场景',
        cardType: 'benefit_card',
        motifLine: '只迁移“多信息快速切换”的抽象节奏；目标等价物是卖点卡、场景卡、信息卡和产品稳定底图'
      };
    case 'device_handoff':
      return {
        ...base,
        label: '分享场景接力',
        reshootShot: '用手递冰红茶、桌面到通勤的场景切换或朋友分享动作，表达从个人到社交场景的接力',
        mustCapture: ['手递产品', '通勤或桌面场景切换', '朋友分享或多人场景暗示', '产品始终可识别'],
        framing: '竖屏中景，手部动作和产品同框，转场处留出运动方向',
        durationSec: base.durationSec,
        hyperframesIntent: '把跨设备接力抽象成饮用场景接力和社交分享',
        animationHints: ['手递转场', '场景擦除', '分享箭头', '通勤场景切换'],
        aigcScene: '一瓶冰红茶从桌面被手递到通勤或社交场景，完成清爽分享的场景切换，产品标签清晰',
        cardType: 'timeline_bridge_card',
        motifLine: '只迁移“从一个使用场景接力到另一个场景”的抽象结构；目标等价物是手递、通勤、社交分享和场景切换'
      };
    case 'cta_lockup':
      return {
        ...base,
        label: '多瓶阵列 CTA 尾帧',
        reshootShot: '拍摄多瓶阵列或单瓶定格，配合干净收口和购买引导空间，形成 CTA 尾帧',
        mustCapture: ['多瓶阵列或单瓶稳定定格', '标签清晰', 'CTA 尾帧留白', '购买引导区域干净'],
        framing: '竖屏产品居中或阵列居中，底部/侧边留文案安全区',
        durationSec: base.durationSec,
        hyperframesIntent: '把结尾锁定抽象成产品阵列、干净收口和明确行动引导',
        animationHints: ['多瓶阵列', 'CTA 尾帧', '购买引导弹出', '干净收口'],
        aigcScene: '多瓶阵列或单瓶产品定格，背景干净明亮，留出 CTA 文案空间，形成清晰购买引导尾帧',
        cardType: 'cta_card',
        motifLine: '只迁移“结尾锁定和行动引导”的抽象结构；目标等价物是多瓶阵列、CTA 尾帧、购买引导和干净收口'
      };
    case 'generic_source_specific':
    default:
      return {
        ...base,
        label: '饮料动作等价镜头',
        reshootShot: '把源片里的品类专属结构展示替换成饮料原生画面：瓶身标签、冷凝水、茶色流动、开盖、倒入杯中或多瓶陈列',
        mustCapture: [
          '瓶身标签或包装清晰',
          '冷凝水/冰块/柠檬片等冰爽证据',
          '开盖、瓶身旋转、倒茶或陈列扫过中的一个饮料动作',
          '画面留出卖点或 CTA 安全区'
        ],
        framing: base.framing,
        durationSec: base.durationSec,
        hyperframesIntent: '把源品类专属功能展示替换成饮料可拍摄/可包装的卖点画面',
        animationHints: ['瓶身标签高光', '冷凝水擦除', '柠檬片扫过', '茶色流动', '卖点卡落下'],
        aigcScene:
          '瓶身标签清晰可见，冷凝水、冰块、柠檬片和红茶茶色作为视觉证据，动作可为开盖、瓶身旋转、倒入杯中或多瓶陈列扫过',
        cardType: base.cardType,
        motifLine: '只迁移“展示细节与功能递进”的结构，不复制源品类物体；目标等价物是瓶身标签、冷凝水、茶色流动、开盖动作和产品陈列'
      };
  }
}

function buildSlotText(slot: ShotSlotNode): string {
  return [
    slot.requiredAsset.subject,
    slot.requiredAsset.motion,
    slot.intent?.purpose,
    slot.intent?.motionPattern,
    slot.sourceInstance?.specificAction
  ]
    .filter(Boolean)
    .join(' ');
}

function normalizeRole(role: string): keyof typeof ZH_ROLE_SPECS {
  switch (role) {
    case 'opening_attention':
      return 'opening';
    case 'product_closeup':
    case 'cover':
      return 'product_closeup';
    case 'usage_demo':
    case 'technique_demo':
    case 'example_clip':
      return 'usage';
    case 'comparison':
      return 'comparison';
    case 'benefit_visual':
    case 'testimonial':
      return 'benefit';
    case 'cta_visual':
      return 'cta';
    case 'instruction_card':
      return 'instruction';
    default:
      return 'generic';
  }
}

// --- helpers ----------------------------------------------------------------

function isCtaRole(role: string): boolean {
  return role === 'cta' || role === 'cta_visual';
}

/** 收敛: each slot references only its single chosen asset; gap slots fall back to one product reference. */
function singleReference(args: BuildGapResolutionOptionsArgs): string[] {
  if (args.chosenAssetId) return [args.chosenAssetId];
  const first = uniqueNonEmpty(args.referenceAssetIds)[0];
  return first ? [first] : [];
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function uniqueNonEmpty(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => Boolean(id))));
}
