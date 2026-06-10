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
import { splitRejectIfForTransfer } from '@viral-struct/shared';
import { DEFAULT_ASPECT_RATIO, SAFE_NEGATIVE_PROMPT_ZH } from './constants';
import { containsSourceSpecificTerm } from '../motifs/motionGrammarSanitizer';
import { inferSourceSpecificTransferSubtype } from './sourceSpecificAbstraction';
import { CASCADE_MOTION_TOKENS } from './structuralCompressionPlanner';

/**
 * P2 (§6) — EVERY beat (matched / partial / gap) gets all three honest resolution channels: reshoot +
 * HyperFrames + AIGC. For a **matched/covered** beat the three are ALTERNATIVES (替代/增强选项) to the
 * placed real asset; for partial they augment a structurally-incomplete real asset; for gap they fill a
 * true hole. The real-vs-alternative distinction is carried by the beat's `fillStatus`, not by withholding
 * channels — so the downstream editor always has the full menu (and an AIGC job-card prompt) on hand.
 *
 * Output language: **Chinese**. The Asset Manager's per-slot MissingMaterialBrief is English, and §12
 * forbids rewriting ②, so the Director authors the human-readable prose (guidanceNL / editingGuidanceNL /
 * prompt / mustCapture / avoid) itself in Chinese from a role template + the content brief, while still
 * reusing ②'s **structured** signals where they are language-neutral: referenced asset ids, durations,
 * providerHint, card type and channel eligibility. When no brief exists (e.g. a covered slot) the role
 * template alone produces the three options.
 *
 * Recommendation follows the degradation ladder (§6.4, 方案二): matched/partial → `hyperframes` (edit/
 * augment the real asset — cheapest, never auto-replaces it); gap → `aigc` when it is eligible,
 * otherwise `hyperframes`. AIGC is always *offered* as a job-card option; eligibility only governs whether
 * AIGC may be the *recommended* channel for a gap. `reshoot` is always offered, never auto.
 */
export interface BuildGapResolutionOptionsArgs {
  slot: ShotSlotNode;
  /**
   * matched = covered by a real asset (the three options are alternatives/enhancements);
   * partial = real asset placed but structurally incomplete; gap = no usable real asset.
   */
  tier: 'matched' | 'partial' | 'gap';
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
  /**
   * When true (a compressed beat that does NOT own the sensory-cascade reveal), strip the cascade/assembly
   * source grammar (由散到聚/汇聚/组装) and suppress the kinetic-assembly spec so this beat expresses its own
   * target function instead of reusing the convergence reveal. See beatOwnsSensoryCascade.
   */
  gateSourceCascade?: boolean;
}

export interface GapResolutionOptionsResult {
  options: GapResolutionOption[];
  recommendedOptionId: GapResolutionOptionId;
}

export interface DirectorPromptContext {
  slotId: string;
  role: string;
  slotIntent?: string;
  acceptanceExamples: string[];
  acceptanceMotionTypes: string[];
  hardRejectIf: string[];
  sourceSpecificRejectIf: string[];
  sourceSpecificMeaning?: string;
  targetEquivalentExplanation?: string;
  motifType?: string;
  motionTokens: string[];
  transferVariables: Array<{
    name: string;
    sourceValue?: string;
    targetValue?: string;
    allowedTargetValues?: string[];
    notes?: string;
  }>;
  targetCategoryMapping?: {
    preferredEquivalents?: string[];
    avoidSourceObjects?: string[];
  };
  contentBrief: ContentBrief;
  targetCategory: string;
  chosenAssetId?: string;
  referenceAssetIds: string[];
  assetEvidence?: {
    semanticSummary?: string;
    actionHints?: string[];
    qualityNotes?: string[];
    matchedIngredients?: string[];
    missingIngredients?: string[];
    observations?: string[];
    hasSafeArea?: boolean;
    keyframes?: unknown[];
  };
  fillStatus?: DirectorFillStatus;
}

export function buildGapResolutionOptions(args: BuildGapResolutionOptionsArgs): GapResolutionOptionsResult {
  const brief =
    args.missingBrief
    ?? args.assetSupplyContext?.missingMaterialBriefs?.find((entry) => entry.affectedSlotId === args.slot.id);

  const spec = buildDirectorSpec(args, brief);
  const context = buildDirectorPromptContext(args, spec, brief);
  const product = args.contentBrief.productName;

  const reshoot = buildReshootOption(spec, context, product, brief);
  const hyperframes = buildHyperframesOption(args, spec, context, product, brief);
  const aigc = buildAigcOption(args, spec, context, product, brief);
  // Every beat carries all three channels. For a matched/covered beat these are alternatives to the placed
  // real asset; `recommend` + the beat's fillStatus tell the handoff which channel (if any) to reach for.
  const options: GapResolutionOption[] = [reshoot, hyperframes, aigc];

  return {
    options,
    recommendedOptionId: recommend(args, brief, aigc)
  };
}

// --- recommendation ---------------------------------------------------------

function recommend(
  args: BuildGapResolutionOptionsArgs,
  brief: MissingMaterialBrief | undefined,
  aigc: AigcOption
): GapResolutionOptionId {
  // gap → AIGC when eligible (cheapest path to net-new material), else HyperFrames.
  // matched/partial → HyperFrames: edit/augment the real asset (cheapest + IP-safe), never auto-replace it.
  if (args.tier === 'gap') {
    return isAigcEligible(brief, aigc) ? 'aigc' : 'hyperframes';
  }
  return 'hyperframes';
}

function isAigcEligible(brief: MissingMaterialBrief | undefined, aigc: AigcOption): boolean {
  const channel = brief?.channelEligibility?.find((entry) => entry.channel === 'aigc_video_prompt');
  if (channel) {
    return channel.eligible;
  }
  return aigc.referenceAssetIds.length > 0;
}

// --- reshoot (Chinese) ------------------------------------------------------

function buildReshootOption(
  spec: ZhRoleSpec,
  context: DirectorPromptContext,
  product: string,
  brief?: MissingMaterialBrief
): ReshootOption {
  const durationSec = positive(brief?.manualShootBrief?.durationSec ?? spec.durationSec, spec.durationSec);
  const mustCapture = spec.mustCapture;
  const opener = reshootOpeningLine(context, spec, durationSec);
  const existingLine = existingAssetEvidenceLine(context, spec);
  const gapLine = humanGapLine(context);
  const guidanceNL =
    opener
    + sentenceLine('该槽位目标', contextGoalLine(context, spec))
    + existingLine
    + gapLine
    + `目标品类等价动作：${targetActionLine(context, spec)}。`
    + `镜头方案：${reshootShotLine(context, spec)}。`
    + `拍摄构图：${spec.framing}。`
    + `务必拍到：${mustCapture.join('、')}。`
    + `结构迁移作用：${structureSupportLine(context, spec)}。`
    + `画面要求：${product} 的包装与标签清晰可见，背景干净，动作自然利落。`;
  return {
    id: 'reshoot',
    title: `补拍「${spec.label}」素材`,
    guidanceNL,
    framing: spec.framing,
    durationSec,
    mustCapture,
    avoid: AVOID_ZH
  };
}

// --- hyperframes (Chinese editing guidance) ---------------------------------

function buildHyperframesOption(
  args: BuildGapResolutionOptionsArgs,
  spec: ZhRoleSpec,
  context: DirectorPromptContext,
  product: string,
  brief?: MissingMaterialBrief
): HyperframesOption {
  // 收敛 (Q2): reference only the single asset chosen for this slot.
  const referencedAssetIds = singleReference(args);
  const cardType = brief?.hyperframesBrief?.cardType ?? spec.cardType;
  const durationMs = positive(Math.round((brief?.hyperframesBrief?.durationSec ?? 3) * 1000), 3000);
  const refLine = hyperframesReferenceLine(context, referencedAssetIds);

  const motifLine = spec.motifLine ? `${spec.motifLine}。` : '';
  const layerLine = buildLayerLine(context, spec);
  const stepLine = buildAnimationStepLine(durationMs, context, spec, referencedAssetIds.length > 0);
  const bridgeLine = buildBridgeLine(context);
  const editingGuidanceNL =
    `${channelPositioningLine(context, 'hyperframes')}以 ${product} 为画面主体，${hyperframesIntentLine(context, spec)}。`
    + sentenceLine('槽位目标', contextGoalLine(context, spec))
    + existingAssetEvidenceLine(context, spec)
    + humanGapLine(context)
    + refLine
    + layerLine
    + stepLine
    + bridgeLine
    + motifLine
    + `用${targetActionLine(context, spec)}等画面动作承接「${spec.label}」。`
    + `文字留白区保留在画面上方或侧边，产品包装与标签清晰可见，节奏干净。`;

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
  context: DirectorPromptContext,
  product: string,
  brief?: MissingMaterialBrief
): AigcOption {
  const referenceAssetIds = singleReference(args);
  const providerHint = brief?.aigcGenerationBrief?.providerHint ?? inferProvider(args.slot.role);
  const expectedDurationSec = positive(brief?.aigcGenerationBrief?.expectedDurationSec ?? spec.durationSec, spec.durationSec);

  // Per-slot abstract transfer (Q3): the source motion grammar (motifTokens) is what makes each slot's
  // prompt distinct and carries the "keep the grammar, swap the objects" intent — rendered in Chinese,
  // so no two slots with different grammar get the same prompt, and no source object leaks.
  const gatedTokens = args.gateSourceCascade
    ? (args.motionTokens ?? []).filter((token) => !CASCADE_MOTION_TOKENS.has(token))
    : (args.motionTokens ?? []);
  const grammar = gatedTokens.map((token) => MOTION_TOKEN_ZH[token] ?? token).filter(Boolean);
  const variableLine = context.transferVariables.length
    ? `迁移变量：${context.transferVariables.map((entry) => `${entry.name}→${zhList(entry.targetValue ? [entry.targetValue] : entry.allowedTargetValues ?? [])}`).join('；')}。`
    : '';
  const targetMappingLine = targetActionLine(context, spec);
  const channelLine = channelPositioningLine(context, 'aigc');
  const transferLine = grammar.length
    ? `保留源片可迁移的动作语法（${grammar.join('、')}），用目标品类的等效动作重新演绎。`
    : '';

  const sellingPoints = args.contentBrief.sellingPoints ?? [];
  const sellingLine = sellingPoints.length ? `卖点围绕：${sellingPoints.join('、')}。` : '';

  const prompt =
    channelLine
    + `竖屏 9:16，${expectedDurationSec} 秒，普通手机广告质感的「${spec.label}」镜头。`
    + `主体产品：${product}，包装和标签必须保持清晰。`
    + sentenceLine('槽位目标', contextGoalLine(context, spec))
    + `目标品类等价动作：${targetMappingLine}。`
    + `分镜动作步骤：${buildAigcActionSteps(context, spec)}。`
    + `画面描述：${aigcSceneLine(context, spec)}。`
    + (spec.motifLine ? `${spec.motifLine}。` : '')
    + transferLine
    + variableLine
    + sellingLine
    + '整体画面真实自然，产品识别明确，收口干净。';

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
  targetEquivalentActions?: string[];
}

const AVOID_ZH = [
  '画面杂乱',
  '人物遮挡产品',
  '标签失焦',
  '背景过暗',
  '动作拖沓'
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
    framing: '竖屏中近景，产品居中，上下留出文字留白区',
    durationSec: 3,
    hyperframesIntent: '用强开场动效抓住前 3 秒注意力',
    animationHints: ['冷凝水珠推近', '冰块和柠檬快速入画', '冷雾定格'],
    aigcScene: '冷凝水珠、清透冰块、鲜切柠檬、红茶液滴和淡白冷雾快速堆叠成开场冰爽冲击',
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
    reshootShot: '拍摄并排陈列或前后关系，用画面关系呈现差异',
    mustCapture: ['清晰的对比或陈列关系', '产品清晰可见'],
    framing: '竖屏中景或全景，左右关系清晰',
    durationSec: 3,
    hyperframesIntent: '用对比卡呈现差异',
    animationHints: ['分屏', '前后标签', '柔和滑动转场'],
    aigcScene: '竖屏对比或陈列镜头，呈现简单清爽的视觉关系',
    cardType: 'comparison_card'
  },
  benefit: {
    label: '卖点证明',
    reshootShot: '拍摄能支撑卖点的画面线索（如冰块、柠檬茶、分享场景）',
    mustCapture: ['产品可见', '卖点线索可见', '画面稳定可读'],
    framing: '竖屏中景产品场景，留足文字留白区',
    durationSec: 3,
    hyperframesIntent: '把卖点做成简洁的利益点卡',
    animationHints: ['利益点徽章', '小幅产品抠像', '轻微动效'],
    aigcScene: '竖屏卖点证明场景，用冰块、柠檬、茶色和使用氛围支撑卖点',
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
  social: {
    label: '社交证明',
    reshootShot: '拍摄朋友聚餐、通勤分享或多人同框拿起饮料的真实场景，用自然动作证明产品适合分享和即时饮用',
    mustCapture: ['产品同框可见', '多人或分享场景', '自然拿起/递出动作', '画面干净不遮挡标签'],
    framing: '竖屏中景，人物可只露手或颈部以下，产品与分享关系清楚',
    durationSec: 3,
    hyperframesIntent: '把真实素材做成分享氛围和社交证明卡',
    animationHints: ['分享场景接力', '多人同框定格', '轻卡片标注'],
    aigcScene: '朋友聚餐、通勤或夏日户外分享冰红茶的真实场景，产品标签清晰，同框关系自然',
    cardType: 'benefit_card'
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
      framing: '竖屏产品居中，前半段留出级联运动空间，尾帧留出 CTA 文案留白区',
      durationSec: positive(brief?.manualShootBrief?.durationSec ?? 4, 4),
      hyperframesIntent: '把源片的“部件级联 -> 由散到聚 -> 激活爆发 -> CTA 揭示”抽象成饮料语境的结构动效',
      animationHints: ['冰块雨', '柠檬片扫过', '红茶水滴汇聚', '冷雾爆发', 'CTA 锁定'],
      aigcScene:
        '冰块、柠檬片、红茶水滴和冷雾围绕产品形成由散到聚的级联组装，开盖或倒茶触发冰爽爆发，最终进入产品 CTA 收口',
      cardType: brief?.hyperframesBrief?.cardType ?? 'timeline_bridge_card',
      motifLine: '迁移的是抽象运动语法：级联、汇聚、激活、爆发、CTA 收口；目标画面只使用冰块、柠檬、红茶水滴、冷雾和产品尾帧'
    };
  }

  if (!containsDirectorSourceSpecificTerm(buildSlotText(args.slot))) {
    return base;
  }

  return buildSourceSpecificSpec(base, inferSourceSpecificTransferSubtype(args.slot, args.motif));
}

function buildDirectorPromptContext(
  args: BuildGapResolutionOptionsArgs,
  spec: ZhRoleSpec,
  brief?: MissingMaterialBrief
): DirectorPromptContext {
  const primaryCandidate = args.coverage?.candidateAssets?.[0];
  const split = splitRejectIfForTransfer({
    ...args.slot.acceptanceCriteria,
    slotText: buildSlotText(args.slot),
    targetCategory: args.contentBrief.category
  });
  const acceptanceExamples =
    args.slot.acceptanceCriteria?.anyOf.flatMap((entry) => entry.examples).filter((entry) => !containsSourceSpecificTerm(entry)) ?? [];
  const acceptanceMotionTypes =
    args.slot.acceptanceCriteria?.anyOf.map((entry) => entry.motionType).filter((entry): entry is string => Boolean(entry)) ?? [];
  const transferVariables = args.motif?.transferVariables.map((entry) => ({
    name: entry.name,
    sourceValue: entry.sourceValue,
    targetValue: entry.targetValue,
    allowedTargetValues: entry.allowedTargetValues,
    notes: entry.notes
  })) ?? [];
  const preferredEquivalents =
    args.motif?.targetCategoryMapping.preferredEquivalents
    ?? brief?.motifContext?.targetMotifHints
    ?? spec.targetEquivalentActions
    ?? [];

  return {
    slotId: args.slot.id,
    role: args.slot.role,
    slotIntent: targetSafeSlotIntent(args.slot, spec),
    acceptanceExamples: acceptanceExamples.map(safePromptText).filter((entry): entry is string => Boolean(entry)),
    acceptanceMotionTypes: acceptanceMotionTypes.map(safePromptText).filter((entry): entry is string => Boolean(entry)),
    hardRejectIf: split.hardRejectIf,
    sourceSpecificRejectIf: split.sourceSpecificRejectIf,
    sourceSpecificMeaning: split.sourceSpecificRejectIf.length
      ? '源片里的源品类限制只作为动作语法提示，迁移时不直接否决目标品类素材。'
      : undefined,
    targetEquivalentExplanation: spec.motifLine,
    motifType: gatedMotifType(args, brief),
    motionTokens: args.motionTokens ?? args.motif?.motionTokens ?? brief?.motifContext?.motionTokens ?? [],
    transferVariables,
    targetCategoryMapping: {
      preferredEquivalents,
      avoidSourceObjects: args.motif?.bannedSourceTerms ?? split.sourceSpecificRejectIf
    },
    contentBrief: args.contentBrief,
    targetCategory: args.contentBrief.category ?? 'generic',
    chosenAssetId: args.chosenAssetId,
    referenceAssetIds: singleReference(args),
    assetEvidence: {
      semanticSummary: coverageSemanticSummary(args.coverage),
      actionHints: [
        ...(args.coverage?.candidateAssets?.flatMap((candidate) => candidate.evidence.reasons) ?? []),
        ...(brief?.manualShootBrief?.mustCapture ?? [])
      ].filter(Boolean).slice(0, 5),
      qualityNotes: [
        ...(args.coverage?.candidateAssets?.flatMap((candidate) => candidateConstraintNotes(candidate.constraints)) ?? []),
        ...(args.coverage?.limitations ?? [])
      ].filter(Boolean).slice(0, 5),
      matchedIngredients: [
        ...(args.coverage?.availableIngredients?.flatMap((ingredient) => ingredient.evidence.length ? ingredient.evidence : [ingredient.requiredIngredientId]) ?? []),
        ...(primaryCandidate?.evidence.semanticSignals ?? []),
        ...(primaryCandidate?.evidence.reasons ?? [])
      ].filter(Boolean).slice(0, 6),
      missingIngredients: [
        ...(args.coverage?.missingIngredients?.map((ingredient) => ingredient.label || ingredient.reason) ?? []),
        ...(args.coverage?.weakIngredients?.map((ingredient) => ingredient.label || ingredient.reason) ?? [])
      ].filter(Boolean).slice(0, 6),
      observations: args.coverage?.evidence?.slice(0, 4) ?? [],
      hasSafeArea: !primaryCandidate?.constraints.textSafeAreaRisk
    },
    fillStatus: args.fillStatus
  };
}

function contextGoalLine(context: DirectorPromptContext, spec: ZhRoleSpec): string {
  const pieces = [
    context.slotIntent,
    context.acceptanceExamples[0],
    context.acceptanceMotionTypes[0] ? `动作类型是 ${context.acceptanceMotionTypes[0]}` : undefined,
    spec.label
  ].filter((piece): piece is string => Boolean(piece));
  return pieces[0] ?? spec.label;
}

function sentenceLine(label: string, value: string): string {
  const clean = value.replace(/[。.!！?？\s]+$/g, '');
  return `${label}：${clean}。`;
}

function isMissingGeneration(context: DirectorPromptContext): boolean {
  return context.fillStatus === 'missing_generation_required';
}

function isMatched(context: DirectorPromptContext): boolean {
  return context.fillStatus === 'matched';
}

function hasReusableAsset(context: DirectorPromptContext): boolean {
  return Boolean(context.chosenAssetId) && !isMissingGeneration(context);
}

function existingAssetEvidenceLine(context: DirectorPromptContext, spec: ZhRoleSpec): string {
  if (!hasReusableAsset(context)) return '';
  const ingredients = [
    ...(context.assetEvidence?.matchedIngredients ?? []),
    ...(context.assetEvidence?.semanticSummary ? [context.assetEvidence.semanticSummary] : []),
    ...(context.assetEvidence?.actionHints ?? [])
  ];
  const evidence = uniqueNonEmpty(ingredients.map(toCreativeEvidenceText)).slice(0, 6);
  const evidenceText = evidence.length ? evidence.join('、') : roleNativeCues(spec).slice(0, 4).join('、');
  const status = isMatched(context)
    ? '已可作为主素材'
    : '可作为真实画面底板和局部镜头';
  return `已有素材 ${context.chosenAssetId} ${status}：${evidenceText}。`;
}

function humanGapLine(context: DirectorPromptContext): string {
  if (isMatched(context)) {
    return '素材状态：该槽位已有可用真实素材；以下方案均为可选替代或增强，不需要替换主素材。';
  }
  if (isMissingGeneration(context)) {
    const missing = humanMissingList(context);
    return `素材缺口：没有可直接使用的真实媒体支撑完整镜头，需要补拍或生成；${missing}。`;
  }
  if (context.fillStatus === 'source_specific_not_transferable') {
    return `素材缺口：${context.sourceSpecificMeaning ?? '源片动作属于源品类，需要改写成目标品类等价动作'}。`;
  }
  const notes = [
    ...(context.assetEvidence?.qualityNotes ?? []),
    ...(context.assetEvidence?.missingIngredients ?? [])
  ].map(toCreativeEvidenceText);
  const readable = uniqueNonEmpty(notes).slice(0, 5);
  if (readable.length) {
    return `素材缺口：${readable.join('；')}。`;
  }
  if (context.chosenAssetId) {
    return `素材缺口：现有素材适合做画面底板，但还需要补足动作证据、节奏收口或包装图层。`;
  }
  return '素材缺口：当前没有可直接覆盖该槽位的真实素材，需要补足动作证据或包装表达。';
}

function humanMissingList(context: DirectorPromptContext): string {
  const missing = uniqueNonEmpty([
    ...(context.assetEvidence?.missingIngredients ?? []),
    ...roleNativeCuesForRole(context.role).slice(0, 3)
  ].map(toCreativeEvidenceText));
  return missing.length ? `缺少 ${missing.slice(0, 4).join('、')}` : '缺少完整动作、产品识别和收口画面';
}

function reshootOpeningLine(context: DirectorPromptContext, spec: ZhRoleSpec, durationSec: number): string {
  if (isMatched(context)) {
    return `可选补拍一个约 ${durationSec} 秒的竖屏「${spec.label}」增强镜头。`;
  }
  if (hasReusableAsset(context)) {
    return `可选补拍一个约 ${durationSec} 秒的竖屏「${spec.label}」补足镜头，用来补齐现有素材没覆盖到的动作或情绪。`;
  }
  return `补拍一个约 ${durationSec} 秒的竖屏「${spec.label}」镜头。`;
}

function reshootShotLine(context: DirectorPromptContext, spec: ZhRoleSpec): string {
  if (normalizeRole(context.role) === 'opening') {
    return '取出刚冷藏好的瓶装饮料，瓶身布满冷凝水珠，旁边摆几块透明冰块和鲜切柠檬，镜头快速推近聚焦瓶身，水珠顺着瓶身滑落，形成前三秒冰爽冲击';
  }
  return spec.reshootShot;
}

function channelPositioningLine(context: DirectorPromptContext, channel: 'hyperframes' | 'aigc'): string {
  if (channel === 'aigc') {
    if (isMissingGeneration(context)) {
      return context.referenceAssetIds.length
        ? '真实素材不可直接复用；参考素材只作为产品外观和色彩的视觉参考。'
        : '';
    }
    return '可选替代生成任务：已有真实素材优先，以下仅作为风格替代或补充镜头。';
  }
  if (isMatched(context)) {
    return '可选 HyperFrames 增强：默认保留真实素材，只做节奏、图层和收口强化。';
  }
  return '';
}

function hyperframesReferenceLine(context: DirectorPromptContext, referencedAssetIds: string[]): string {
  if (!referencedAssetIds.length) return '';
  if (isMissingGeneration(context)) {
    return `参考素材 ${referencedAssetIds.join('、')} 仅作产品外观和色彩的视觉参考，不作为可直接复用镜头。`;
  }
  return `复用素材 ${referencedAssetIds.join('、')}：优先取画面中产品清晰、运动稳定、可裁切的片段作为底板。`;
}

function hyperframesIntentLine(context: DirectorPromptContext, spec: ZhRoleSpec): string {
  if (hasReusableAsset(context)) {
    return `基于已有素材完成「${spec.label}」的裁切、推近、定格和图层补足`;
  }
  return spec.hyperframesIntent;
}

function assetGapLine(context: DirectorPromptContext): string {
  if (context.fillStatus === 'source_specific_not_transferable') {
    return context.sourceSpecificMeaning ?? '当前素材能做底图，但源片动作属于源品类，需要迁移成目标品类等价动作';
  }
  if (context.assetEvidence?.qualityNotes?.length) return context.assetEvidence.qualityNotes.join('；');
  if (context.chosenAssetId) return `已有素材 ${context.chosenAssetId} 可做真实参考，但动作、时长或结构表达不足`;
  return '当前素材不足以直接覆盖该槽位，需要补足动作证据或包装表达';
}

function targetActionLine(context: DirectorPromptContext, spec: ZhRoleSpec): string {
  const preferred = context.targetCategoryMapping?.preferredEquivalents ?? [];
  const values = [
    ...preferred,
    ...context.transferVariables.flatMap((entry) => [entry.targetValue, ...(entry.allowedTargetValues ?? [])]),
    ...(spec.targetEquivalentActions ?? [])
  ].filter((entry): entry is string => Boolean(entry));
  const resolved = uniqueNonEmpty(values).slice(0, 8);
  return zhList(resolved.length ? resolved : spec.animationHints);
}

function structureSupportLine(context: DirectorPromptContext, spec: ZhRoleSpec): string {
  if (context.motifType === 'kinetic_assembly_reveal') {
    return '保留源片“级联、由散到聚、激活、爆发、CTA 收口”的结构节奏，但全部替换为饮料原生动作';
  }
  return spec.motifLine ?? `支撑「${spec.label}」的结构节奏，并把源片可迁移意图转成目标商品画面`;
}

function buildLayerLine(context: DirectorPromptContext, spec: ZhRoleSpec): string {
  const layers = uniqueNonEmpty([
    '产品主体图层',
    ...roleNativeCues(spec).slice(0, 4),
    ...targetActionLine(context, spec).split('、').slice(0, 3),
    context.contentBrief.sellingPoints[0] ? '卖点文字图层' : undefined,
    hasReusableAsset(context) ? `素材底板 ${context.chosenAssetId}` : undefined
  ].filter((entry): entry is string => Boolean(entry)));
  return `需要图层：${layers.join('、')}。`;
}

function buildAnimationStepLine(durationMs: number, context: DirectorPromptContext, spec: ZhRoleSpec, hasReference: boolean): string {
  const totalSec = Math.max(1, Math.round(durationMs / 1000));
  if (hasReusableAsset(context)) {
    const first = Number(Math.min(1, totalSec * 0.34).toFixed(1));
    const second = Number(Math.min(Math.max(first + 0.8, totalSec * 0.67), Math.max(1.8, totalSec - 0.6)).toFixed(1));
    const cues = roleNativeCues(spec);
    return `剪辑步骤：0-${first}s 对已有素材做局部裁切推近，优先聚焦${cues.slice(0, 3).join('、')}；${first}-${second}s 顺着素材自带的运动轨迹拉开或平移，让产品主体居中落定；${second}-${totalSec}s 做约0.5s微定格，在文字安全区补卖点/CTA图层并干净收口。`;
  }
  if (hasReference && isMissingGeneration(context)) {
    return `动画步骤：使用参考素材校准产品外观与品牌色，不直接复用镜头；0-${Math.max(1, Math.round(totalSec * 0.45))}s 建立产品与场景，后半段补齐动作和收口图层。`;
  }
  const mid = Math.max(0.8, Number((totalSec * 0.45).toFixed(1)));
  const late = Math.max(mid + 0.6, Number((totalSec * 0.78).toFixed(1)));
  const actions = targetActionLine(context, spec).split('、');
  return `动画步骤：0.0s-${mid}s ${actions[0] ?? spec.animationHints[0]}入场；${mid}s-${late}s ${actions[1] ?? spec.animationHints[1]}承接并形成节奏变化；${late}s-${totalSec}s 产品标签定格并收束到文案留白区。`;
}

function buildBridgeLine(context: DirectorPromptContext): string {
  if (context.motifType === 'kinetic_assembly_reveal') {
    return '前后衔接：上一镜头的动势接入冰块/柠檬/茶滴级联，下一镜头以产品居中或 CTA 尾帧承接。';
  }
  return '前后衔接：保留上一镜头运动方向，用产品定格或卖点卡承接到下一槽位。';
}

function buildAigcActionSteps(context: DirectorPromptContext, spec: ZhRoleSpec): string {
  const actions = targetActionLine(context, spec).split('、');
  if (context.motifType === 'kinetic_assembly_reveal') {
    return '冰块、柠檬片、红茶水滴从边缘级联飞入 → 由散到聚围绕瓶身汇聚 → 开盖或触碰瓶身完成激活 → 冷雾、茶花或水汽爆发 → 产品居中并 CTA 收口';
  }
  if (normalizeRole(context.role) === 'opening') {
    return '冷凝水珠快速推近 → 冰块和柠檬片向镜头逼近 → 红茶液滴划过瓶身 → 冷雾漫开 → 产品标签清晰定格';
  }
  return [
    actions[0] ?? spec.animationHints[0],
    actions[1] ?? spec.animationHints[1],
    actions[2] ?? '产品标签清晰定格',
    '卖点或 CTA 干净收口'
  ].join(' → ');
}

function aigcSceneLine(context: DirectorPromptContext, spec: ZhRoleSpec): string {
  if (normalizeRole(context.role) === 'opening') {
    return '开篇满屏透亮冷凝水珠、棱角分明的清透冰块、鲜切柠檬片、琥珀色红茶液滴和淡白冷雾快速堆叠，直接制造扑面而来的冰爽体感，画面干净通透无多余杂物';
  }
  return spec.aigcScene;
}

function roleNativeCues(spec: ZhRoleSpec): string[] {
  return roleNativeCuesForLabel(spec.label, spec.animationHints);
}

function roleNativeCuesForRole(role: string): string[] {
  return roleNativeCuesForLabel(zhRoleSpec(role).label, zhRoleSpec(role).animationHints);
}

function roleNativeCuesForLabel(label: string, fallback: string[]): string[] {
  if (/开场|英雄入场|hook/i.test(label)) return ['冷凝水珠', '清透冰块', '鲜切柠檬', '红茶液滴', '淡白冷雾', '快速入画'];
  if (/产品特写|瓶身|细节/.test(label)) return ['瓶身标签', '瓶盖', '冷凝水', '包装高光', '瓶身微距'];
  if (/卖点|利益|证明/.test(label)) return ['冰块', '柠檬', '茶色流动', '分享场景', '卖点卡'];
  if (/使用|动作|饮料动作/.test(label)) return ['开盖', '倒入杯中', '喝一口', '手部动作', '产品可见'];
  if (/社交|分享/.test(label)) return ['多人同框', '朋友分享', '聚餐场景', '手递产品', '产品同框'];
  if (/CTA|行动|尾帧|锁定|收口/.test(label)) return ['产品定格', 'CTA 留白', '干净尾帧', '购买引导', '品牌收口'];
  return fallback;
}

function toCreativeEvidenceText(value: string): string {
  if (isMachineEvidenceLine(value)) return '';
  const safe = safePromptText(value);
  if (!safe) return '';
  return safe
    .replace(/safe area\s*for\s*opening hook copy/gi, '开场文案文字安全区')
    .replace(/safe area\s*for\s*benefit caption/gi, '卖点文案文字安全区')
    .replace(/surface\s*for\s*benefit proof copy/gi, '卖点证明文案承载画面')
    .replace(/enough hold time\s*for\s*opening hook/gi, '开场钩子需要足够定格时长')
    .replace(/\bfast_cut\b/gi, '快速切入节奏')
    .replace(/1\.5s minimum duration/gi, '完整动作时长')
    .replace(/minimum duration/gi, '完整动作时长')
    .replace(/文字安全区\s*for\s*opening hook copy/gi, '开场文案文字安全区')
    .replace(/文字安全区\s*for\s*benefit caption/gi, '卖点文案文字安全区')
    .replace(/beverage bottle/gi, '瓶身与包装')
    .replace(/contains hand or usage-action cues/gi, '有手部或使用动作线索')
    .replace(/contains drink\/pour\/cup cues/gi, '有饮用、倒入或杯子线索')
    .replace(/Plain user-shot Kangshifu iced tea video.*?duration\.?/gi, '普通用户实拍饮料素材')
    .replace(/\bpartial_support\b/g, '局部可用')
    .replace(/\bcovered\b/g, '可覆盖')
    .replace(/\bweak\b/g, '弱覆盖')
    .replace(/has keyframe evidence|有关键帧证据/gi, '有可定格关键帧')
    .replace(/text safe area|safe area/gi, '文字安全区')
    .replace(/overlay/gi, '图层')
    .replace(/\s+/g, ' ')
    .trim();
}

function isMachineEvidenceLine(value: string): boolean {
  return /ranking=|roleAffordance|intent\/criteria|mediaReadiness|semantic\(|editability|quality\(|\w+_\d+.*->\s*slot_/i.test(value);
}

function safePromptText(text: string | undefined): string | undefined {
  if (!text) return undefined;
  if (!containsDirectorSourceSpecificTerm(text)) return text;
  const sanitized = sanitizeSourceSpecificText(text);
  return sanitized.length > 0 ? sanitized : undefined;
}

function targetSafeSlotIntent(slot: ShotSlotNode, spec: ZhRoleSpec): string | undefined {
  const raw = slot.intent?.purpose;
  if (!raw) {
    return spec.motifLine ?? `围绕「${spec.label}」完成目标品类等价表达`;
  }
  if (!containsDirectorSourceSpecificTerm(raw)) {
    return raw;
  }
  const sanitized = sanitizeSourceSpecificText(raw);
  if (sanitized && !containsDirectorSourceSpecificTerm(sanitized)) {
    return sanitized;
  }
  return spec.motifLine ?? `围绕「${spec.label}」完成目标品类等价表达`;
}

function sanitizeSourceSpecificText(text: string): string {
  let safe = text
    .replace(/屏幕显示与系统交互/g, '卖点卡与场景卡连续切换')
    .replace(/系统交互/g, '卖点卡互动')
    .replace(/多窗口并行操作/g, '多卖点卡并行展示')
    .replace(/多个应用界面/g, '多个饮用场景卡')
    .replace(/应用界面/g, '场景卡')
    .replace(/界面/g, '信息卡')
    .replace(/产品侧边接口布局/g, '瓶身标签与冷凝水细节布局')
    .replace(/侧边接口布局/g, '瓶身标签细节布局')
    .replace(/接口布局/g, '标签细节布局')
    .replace(/接口/g, '瓶身细节')
    .replace(/摄像头|镜片/g, '标签高光')
    .replace(/功能部件组装/g, '冰爽元素汇聚')
    .replace(/核心功能部件/g, '核心冰爽元素')
    .replace(/功能部件/g, '冰爽元素')
    .replace(/高清内容播放/g, '茶色质感呈现')
    .replace(/按键操作/g, '开盖或触碰瓶身动作')
    .replace(/按键/g, '开盖动作')
    .replace(/产品闭合全流程/g, '产品定格收口流程')
    .replace(/特殊开合结构/g, '开盖/倒茶动作')
    .replace(/开合结构/g, '开盖/倒茶动作')
    .replace(/硬件卖点/g, '冰爽卖点')
    .replace(/硬件功能/g, '冰爽卖点')
    .replace(/硬件/g, '冰爽卖点')
    .replace(/跨设备联动/g, '跨场景分享接力')
    .replace(/无缝协同/g, '顺滑场景接力')
    .replace(/触控板/g, '触碰瓶身')
    .replace(/键盘/g, '冰块')
    .replace(/笔记本/g, '产品主体')
    .replace(/火箭/g, '冰爽水汽')
    .replace(/购买窗口/g, 'CTA 卡片');

  safe = safe
    .replace(/MacBook|Apple|laptop|keyboard|trackpad|touchpad|screen|port|interface|camera|hinge|chassis|rocket|hardware|purchase window|multi[-_\s]?window|system interaction/gi, '目标品类等价动作')
    .replace(/笔记本|苹果|键盘|触控板|屏幕|接口|摄像头|机身|火箭|购买窗口|硬件功能|硬件|开合结构|闭合|按键|功能部件|多窗口|系统交互|侧边/g, '目标品类等价动作')
    .replace(/\s+/g, ' ')
    .trim();
  return safe;
}

function containsDirectorSourceSpecificTerm(text: string): boolean {
  return containsSourceSpecificTerm(text)
    || /MacBook|Apple|laptop|keyboard|trackpad|touchpad|screen|port|interface|camera|hinge|chassis|rocket|hardware|purchase window|multi[-_\s]?window|system interaction/i.test(text)
    || /笔记本|苹果|键盘|触控板|屏幕|接口|摄像头|机身|火箭|购买窗口|硬件功能|硬件|开合结构|闭合|按键|功能部件|多窗口|系统交互|侧边/.test(text);
}

function coverageSemanticSummary(coverage?: ContextualSlotCoverage): string | undefined {
  const first = coverage?.candidateAssets?.[0];
  if (!first) return undefined;
  return [
    first.assetId,
    ...first.evidence.semanticSignals.slice(0, 2),
    ...first.evidence.reasons.slice(0, 2),
    first.mediaReadiness?.hasKeyframe ? '有关键帧证据' : undefined
  ].filter(Boolean).join('，');
}

function candidateConstraintNotes(constraints: ContextualSlotCoverage['candidateAssets'][number]['constraints']): string[] {
  const notes: string[] = [];
  if (constraints.maxRecommendedDurationSec) {
    notes.push(`建议只截取其中约 ${Number(constraints.maxRecommendedDurationSec.toFixed(1))} 秒以内的最强片段`);
  }
  if (constraints.needsCrop) {
    notes.push('需要裁切或推近，把注意力集中到产品和关键动作');
  }
  if (constraints.needsOverlaySupport) {
    notes.push('需要标题、卖点或 CTA 图层补足表达');
  }
  if (constraints.notEnoughForStandaloneShot) {
    notes.push('适合作为局部镜头或画面底板，不能单独撑完整槽位');
  }
  if (constraints.textSafeAreaRisk) {
    notes.push('文字安全区不足，需要通过定格、留白或卡片层补足');
  }
  return notes;
}

function zhList(values: string[]): string {
  const translated = values
    .map(translateEquivalent)
    .filter((value) => value.length > 0 && !containsSourceSpecificTerm(value));
  return uniqueNonEmpty(translated).join('、');
}

function translateEquivalent(value: string): string {
  const lower = value.toLowerCase();
  const table: Array<[RegExp, string]> = [
    [/ice cubes?/, '冰块'],
    [/lemon slices?/, '柠檬片'],
    [/tea droplets?/, '红茶水滴'],
    [/cold mist/, '冷雾'],
    [/cap opening|cap pop/, '开盖激活'],
    [/pour/, '倒茶入杯'],
    [/cta lock|cta/, 'CTA 收口'],
    [/splash|burst/, '水汽爆发'],
    [/lineup/, '产品阵列'],
    [/brand color/, '品牌色块'],
    [/product/, '产品主体']
  ];
  for (const [pattern, translated] of table) {
    if (pattern.test(lower)) return translated;
  }
  return value;
}

function isKineticAssemblyContext(args: BuildGapResolutionOptionsArgs, brief?: MissingMaterialBrief): boolean {
  // A gated (non-cascade-owner) beat must not adopt the kinetic 由散到聚 assembly spec, even if its source
  // slot carried that motif — it should express its own target function instead.
  if (args.gateSourceCascade) return false;
  const motifType = args.motif?.motifType ?? brief?.motifContext?.motifType;
  return motifType === 'kinetic_assembly_reveal';
}

/** Drop a kinetic-assembly motifType for gated beats so downstream cascade branches (steps/bridge) don't fire. */
function gatedMotifType(args: BuildGapResolutionOptionsArgs, brief?: MissingMaterialBrief): string | undefined {
  const motifType = args.motif?.motifType ?? brief?.motifContext?.motifType;
  if (args.gateSourceCascade && motifType === 'kinetic_assembly_reveal') return undefined;
  return motifType;
}

function buildSourceSpecificSpec(base: ZhRoleSpec, subtype: SourceSpecificTransferSubtype): ZhRoleSpec {
  switch (subtype) {
    case 'opening_transform':
      return {
        ...base,
        label: '冰爽英雄入场',
        reshootShot: '用热浪背景被冰块和瓶身入画破开，完成从夏日闷热到冰爽入场的英雄亮相',
        mustCapture: ['热浪或夏日场景铺垫', '产品快速入画形成冰爽入场', '标签清晰可见', '尾帧留出干净文字安全区'],
        framing: '竖屏中近景，产品从侧前方或中央进入，顶部留标题留白区',
        durationSec: base.durationSec,
        hyperframesIntent: '把开场变形亮相抽象成“热到冷”的第一秒冲击',
        animationHints: ['热浪破开', '冰块擦屏', '产品英雄亮相', '冰爽尾帧定格'],
        aigcScene: '夏日热浪被冰块和产品入画破开，产品完成冰爽英雄亮相，画面清爽明亮，标签清晰',
        cardType: 'hook_card',
        motifLine: '只迁移“强开场变换入场”的抽象节奏；目标等价物是热浪、冰块、夏日场景、产品英雄亮相和冰爽尾帧定格'
      };
    case 'interface_detail':
      return {
        ...base,
        label: '瓶身细节扫光',
        reshootShot: '用瓶盖特写、标签扫光、冷凝水擦除和瓶身微距完成连续细节展示',
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
        framing: '竖屏产品居中或阵列居中，底部/侧边留文案留白区',
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
          '画面留出卖点或 CTA 留白区'
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
      return 'benefit';
    case 'social_proof':
    case 'testimonial':
      return 'social';
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
