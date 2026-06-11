import type {
  AigcOption,
  AssetSupplyContext,
  CategoryEquivalentVocabulary,
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
  ViralMotifAnnotation,
  VocabularyRoleKey
} from '@viral-struct/shared';
import { splitRejectIfForTransfer } from '@viral-struct/shared';
import { DEFAULT_ASPECT_RATIO, SAFE_NEGATIVE_PROMPT_ZH } from './constants';
import { containsSourceSpecificTerm } from '../motifs/motionGrammarSanitizer';
import { inferSourceSpecificTransferSubtype } from './sourceSpecificAbstraction';

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
 * augment the real asset — cheapest + IP-safe, never auto-replaces it); gap → `aigc` when it is eligible,
 * otherwise `hyperframes`. AIGC is always *offered* as a job-card option; eligibility only governs whether
 * AIGC may be the *recommended* channel for a gap. `reshoot` is always offered, never auto.
 */
export interface BuildGapResolutionOptionsArgs {
  slot: ShotSlotNode;
  /** Source-product-specific terms (derived from the scanned source graph) to keep out of target prompts. */
  sourceBannedTerms: readonly string[];
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
  /** Category-equivalent vocabulary injected by the caller; drives all product-specific strings. */
  vocab: CategoryEquivalentVocabulary;
}

export interface GapResolutionOptionsResult {
  options: GapResolutionOption[];
  recommendedOptionId: GapResolutionOptionId;
}

function roleToVocabKey(role: string): VocabularyRoleKey {
  const r = role.toLowerCase();
  if (/(hook|opening|attention|cover)/.test(r)) return 'opening_attention';
  if (/(cta|closing|lockup|call_to_action)/.test(r)) return 'cta_visual';
  if (/(usage|demo|technique|tutorial|ritual)/.test(r)) return 'usage_demo';
  if (/(benefit|feature|selling|proof|sensory)/.test(r)) return 'benefit_visual';
  if (/(social|testimonial|comparison|trust)/.test(r)) return 'social_proof';
  if (/(transition|bridge)/.test(r)) return 'transition';
  return 'product_closeup';
}

export interface DirectorPromptContext {
  slotId: string;
  role: string;
  sourceBannedTerms: readonly string[];
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
  const avoid = AVOID_ZH;
  const guidanceNL =
    `补拍一个约 ${durationSec} 秒的竖屏「${spec.label}」镜头。`
    + `该槽位目标：${contextGoalLine(context, spec)}。`
    + `当前素材不足：${assetGapLine(context)}。`
    + `画面动作：${targetActionLine(context, spec)}。`
    + `镜头方案：${spec.reshootShot}。`
    + `拍摄构图：${spec.framing}。`
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
  context: DirectorPromptContext,
  product: string,
  brief?: MissingMaterialBrief
): HyperframesOption {
  // 收敛 (Q2): reference only the single asset chosen for this slot.
  const referencedAssetIds = singleReference(args);
  const cardType = brief?.hyperframesBrief?.cardType ?? spec.cardType;
  const durationMs = positive(Math.round((brief?.hyperframesBrief?.durationSec ?? 3) * 1000), 3000);
  const refLine = referencedAssetIds.length ? `复用现有素材：${referencedAssetIds.join('、')}。` : '';

  const layerLine = buildLayerLine(context, spec);
  const stepLine = buildAnimationStepLine(durationMs, context, spec);
  const bridgeLine = buildBridgeLine(context);
  const editingGuidanceNL =
    `以 ${product} 为画面主体，${spec.hyperframesIntent}。`
    + `槽位目标：${contextGoalLine(context, spec)}。`
    + layerLine
    + stepLine
    + bridgeLine
    + `用${spec.animationHints.join('、')}等动效承接「${spec.label}」。`
    + refLine
    + `文字安全区保留在画面上方或侧边，产品包装与标签清晰可见。`
    + `不得加入未授权品牌、价格承诺或健康功效宣称，也不得加入源片电子设备元素。`;

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

  // The structure-transfer reasoning (which source grammar / subtype we borrowed, and the raw motion-grammar
  // tokens) stays INTERNAL — it is never written into the prompt. The downstream generator receives only the
  // RESULT: a clean, product-native shot description it can act on directly. Guard rails (brand / claims /
  // source-avoidance) are routed to negativePrompt, not the positive prompt.
  const targetMappingLine = targetActionLine(context, spec);
  const sellingPoints = args.contentBrief.sellingPoints ?? [];
  const sellingLine = sellingPoints.length ? `卖点只表现：${sellingPoints.join('、')}。` : '';

  const prompt =
    '仅为生成提示词，非成片。'
    + `为 ${product} 生成一个竖屏 9:16、${expectedDurationSec} 秒、普通手机广告质感的「${spec.label}」镜头。`
    + `主体产品：${product}，包装与标签清晰可见、画面干净。`
    + `画面动作：${targetMappingLine}。`
    + `分镜步骤：${timedStepBody(expectedDurationSec * 1000, context, spec)}。`
    + `画面质感：${spec.aigcScene}。`
    + sellingLine;

  const negativePrompt =
    SAFE_NEGATIVE_PROMPT_ZH
    + '；不得出现其它品牌、明星或公众人物、价格或促销承诺、医疗或功效宣称'
    + '；不得照搬或出现源产品/源品类的专属物体、场景或画面构图'
    + (sellingPoints.length ? '；不得编造卖点列表之外的新卖点' : '');

  return {
    id: 'aigc',
    prompt,
    negativePrompt,
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

/** Full per-slot spec passed to builders; product fields come from vocab, structural fields from ZhStructuralSpec. */
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

/** Product-neutral structural fields kept locally; product fields are injected from CategoryEquivalentVocabulary. */
interface ZhStructuralSpec {
  framing: string;
  durationSec: number;
  hyperframesIntent: string;
  cardType: string;
  motifLine?: string;
  targetEquivalentActions?: string[];
}

const AVOID_ZH = [
  '其它可见品牌或标识',
  '明星或公众人物肖像',
  '未经证实的价格或促销承诺',
  '医疗或功效保证类宣称',
  '直接照搬源视频的画面构图'
];


/** Structural (product-neutral) fields only; product fields (label/reshootShot/mustCapture/animationHints/aigcScene)
 * are injected from CategoryEquivalentVocabulary in buildDirectorSpec. */
const ZH_ROLE_SPECS: Record<string, ZhStructuralSpec> = {
  opening: {
    framing: '竖屏中近景，产品居中，上下留出文字安全区',
    durationSec: 3,
    hyperframesIntent: '用强开场动效抓住前 3 秒注意力',
    cardType: 'hook_card'
  },
  product_closeup: {
    framing: '竖屏特写，产品清晰，产品占画面 60%-80%',
    durationSec: 2.5,
    hyperframesIntent: '在卖点之前让产品形象清晰可辨',
    cardType: 'timeline_bridge_card'
  },
  usage: {
    framing: '竖屏只露手/颈部以下，产品与动作均可见',
    durationSec: 4,
    hyperframesIntent: '用步骤卡承接缺失的真实使用动作',
    cardType: 'usage_placeholder_card'
  },
  comparison: {
    framing: '竖屏中景或全景，左右关系清晰',
    durationSec: 3,
    hyperframesIntent: '用对比卡呈现差异',
    cardType: 'comparison_card'
  },
  benefit: {
    framing: '竖屏中景产品场景，留足文字安全区',
    durationSec: 3,
    hyperframesIntent: '把卖点做成简洁的利益点卡',
    cardType: 'benefit_card'
  },
  cta: {
    framing: '竖屏产品镜头，留有干净负空间',
    durationSec: 2,
    hyperframesIntent: '收束到干净的 CTA 锁定卡',
    cardType: 'cta_card'
  },
  instruction: {
    framing: '竖屏，要点清晰可读',
    durationSec: 3,
    hyperframesIntent: '用说明卡承接讲解要点',
    cardType: 'timeline_bridge_card'
  },
  generic: {
    framing: '竖屏，产品与动作均可见',
    durationSec: 3,
    hyperframesIntent: '用卡片承接缺失的画面证据',
    cardType: 'timeline_bridge_card'
  }
};

function zhRoleSpec(role: string): ZhStructuralSpec {
  return ZH_ROLE_SPECS[normalizeRole(role)] ?? ZH_ROLE_SPECS.generic;
}

function buildDirectorSpec(args: BuildGapResolutionOptionsArgs, brief?: MissingMaterialBrief): ZhRoleSpec {
  const structuralBase = zhRoleSpec(args.slot.role);
  const roleVocab = args.vocab.byRole[roleToVocabKey(args.slot.role)]!;
  // CONCRETE per-beat actions come from the per-SUBTYPE vocab (vocab.bySubtype[subtype].actions), which the
  // translator is required to keep mutually distinct — NOT from roleVocab.animationHints. The latter are
  // role-generic "图层/动效提示" (layer/effect hints, IDENTICAL for every same-role slot). Feeding those layer
  // hints into the action lines is what made every same-role slot's reshoot/hyperframes/AIGC prompt雷同 AND
  // surfaced raw "…图层" layer jargon (e.g. "液体流动粒子图层") to the user. The subtype is inferred from the
  // slot text, so distinct beats (摄像头模组 vs 配色芯片 vs 多窗口) resolve to distinct subtypes → distinct
  // concrete actions even when the source-leak gate is disabled (sourceBannedTerms: [] in the adapter path).
  const subtype = inferSourceSpecificTransferSubtype(args.slot, args.motif);
  const subtypeActions = args.vocab.bySubtype[subtype]?.actions?.length
    ? args.vocab.bySubtype[subtype]!.actions
    : roleVocab.animationHints;
  // Merge structural fields from the local template with product fields from the injected vocab.
  const base: ZhRoleSpec = {
    ...structuralBase,
    label: roleVocab.label,
    reshootShot: roleVocab.reshootShot,
    // mustCapture leads with this beat's SUBTYPE-specific actions (the migrated source abstract structure for
    // THIS slot) so the reshoot guidance differs per beat — not just one role-generic must-capture list — then
    // falls back to the role-level must-captures. This is what makes the three suggestions migrate the source's
    // abstract structure, not merely its functional role.
    mustCapture: uniqueNonEmpty([...subtypeActions.slice(0, 3), ...roleVocab.mustCapture]),
    // Concrete, subtype-distinct actions (NOT the role-generic layer hints) drive every action/animation/AIGC
    // line and the per-beat layer composition. roleVocab.animationHints (the "…图层" jargon) is intentionally
    // no longer read here.
    animationHints: subtypeActions,
    aigcScene: roleVocab.aigcScene,
    targetEquivalentActions: subtypeActions
  };

  if (isKineticAssemblyContext(args, brief)) {
    const kinetic = args.vocab.bySubtype.kinetic_assembly_reveal!;
    return {
      ...base,
      label: kinetic.label,
      reshootShot: `让 ${kinetic.actions.join('、')} 依次完成结构动作，最后收束到干净 CTA 尾帧`,
      mustCapture: [
        ...kinetic.actions,
        '干净 CTA 收口画面'
      ],
      framing: '竖屏产品居中，前半段留出结构化动作空间，尾帧留出 CTA 文案安全区',
      durationSec: positive(brief?.manualShootBrief?.durationSec ?? 4, 4),
      // Wording is sourced from the TARGET vocab (kinetic.label / kinetic.actions), NOT a hardcoded
      // 由散到聚/组装 source grammar — otherwise the source structure reads as surreal on a product it does
      // not fit (e.g. an assembly reveal forced onto a fragrance).
      hyperframesIntent: `用 ${kinetic.actions.join('、')} 完成「${kinetic.label}」，收束到干净 CTA 尾帧`,
      animationHints: kinetic.actions,
      // Keep the role-level sensory/atmosphere scene; the concrete kinetic actions live in animationHints.
      aigcScene: base.aigcScene,
      cardType: brief?.hyperframesBrief?.cardType ?? 'timeline_bridge_card',
      motifLine: `迁移的是抽象运动节奏；目标画面只用「${kinetic.label}」的本品类等价动作：${kinetic.actions.join('、')}，最后以产品尾帧收口`,
      targetEquivalentActions: kinetic.actions
    };
  }

  if (!containsDirectorSourceSpecificTerm(buildSlotText(args.slot), args.sourceBannedTerms)) {
    return base;
  }

  return buildSourceSpecificSpec(base, subtype, args.vocab);
}

function buildDirectorPromptContext(
  args: BuildGapResolutionOptionsArgs,
  spec: ZhRoleSpec,
  brief?: MissingMaterialBrief
): DirectorPromptContext {
  const split = splitRejectIfForTransfer({
    ...args.slot.acceptanceCriteria,
    slotText: buildSlotText(args.slot),
    targetCategory: args.contentBrief.category,
    sourceBannedTerms: args.sourceBannedTerms
  });
  const acceptanceExamples =
    args.slot.acceptanceCriteria?.anyOf.flatMap((entry) => entry.examples).filter((entry) => !containsSourceSpecificTerm(entry, args.sourceBannedTerms)) ?? [];
  const acceptanceMotionTypes =
    args.slot.acceptanceCriteria?.anyOf.map((entry) => entry.motionType).filter((entry): entry is string => Boolean(entry)) ?? [];
  const transferVariables = args.motif?.transferVariables.map((entry) => ({
    name: entry.name,
    sourceValue: entry.sourceValue,
    targetValue: entry.targetValue,
    allowedTargetValues: entry.allowedTargetValues,
    notes: entry.notes
  })) ?? [];
  // Vocab-derived target actions are authoritative. We deliberately do NOT seed this from the motif's
  // source-authored targetCategoryMapping.preferredEquivalents (the borrowed demo's other-category values);
  // the vocab has already re-expressed that grammar for THIS product.
  const preferredEquivalents = spec.targetEquivalentActions ?? [];

  return {
    slotId: args.slot.id,
    role: args.slot.role,
    sourceBannedTerms: args.sourceBannedTerms,
    slotIntent: targetSafeSlotIntent(args.slot, spec, args.sourceBannedTerms),
    acceptanceExamples: acceptanceExamples.map((entry) => safePromptText(entry, args.sourceBannedTerms)).filter((entry): entry is string => Boolean(entry)),
    acceptanceMotionTypes: acceptanceMotionTypes.map((entry) => safePromptText(entry, args.sourceBannedTerms)).filter((entry): entry is string => Boolean(entry)),
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
      ].filter(Boolean).slice(0, 5)
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

function assetGapLine(context: DirectorPromptContext): string {
  if (context.fillStatus === 'source_specific_not_transferable') {
    return '当前素材可作参考底图，但需要补拍出本产品自己的真实动作。';
  }
  if (context.assetEvidence?.qualityNotes?.length) return context.assetEvidence.qualityNotes.join('；');
  if (context.chosenAssetId) return `已有素材 ${context.chosenAssetId} 可做真实参考，但动作、时长或结构表达不足`;
  return '当前素材不足以直接覆盖该槽位，需要补足动作证据或包装表达';
}

function targetActionLine(context: DirectorPromptContext, spec: ZhRoleSpec): string {
  // The category-equivalent vocabulary (spec.targetEquivalentActions, now always set) is the SINGLE source
  // of truth for this product's target actions. The motif's preferredEquivalents / transferVariables.targetValue
  // are SOURCE-authored artifacts (the borrowed demo's, often another category), so they are NOT emitted here
  // — the vocab already re-expresses that structural grammar in THIS product's language. context.preferred is
  // kept only as a vocab-derived secondary (see buildDirectorPromptContext), never the raw motif values.
  const preferred = context.targetCategoryMapping?.preferredEquivalents ?? [];
  const values = [
    ...(spec.targetEquivalentActions ?? []),
    ...preferred
  ].filter((entry): entry is string => Boolean(entry));
  const resolved = uniqueNonEmpty(values).slice(0, 8);
  return zhList(resolved.length ? resolved : spec.animationHints, context.sourceBannedTerms);
}

function buildLayerLine(context: DirectorPromptContext, spec: ZhRoleSpec): string {
  const layers = uniqueNonEmpty([
    '产品主体图层',
    ...targetActionLine(context, spec).split('、').slice(0, 5),
    context.contentBrief.sellingPoints[0] ? '卖点文字图层' : undefined,
    context.chosenAssetId ? `参考素材 ${context.chosenAssetId}` : undefined
  ].filter((entry): entry is string => Boolean(entry)));
  return `需要图层：${layers.join('、')}。`;
}

/** A TIMED storyboard body (no label prefix): 0–t1 action A 入场 → t1–t2 action B 承接 → t2–end 产品定格.
 *  Distinct from the flat "画面动作" action list, so the AIGC prompt's 画面动作 (WHAT) and 分镜步骤 (WHEN)
 *  no longer repeat each other. Distributes whatever subtype-distinct actions targetActionLine resolved. */
function timedStepBody(durationMs: number, context: DirectorPromptContext, spec: ZhRoleSpec): string {
  const totalSec = Math.max(1, Math.round(durationMs / 1000));
  const mid = Math.max(0.8, Number((totalSec * 0.45).toFixed(1)));
  const late = Math.max(mid + 0.6, Number((totalSec * 0.78).toFixed(1)));
  const actions = targetActionLine(context, spec).split('、');
  return `0.0s-${mid}s ${actions[0] ?? spec.animationHints[0]}入场；${mid}s-${late}s ${actions[1] ?? spec.animationHints[1]}承接并形成节奏变化；${late}s-${totalSec}s 产品标签定格并收束到文案安全区。`;
}

function buildAnimationStepLine(durationMs: number, context: DirectorPromptContext, spec: ZhRoleSpec): string {
  return `动画步骤：${timedStepBody(durationMs, context, spec)}`;
}

function buildBridgeLine(context: DirectorPromptContext): string {
  if (context.motifType === 'kinetic_assembly_reveal') {
    return '前后衔接：承接上一镜头的动势，以产品居中或 CTA 尾帧收束。';
  }
  return '前后衔接：保留上一镜头运动方向，用产品定格或卖点卡承接到下一槽位。';
}

function safePromptText(text: string | undefined, sourceBannedTerms: readonly string[]): string | undefined {
  if (!text) return undefined;
  if (!containsDirectorSourceSpecificTerm(text, sourceBannedTerms)) return text;
  const sanitized = sanitizeSourceSpecificText(text, sourceBannedTerms);
  return sanitized.length > 0 ? sanitized : undefined;
}

function targetSafeSlotIntent(slot: ShotSlotNode, spec: ZhRoleSpec, sourceBannedTerms: readonly string[]): string | undefined {
  const raw = slot.intent?.purpose;
  if (!raw) {
    return `围绕「${spec.label}」完成该镜头的核心画面表达`;
  }
  if (!containsDirectorSourceSpecificTerm(raw, sourceBannedTerms)) {
    return raw;
  }
  const sanitized = sanitizeSourceSpecificText(raw, sourceBannedTerms);
  if (sanitized && !containsDirectorSourceSpecificTerm(sanitized, sourceBannedTerms)) {
    return sanitized;
  }
  return `围绕「${spec.label}」完成该镜头的核心画面表达`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeSourceSpecificText(text: string, sourceBannedTerms: readonly string[]): string {
  let out = text;
  for (const term of sourceBannedTerms) {
    if (!term) continue;
    out = out.replace(new RegExp(escapeRegExp(term), 'gi'), '目标品类等价动作');
  }
  return out.replace(/\s+/g, ' ').trim();
}

function containsDirectorSourceSpecificTerm(text: string, sourceBannedTerms: readonly string[]): boolean {
  return containsSourceSpecificTerm(text, sourceBannedTerms);
}

function coverageSemanticSummary(coverage?: ContextualSlotCoverage): string | undefined {
  const first = coverage?.candidateAssets?.[0];
  if (!first) return undefined;
  return [
    first.assetId,
    ...first.evidence.reasons.slice(0, 2),
    first.usableAs,
    first.mediaReadiness?.hasKeyframe ? '有关键帧证据' : undefined
  ].filter(Boolean).join('，');
}

function candidateConstraintNotes(constraints: ContextualSlotCoverage['candidateAssets'][number]['constraints']): string[] {
  return Object.entries(constraints)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => value === true ? key : `${key}: ${value}`);
}

function zhList(values: string[], sourceBannedTerms: readonly string[]): string {
  const translated = values
    .map(translateEquivalent)
    .filter((value) => value.length > 0 && !containsSourceSpecificTerm(value, sourceBannedTerms));
  return uniqueNonEmpty(translated).join('、');
}

function translateEquivalent(value: string): string {
  const lower = value.toLowerCase();
  const table: Array<[RegExp, string]> = [
    [/cta lock|cta/, 'CTA 收口'],
    [/lineup/, '产品阵列'],
    [/splash|burst/, '爆发瞬间'],
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

function buildSourceSpecificSpec(base: ZhRoleSpec, subtype: SourceSpecificTransferSubtype, vocab: CategoryEquivalentVocabulary): ZhRoleSpec {
  const eq = vocab.bySubtype[subtype]!;
  return {
    ...base,
    label: eq.label,
    reshootShot: `用 ${eq.actions.join('、')} 完成「${eq.label}」的结构化呈现，产品标签保持清晰`,
    mustCapture: [...eq.actions, '产品标签清晰可见'],
    animationHints: eq.actions,
    // Keep base.aigcScene (the role-level sensory/atmosphere description from the vocab) — the concrete
    // actions live in targetEquivalentActions/animationHints, so aigcScene stays the "画面质感/氛围" layer,
    // not a repeat of the actions.
    aigcScene: base.aigcScene,
    cardType: base.cardType,
    motifLine: `只迁移「${subtype}」的抽象结构节奏；目标等价物：${eq.actions.join('、')}`,
    targetEquivalentActions: eq.actions
  };
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
