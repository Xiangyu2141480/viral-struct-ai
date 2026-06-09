import type {
  AssetCard,
  ContentBrief,
  DirectorFillStatus,
  OrchestratedSlot,
  OrchestratedTransition,
  OrchestratedTransitionMode,
  TransitionAigcJobCard,
  TransitionAssetSupport,
  TransitionSafetyResult,
  TransitionWhyNot
} from '@viral-struct/shared';
import { SAFE_NEGATIVE_PROMPT_ZH } from './constants';

export interface TransitionPlanningContext {
  projectId: string;
  sourceVideoId?: string;
  targetCategory?: string;
  targetBrief: ContentBrief;
  fromSlot: OrchestratedSlot;
  toSlot: OrchestratedSlot;
  fromFillStatus?: DirectorFillStatus;
  toFillStatus?: DirectorFillStatus;
  fromAssetIds?: string[];
  toAssetIds?: string[];
  assetCards?: AssetCard[];
  missingIngredients?: string[];
  safetyConstraints?: {
    sourceTerms?: string[];
  };
}

interface TransitionAnchors {
  sourceTerms: string[];
  supportedByAssetIds: string[];
  missingIngredients: string[];
  durationMs: number;
  actionContinuity: boolean;
  graphicContinuity: boolean;
  foregroundCrossing: boolean;
  motionContinuity: boolean;
  cleanSafeArea: boolean;
  strongMotif: boolean;
  hasGap: boolean;
  hasPartial: boolean;
  supportedSignals: string[];
  missingSignals: string[];
}

interface Candidate {
  mode: OrchestratedTransitionMode;
  requiredEvidence: string[];
  matchedEvidence: string[];
  missingEvidence: string[];
  score: number;
  reason: string;
}

const CANDIDATE_MODES: OrchestratedTransitionMode[] = [
  'cut',
  'match_cut',
  'graphic_match',
  'eyeline_bridge',
  'object_wipe',
  'motion_bridge',
  'split_edit_j_cut',
  'split_edit_l_cut',
  'card_animation',
  'particle_bridge',
  'hyperframes',
  'aigc_job_card'
];

const DEFAULT_SOURCE_TERMS = [
  'macbook',
  'keyboard',
  'trackpad',
  'touchpad',
  'laptop',
  'rocket',
  'apple',
  'hardware',
  'purchase window',
  '键盘',
  '笔记本',
  '触控板',
  '火箭',
  '硬件',
  '购买窗口'
];

const ACTION_TERMS = [
  'open',
  'opening',
  'cap',
  'pour',
  'drink',
  'pick',
  'pickup',
  'hand',
  'press',
  'touch',
  'click',
  'use',
  'action',
  '开',
  '倒',
  '喝',
  '手',
  '拿',
  '按',
  '触碰'
];

const ACTION_PHASES: Record<string, string[]> = {
  open: ['open', 'opening', 'cap', '开盖', '打开'],
  pour: ['pour', '倒', '入杯'],
  drink: ['drink', 'sip', '喝', '饮用'],
  press: ['press', 'touch', 'click', '按', '触碰', '点击'],
  pickup: ['pickup', 'pick up', '拿起', '拿取']
};

const GRAPHIC_TERMS = [
  'center',
  'centered',
  'round',
  'circle',
  'circular',
  'logo',
  'label',
  'red',
  'yellow',
  'blue',
  'same position',
  'screen position',
  '居中',
  '圆',
  '标签',
  '同色',
  '同位置'
];

const CROSSING_TERMS = [
  'cross',
  'crosses',
  'wipe',
  'sweep',
  'across',
  'foreground',
  'pass in front',
  '遮挡',
  '扫过',
  '前景',
  '擦过'
];

const MOTION_TERMS = ['left to right', 'right to left', 'push', 'pan', 'tilt', 'zoom', 'rotate', 'rotation', 'slide', '推', '摇', '旋转', '滑动'];
const SAFE_AREA_TERMS = ['clean', 'safe area', 'minimal', 'blank', 'text card', 'cta', '留白', '干净', '卡片'];
const STRONG_MOTIF_TERMS = ['component_cascade', 'chaos_to_order', 'assembly_completion', 'assembly_reveal', 'spectacle_burst', 'kinetic_assembly_reveal'];

export function planTransition(ctx: TransitionPlanningContext): OrchestratedTransition {
  const anchors = collectTransitionAnchors(ctx);
  const candidates = enumerateTransitionCandidates(anchors);
  const gated = gateCandidatesByAssetSupportAndSafety(candidates, anchors);
  const ranked = rankCandidates(gated);
  const chosen = ranked[0] ?? makeCandidate('cut', ['safe fallback'], ['safe fallback'], [], 0.2, '缺少转场证据，使用安全切换。');
  return explainTransition(chosen, ranked, anchors, ctx);
}

export function collectTransitionAnchors(ctx: TransitionPlanningContext): TransitionAnchors {
  const fromAssets = assetsByIds(ctx.assetCards ?? [], ctx.fromAssetIds ?? assetIdsFromSlot(ctx.fromSlot));
  const toAssets = assetsByIds(ctx.assetCards ?? [], ctx.toAssetIds ?? assetIdsFromSlot(ctx.toSlot));
  const allAssetText = [...fromAssets, ...toAssets].map(assetEvidenceText).join('\n');
  const slotText = [slotEvidenceText(ctx.fromSlot), slotEvidenceText(ctx.toSlot)].join('\n');
  const combined = `${slotText}\n${allAssetText}`.toLowerCase();
  const fromText = `${slotContinuityText(ctx.fromSlot)}\n${fromAssets.map(assetEvidenceText).join('\n')}`.toLowerCase();
  const toText = `${slotContinuityText(ctx.toSlot)}\n${toAssets.map(assetEvidenceText).join('\n')}`.toLowerCase();
  const sourceTerms = [...DEFAULT_SOURCE_TERMS, ...(ctx.safetyConstraints?.sourceTerms ?? [])].map((term) => term.toLowerCase());
  const missingIngredients = unique([
    ...(ctx.missingIngredients ?? []),
    ...(ctx.fromSlot.fill.evidence.missingIngredients ?? []),
    ...(ctx.toSlot.fill.evidence.missingIngredients ?? [])
  ]);
  const supportedSignals = collectSupportedSignals(combined);
  const strongMotif = Boolean(ctx.fromSlot.motifType || ctx.toSlot.motifType)
    || [...(ctx.fromSlot.motionTokens ?? []), ...(ctx.toSlot.motionTokens ?? [])].some((token) => STRONG_MOTIF_TERMS.includes(token));
  const hasGap = ctx.fromSlot.fill.kind === 'gap' || ctx.toSlot.fill.kind === 'gap';
  const hasPartial =
    ctx.fromSlot.fillStatus === 'partial_asset_support'
    || ctx.toSlot.fillStatus === 'partial_asset_support'
    || (ctx.fromSlot.fill.kind === 'matched' && ctx.fromSlot.fill.status === 'partial')
    || (ctx.toSlot.fill.kind === 'matched' && ctx.toSlot.fill.status === 'partial');
  const durationMs = Math.max(0, Math.min(ctx.fromSlot.endMs - ctx.fromSlot.startMs, ctx.toSlot.endMs - ctx.toSlot.startMs));

  return {
    sourceTerms,
    supportedByAssetIds: unique([...fromAssets, ...toAssets].map((asset) => asset.id)),
    missingIngredients,
    durationMs,
    actionContinuity: hasActionContinuity(fromText, toText, ctx.fromSlot, ctx.toSlot),
    graphicContinuity: sharedSignalCount(fromText, toText, GRAPHIC_TERMS) >= 2,
    foregroundCrossing: hasAny(fromText, CROSSING_TERMS),
    motionContinuity: hasAny(fromText, MOTION_TERMS) && hasAny(toText, MOTION_TERMS),
    cleanSafeArea: hasAny(combined, SAFE_AREA_TERMS) || ctx.toSlot.role === 'cta_visual' || ctx.toSlot.role === 'benefit_visual',
    strongMotif,
    hasGap,
    hasPartial,
    supportedSignals,
    missingSignals: missingIngredients.length ? missingIngredients : hasGap ? ['real bridge asset'] : []
  };
}

function enumerateTransitionCandidates(anchors: TransitionAnchors): Candidate[] {
  return CANDIDATE_MODES.map((mode) => candidateForMode(mode, anchors));
}

function gateCandidatesByAssetSupportAndSafety(candidates: Candidate[], anchors: TransitionAnchors): Candidate[] {
  return candidates.map((candidate) => {
    if (candidate.mode === 'aigc_job_card') {
      return {
        ...candidate,
        score: candidate.score - 0.55,
        reason: `${candidate.reason} AIGC 只能作为计划任务卡，不作为默认执行路径。`
      };
    }
    if (candidate.mode !== 'cut' && anchors.hasGap && anchors.durationMs <= 800) {
      return {
        ...candidate,
        score: candidate.score - 0.45,
        missingEvidence: unique([...candidate.missingEvidence, 'very short gap-side bridge'])
      };
    }
    if (candidate.mode !== 'cut' && candidate.requiredEvidence.length > candidate.matchedEvidence.length + 1) {
      return { ...candidate, score: candidate.score - 0.2 };
    }
    return candidate;
  });
}

function rankCandidates(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => b.score - a.score || CANDIDATE_MODES.indexOf(a.mode) - CANDIDATE_MODES.indexOf(b.mode));
}

function explainTransition(
  chosen: Candidate,
  ranked: Candidate[],
  anchors: TransitionAnchors,
  ctx: TransitionPlanningContext
): OrchestratedTransition {
  const id = `transition_${safeId(ctx.fromSlot.slotId)}_${safeId(ctx.toSlot.slotId)}`;
  const transitionFunction = inferTransitionFunction(ctx.fromSlot, ctx.toSlot, anchors);
  const implementationMode = chosen.mode;
  const preferredImplementation = preferredImplementationForMode(implementationMode);
  const requiredAssets = anchors.supportedByAssetIds;
  const missingTransitionAssets = unique([...anchors.missingSignals, ...chosen.missingEvidence]).filter(Boolean);
  const assetSupport = buildAssetSupport(anchors, chosen);
  const safetyResult = buildSafetyResult(ctx, anchors);
  const semanticBridgeExplanation = sanitizePositiveText(
    `保留源结构的${transitionFunctionLabel(transitionFunction)}，用目标品类可执行的镜头承接从「${roleLabel(ctx.fromSlot.role)}」到「${roleLabel(ctx.toSlot.role)}」。`,
    anchors.sourceTerms
  );
  const visualAction = sanitizePositiveText(buildVisualAction(chosen.mode, ctx, anchors), anchors.sourceTerms);
  const whyNot = ranked
    .filter((candidate) => candidate.mode !== chosen.mode)
    .slice(0, 6)
    .map((candidate) => ({
      mode: candidate.mode,
      reason: whyCandidateNot(candidate, chosen, anchors)
    })) satisfies TransitionWhyNot[];
  const optionalAIGCJobCard = buildOptionalAigcJobCard(ctx, anchors, missingTransitionAssets);
  const hyperframesGuidance = implementationMode === 'hyperframes'
    ? sanitizePositiveText(`用图文/动效卡补足缺失的转场载体：${missingTransitionAssets.join('、') || '抽象动势承接'}；保持计划边界，不声明已生成外部视频。`, anchors.sourceTerms)
    : undefined;
  const confidence = clamp01(0.45 + chosen.score * 0.35 + (assetSupport.status === 'covered' ? 0.15 : assetSupport.status === 'partial' ? 0.05 : 0));

  return {
    id,
    fromSlotId: ctx.fromSlot.slotId,
    toSlotId: ctx.toSlot.slotId,
    mode: implementationMode,
    implementationMode,
    transitionType: implementationMode,
    transitionFunction,
    preferredImplementation,
    reason: sanitizePositiveText(chosen.reason, anchors.sourceTerms),
    semanticBridgeExplanation,
    visualAction,
    requiredAssets,
    assetSupport,
    missingAssets: missingTransitionAssets,
    missingTransitionAssets,
    fallbackStrategy: fallbackForMode(implementationMode),
    hyperframesGuidance,
    optionalAigcJobCardId: optionalAIGCJobCard?.id,
    optionalAIGCJobCard,
    audioCueHandoff: audioCueForMode(implementationMode),
    safetyResult,
    llmEnhancement: null,
    confidence,
    whyThisMode: sanitizePositiveText(chosen.reason, anchors.sourceTerms),
    whyNot,
    ...(implementationMode === 'hyperframes'
      ? {
          hyperframes: {
            editingGuidanceNL: hyperframesGuidance ?? visualAction,
            durationMs: 400,
            styleTokens: styleTokens(ctx, anchors)
          }
        }
      : {}),
    ...(implementationMode === 'aigc_job_card' || anchors.hasGap
      ? {
          aigcFrameBridge: {
            prompt: optionalAIGCJobCard.prompt,
            negativePrompt: optionalAIGCJobCard.negativePrompt,
            durationMs: 500,
            ownership: 'external_generation_job_card_only'
          }
        }
      : {}),
    riskNotes: riskNotesForPlan(implementationMode, anchors, safetyResult)
  };
}

function candidateForMode(mode: OrchestratedTransitionMode, anchors: TransitionAnchors): Candidate {
  switch (mode) {
    case 'match_cut':
      return makeCandidate(mode, ['action continuity'], anchors.actionContinuity ? ['action continuity'] : [], anchors.actionContinuity ? [] : ['action continuity'], anchors.actionContinuity ? 1.05 : 0.2, '动作链连续，优先使用 cutting-on-action 的 match cut。');
    case 'graphic_match':
      return makeCandidate(mode, ['shape/color/screen-position continuity'], anchors.graphicContinuity ? ['shape/color/screen-position continuity'] : [], anchors.graphicContinuity ? [] : ['shape/color/screen-position continuity'], anchors.graphicContinuity ? 0.98 : 0.18, '形状、颜色或构图位置连续，使用 graphic match 承接。');
    case 'object_wipe':
      return makeCandidate(mode, ['foreground object crossing frame'], anchors.foregroundCrossing ? ['foreground object crossing frame'] : [], anchors.foregroundCrossing ? [] : ['foreground object crossing frame'], anchors.foregroundCrossing ? 1.0 : 0.16, '前景物体扫过镜头，可作为自然遮挡擦除。');
    case 'motion_bridge':
      return makeCandidate(mode, ['motion direction continuity'], anchors.motionContinuity ? ['motion direction continuity'] : [], anchors.motionContinuity ? [] : ['motion direction continuity'], anchors.motionContinuity ? 0.86 : 0.15, '镜头/物体运动方向连续，使用 motion bridge。');
    case 'card_animation':
      return makeCandidate(mode, ['clean safe area or CTA/explanation need'], anchors.cleanSafeArea ? ['clean safe area or CTA/explanation need'] : [], anchors.cleanSafeArea ? [] : ['clean safe area'], anchors.cleanSafeArea ? 0.9 : 0.25, '存在说明、卖点或 CTA 承接需求，并且画面可容纳卡片动画。');
    case 'particle_bridge':
      return makeCandidate(mode, ['large semantic distance', 'atmosphere/particle bridge'], anchors.strongMotif ? ['large semantic distance'] : [], anchors.strongMotif ? ['particle bridge asset'] : ['large semantic distance'], anchors.strongMotif ? 0.72 : 0.12, '源结构需要抽象氛围/粒子承接，但真实素材证据有限。');
    case 'hyperframes':
      return makeCandidate(mode, ['important motif or missing bridge assets'], anchors.strongMotif || anchors.hasPartial ? ['important motif or missing bridge assets'] : [], anchors.strongMotif || anchors.hasPartial ? anchors.missingSignals : ['important motif'], anchors.strongMotif && anchors.missingSignals.length ? 0.94 : anchors.hasPartial ? 0.68 : 0.18, '重要结构动机或局部素材不足，需要 HyperFrames 计划卡补足桥接表达。');
    case 'aigc_job_card':
      return makeCandidate(mode, ['no real transition support'], anchors.hasGap ? ['gap-side transition support missing'] : [], anchors.hasGap ? anchors.missingSignals : ['true material gap'], anchors.hasGap && !anchors.durationMs ? 0.52 : anchors.hasGap ? 0.45 : 0.04, '外部生成只作为可选任务卡，保持 plan-only。');
    case 'split_edit_j_cut':
      return makeCandidate(mode, ['diegetic onset'], anchors.actionContinuity ? ['diegetic onset'] : [], anchors.actionContinuity ? [] : ['diegetic onset'], anchors.actionContinuity ? 0.62 : 0.08, '下一镜头有可预听动作声，可规划 J-cut 声音预入。');
    case 'split_edit_l_cut':
      return makeCandidate(mode, ['action or ambient tail'], anchors.motionContinuity ? ['action or ambient tail'] : [], anchors.motionContinuity ? [] : ['action tail'], anchors.motionContinuity ? 0.58 : 0.07, '上一镜头动作尾音可延续为 L-cut。');
    case 'cut':
    default:
      return makeCandidate(mode, ['safe deterministic edit'], ['safe deterministic edit'], [], anchors.hasGap && anchors.durationMs <= 800 ? 1.2 : anchors.hasGap ? 0.72 : 0.35, '缺少可靠桥接证据或一侧是短缺口，使用安全切换。');
  }
}

function makeCandidate(
  mode: OrchestratedTransitionMode,
  requiredEvidence: string[],
  matchedEvidence: string[],
  missingEvidence: string[],
  score: number,
  reason: string
): Candidate {
  return { mode, requiredEvidence, matchedEvidence, missingEvidence, score, reason };
}

function buildAssetSupport(anchors: TransitionAnchors, chosen: Candidate): TransitionAssetSupport {
  const status: TransitionAssetSupport['status'] =
    anchors.hasGap ? 'gap' : anchors.hasPartial || chosen.missingEvidence.length ? 'partial' : anchors.supportedByAssetIds.length ? 'covered' : 'reference_only';
  return {
    status,
    supportedByAssetIds: anchors.supportedByAssetIds,
    requiredEvidence: chosen.requiredEvidence,
    matchedEvidence: chosen.matchedEvidence,
    missingEvidence: unique([...anchors.missingSignals, ...chosen.missingEvidence]),
    missingTransitionAssets: unique([...anchors.missingSignals, ...chosen.missingEvidence]),
    reuseFirst: true
  };
}

function buildSafetyResult(ctx: TransitionPlanningContext, anchors: TransitionAnchors): TransitionSafetyResult {
  const positive = [
    slotEvidenceText(ctx.fromSlot),
    slotEvidenceText(ctx.toSlot)
  ].join('\n');
  const requiredRewrites = anchors.sourceTerms.filter((term) => positive.toLowerCase().includes(term.toLowerCase()));
  return {
    passed: true,
    sourceLeakageRisk: requiredRewrites.length ? 'needs_rewrite' : 'none',
    ipRisk: 'none',
    claimRisk: 'none',
    policyFlags: [],
    requiredRewrites
  };
}

function buildOptionalAigcJobCard(ctx: TransitionPlanningContext, anchors: TransitionAnchors, missingAssets: string[]): TransitionAigcJobCard {
  const prompt = sanitizePositiveText(
    `Plan-only transition bridge for ${ctx.targetCategory ?? 'generic'} category: abstract continuity from ${roleLabel(ctx.fromSlot.role)} to ${roleLabel(ctx.toSlot.role)} using supported target-native visual carriers. Missing: ${missingAssets.join(', ') || 'none'}.`,
    anchors.sourceTerms
  );
  return {
    id: `job_${safeId(ctx.fromSlot.slotId)}_${safeId(ctx.toSlot.slotId)}`,
    providerHint: 'generic',
    prompt,
    negativePrompt: SAFE_NEGATIVE_PROMPT_ZH,
    referenceAssetIds: anchors.supportedByAssetIds,
    ownership: 'external_generation_job_card_only',
    planOnly: true
  };
}

function buildVisualAction(mode: OrchestratedTransitionMode, ctx: TransitionPlanningContext, anchors: TransitionAnchors): string {
  const bridge = categoryBridgeCarrier(ctx.targetCategory ?? 'generic', anchors);
  switch (mode) {
    case 'match_cut':
      return `在相同动作相位上切换：上一镜头动作末端对齐下一镜头动作起点，保持真实素材优先。`;
    case 'graphic_match':
      return `用相近形状、颜色或屏幕位置做图形匹配，从${roleLabel(ctx.fromSlot.role)}承接到${roleLabel(ctx.toSlot.role)}。`;
    case 'object_wipe':
      return `让前景物体扫过画面形成自然遮挡擦除，再露出下一镜头。`;
    case 'motion_bridge':
      return `沿相同运动方向做运动桥接，保持镜头速度和画面重心连续。`;
    case 'card_animation':
      return `使用简洁标题/卖点卡片滑入，解释结构关系后进入下一镜头。`;
    case 'particle_bridge':
      return `用${bridge}作为抽象载体，把大语义跨度转成目标品类内的视觉承接。`;
    case 'hyperframes':
      return `用 HyperFrames 计划卡补足缺失桥接：${bridge}，不声明已经生成真实外部素材。`;
    case 'aigc_job_card':
      return `仅输出外部生成任务卡：用${bridge}补足转场素材缺口，当前不调用外部模型。`;
    case 'split_edit_j_cut':
      return `让下一镜头动作声音提前进入，视觉仍保持当前镜头直到切点。`;
    case 'split_edit_l_cut':
      return `让上一镜头动作尾音延续到下一镜头前段，形成声音桥。`;
    case 'cut':
    default:
      return `使用干净切换，避免在证据不足时伪造复杂转场。`;
  }
}

function categoryBridgeCarrier(category: string, anchors: TransitionAnchors): string {
  const generic = anchors.supportedSignals.includes('product') ? '产品前景运动、包装色块或简洁图形元素' : '目标品类前景元素、质感粒子或简洁图形元素';
  const byCategory: Record<string, string> = {
    beverage: '冷感雾气、水滴、瓶身动作或包装色块',
    beauty: '光泽扫光、刷头动作、泡沫或膏体质感',
    food: '蒸汽、酱汁、食材纹理或餐桌手部动作',
    electronics: '屏幕亮起、按键反馈、光带或干净表面扫光',
    fashion: '布料摆动、拉链、纽扣或穿搭轮廓变化',
    home_goods: '材质擦拭、放置动作、空间光线或表面反射',
    generic
  };
  return byCategory[category] ?? generic;
}

function whyCandidateNot(candidate: Candidate, chosen: Candidate, anchors: TransitionAnchors): string {
  if (candidate.mode === 'aigc_job_card') return '外部生成保持 plan-only，只有真实素材/剪辑方式不足时才作为可选任务卡。';
  if (candidate.mode === 'hyperframes' && chosen.mode !== 'hyperframes') return '真实素材或简单剪辑证据足够，暂不需要 HyperFrames 补桥。';
  if (candidate.mode === 'cut' && chosen.mode !== 'cut') return '存在更强的连续性证据，直接 cut 会浪费结构迁移信息。';
  if (candidate.missingEvidence.length) return `缺少证据：${candidate.missingEvidence.join('、')}。`;
  if (anchors.hasGap && candidate.mode !== 'cut') return '一侧存在缺口，复杂转场需降级。';
  return `分数低于已选模式 ${chosen.mode}。`;
}

function fallbackForMode(mode: OrchestratedTransitionMode): string {
  if (mode === 'aigc_job_card' || mode === 'hyperframes') return 'fallback_to_cut_if_not_executed';
  if (mode === 'match_cut' || mode === 'graphic_match' || mode === 'object_wipe' || mode === 'motion_bridge') return 'fallback_to_clean_cut';
  return 'safe_cut';
}

function audioCueForMode(mode: OrchestratedTransitionMode): string {
  if (mode === 'split_edit_j_cut') return 'next_action_sound_prelap';
  if (mode === 'split_edit_l_cut') return 'previous_action_tail_carryover';
  if (mode === 'match_cut') return 'tight_impact_on_cut';
  if (mode === 'card_animation') return 'soft_card_pop';
  if (mode === 'hyperframes' || mode === 'aigc_job_card') return 'plan_only_transition_sound_hint';
  return 'none';
}

function riskNotesForPlan(mode: OrchestratedTransitionMode, anchors: TransitionAnchors, safety: TransitionSafetyResult): string[] {
  const notes = ['Plan-only transition; no external generation or rendering is performed by the Director Agent.'];
  if (mode === 'aigc_job_card') notes.push('AIGC is represented only as an external generation job card.');
  if (mode === 'hyperframes') notes.push('HyperFrames guidance is a handoff plan, not generated media.');
  if (anchors.missingSignals.length) notes.push(`Missing bridge evidence: ${anchors.missingSignals.join(', ')}`);
  if (safety.requiredRewrites.length) notes.push('Source-specific terms were rewritten out of positive fields.');
  return notes;
}

function preferredImplementationForMode(mode: OrchestratedTransitionMode): OrchestratedTransition['preferredImplementation'] {
  if (mode === 'hyperframes' || mode === 'card_animation' || mode === 'particle_bridge') return 'hyperframes';
  if (mode === 'aigc_job_card' || mode === 'aigc_frame_bridge') return 'external_generation';
  return 'video_engine';
}

function inferTransitionFunction(from: OrchestratedSlot, to: OrchestratedSlot, anchors: TransitionAnchors): string {
  if (to.role === 'cta_visual' || to.role === 'cta') return 'product_to_cta';
  if (from.role === 'opening_attention') return 'problem_to_solution';
  if (anchors.strongMotif && (from.motifType === 'kinetic_assembly_reveal' || to.motifType === 'kinetic_assembly_reveal')) return 'chaos_to_order';
  if (from.role === 'product_closeup' && (to.role === 'benefit_visual' || to.role === 'product_closeup')) return 'ingredient_to_product';
  if (from.role === 'product_closeup' && to.role === 'usage_demo') return 'usage_to_benefit';
  if (from.role === 'usage_demo' && (to.role === 'benefit_visual' || to.role === 'testimonial')) return 'usage_to_benefit';
  if (from.role === 'comparison') return 'proof_to_cta';
  if (anchors.strongMotif) return 'chaos_to_order';
  return 'scene_to_brand_world';
}

function transitionFunctionLabel(fn: string): string {
  const labels: Record<string, string> = {
    product_to_cta: '产品到行动引导',
    chaos_to_order: '由散到聚',
    problem_to_solution: '问题到解决',
    usage_to_benefit: '使用到卖点',
    proof_to_cta: '证明到行动引导',
    scene_to_brand_world: '场景到品牌世界'
  };
  return labels[fn] ?? fn.replace(/_/g, ' ');
}

function styleTokens(ctx: TransitionPlanningContext, anchors: TransitionAnchors): string[] {
  return unique([
    ...(ctx.fromSlot.motionTokens ?? []),
    ...(ctx.toSlot.motionTokens ?? []),
    ...anchors.supportedSignals.slice(0, 3)
  ]).slice(0, 8);
}

function assetIdsFromSlot(slot: OrchestratedSlot): string[] {
  return slot.fill.kind === 'matched' ? [slot.fill.assetId] : [];
}

function assetsByIds(assetCards: AssetCard[], ids: string[]): AssetCard[] {
  const set = new Set(ids);
  return assetCards.filter((asset) => set.has(asset.id));
}

function assetEvidenceText(asset: AssetCard): string {
  return [
    asset.type,
    asset.spatialDescription,
    asset.temporalDescription,
    ...(asset.detectedObjects ?? []),
    ...(asset.visualStyleTags ?? []),
    asset.analysis?.semantic.summary,
    ...(asset.analysis?.semantic.detectedObjects ?? []),
    ...(asset.analysis?.slotAffordance.primaryRoles?.map((role) => `${role.role}:${role.confidence}`) ?? []),
    ...(asset.analysis?.roleAffordance?.map((role) => `${role.role}:${role.score}`) ?? []),
    ...(asset.analysis?.search.tags ?? [])
  ]
    .filter(Boolean)
    .join(' ');
}

function slotEvidenceText(slot: OrchestratedSlot): string {
  return [
    slot.role,
    slotContinuityText(slot)
  ]
    .filter(Boolean)
    .join(' ');
}

function slotContinuityText(slot: OrchestratedSlot): string {
  return [
    slot.transferableIntent,
    slot.sourceAbstraction?.abstractGrammar,
    slot.sourceAbstraction?.targetEquivalentLabel,
    ...(slot.sourceAbstraction?.targetEquivalentActions ?? []),
    ...(slot.motionTokens ?? []),
    ...(slot.fill.evidence.matchedIngredients ?? []),
    ...(slot.fill.evidence.missingIngredients ?? []),
    ...(slot.fill.evidence.blockingReasons ?? [])
  ]
    .filter(Boolean)
    .join(' ');
}

function collectSupportedSignals(text: string): string[] {
  const signals: string[] = [];
  if (/product|bottle|pack|label|商品|产品|瓶|包装|标签/.test(text)) signals.push('product');
  if (hasAny(text, ACTION_TERMS)) signals.push('action');
  if (hasAny(text, GRAPHIC_TERMS)) signals.push('graphic');
  if (hasAny(text, CROSSING_TERMS)) signals.push('foreground_wipe');
  if (hasAny(text, SAFE_AREA_TERMS)) signals.push('safe_area');
  return unique(signals);
}

function sharedSignalCount(a: string, b: string, terms: string[]): number {
  return terms.filter((term) => a.includes(term.toLowerCase()) && b.includes(term.toLowerCase())).length;
}

function hasAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term.toLowerCase()));
}

function hasActionContinuity(fromText: string, toText: string, fromSlot: OrchestratedSlot, toSlot: OrchestratedSlot): boolean {
  const fromPhases = actionPhases(fromText);
  const toPhases = actionPhases(toText);
  const sharedPhase = [...fromPhases].some((phase) => toPhases.has(phase));
  const sharedMotionToken = (fromSlot.motionTokens ?? []).some((token) =>
    (toSlot.motionTokens ?? []).includes(token)
    && /open|pour|drink|press|pickup|activation|cap|倒|喝|开/.test(token)
  );
  return sharedPhase || sharedMotionToken;
}

function actionPhases(text: string): Set<string> {
  const lower = text.toLowerCase();
  const phases = new Set<string>();
  for (const [phase, terms] of Object.entries(ACTION_PHASES)) {
    if (terms.some((term) => lower.includes(term.toLowerCase()))) phases.add(phase);
  }
  return phases;
}

function sanitizePositiveText(text: string, sourceTerms: string[]): string {
  let out = text;
  for (const term of sourceTerms) {
    if (!term) continue;
    out = out.replace(new RegExp(escapeRegExp(term), 'gi'), '源片专属元素');
  }
  return out
    .replace(/源片专属元素\s*(?:and|or|、|,)?\s*/gi, '源片专属元素')
    .trim();
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60);
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    opening_attention: '开场',
    product_closeup: '产品特写',
    usage_demo: '使用演示',
    benefit_visual: '卖点证明',
    comparison: '对比证明',
    testimonial: '信任证明',
    cta_visual: 'CTA 收口'
  };
  return labels[role] ?? role.replace(/_/g, ' ');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
