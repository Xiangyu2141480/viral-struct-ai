import type {
  AssetCard,
  AssetSupplyContext,
  Boundary,
  ContentBrief,
  ContextualSlotCoverage,
  DirectorFillStatus,
  MissingMaterialBrief,
  OrchestratedSlot,
  OrchestratedSlotEvidence,
  OrchestratedTimeline,
  OrchestratedTreatmentSpec,
  ReusableAssetPackPlan,
  SegmentNode,
  ShotSlotNode,
  SlotFillGap,
  SlotFillMatched,
  SlotMatch,
  TargetDurationMode,
  ViralMotifAnnotation,
  ViralStructureGraph
} from '@viral-struct/shared';
import { OrchestratedTimelineSchema } from '@viral-struct/shared';
import { matchSlots, matchSlotsWithFallback, type MatchSlotsResultWithSource } from '../slotMatcher';
import { buildAssetSupplyContext } from '../assetManager/assetSupplyContextBuilder';
import { extractViralMotifAnnotation } from '../motifs/viralMotifExtractor';
import { containsSourceSpecificTerm, sanitizeMotionGrammarText } from '../motifs/motionGrammarSanitizer';
import { normalizeCategory, type CategoryPreset } from '../motifs/categoryPresetProvider';
import { createOpenAICompatibleClient } from '../llmProvider';
import { evaluateSourceSpecificGate } from './sourceSpecificGate';
import { buildGapResolutionOptions } from './gapResolutionOptionsBuilder';
import { buildOrchestratedTransitions } from './transitionOrchestrator';
import { buildSourceAbstraction } from './sourceSpecificAbstraction';
import { DEFAULT_ASPECT_RATIO, DEFAULT_HYPERFRAMES_TRANSITION_WEIGHT } from './constants';

type LlmClient = ReturnType<typeof createOpenAICompatibleClient>;

const MATCHED_THRESHOLD = 0.85;
const PARTIAL_THRESHOLD = 0.45;
const DEFAULT_TARGET_DURATION_MODE: TargetDurationMode = 'high_conversion_20s';

export interface BuildOrchestratedTimelineInput {
  projectId: string;
  structureGraph: ViralStructureGraph;
  assetCards: AssetCard[];
  /** ②'s product, consumed read-only as evidence. Built internally (coverage only, no LLM) when omitted. */
  assetSupplyContext?: AssetSupplyContext;
  contentBrief: ContentBrief;
  categoryPreset?: CategoryPreset;
  boundaries?: Boundary[];
  hyperframesTransitionWeight?: number;
  targetDurationMode?: TargetDurationMode;
  /** When false, skip the LLM judge and use the deterministic rule-based matcher directly. */
  useLlmMatcher?: boolean;
  /** Injected for tests / mock LLM; falls back to the real OpenAI-compatible client otherwise. */
  clientFactory?: () => LlmClient;
  model?: string;
}

/**
 * P1 (§5) — the Director Agent's core. Runs the (reused) slot matcher, then per slot decides matched /
 * partial / gap on the degradation ladder (方案二) with the source-specific gate, attaches three
 * resolution options to every partial/gap, orchestrates transitions, and returns a schema-valid,
 * plan-only OrchestratedTimeline. No rendering, no external generation.
 */
export async function buildOrchestratedTimeline(input: BuildOrchestratedTimelineInput): Promise<OrchestratedTimeline> {
  const { structureGraph, assetCards, contentBrief } = input;
  const targetCategory = inferTargetCategory(contentBrief, input.categoryPreset);

  const assetSupplyContext =
    input.assetSupplyContext
    ?? buildAssetSupplyContext({
      structureGraph,
      assetCards,
      contentBrief,
      categoryPreset: input.categoryPreset
    });

  const match = await runMatch(input);
  const matchBySlot = new Map(match.matches.map((entry) => [entry.slotId, entry]));
  const coverageBySlot = new Map(
    (assetSupplyContext.contextualCoverage?.slotCoverages ?? []).map((coverage) => [coverage.slotId, coverage])
  );
  const briefBySlot = new Map(
    (assetSupplyContext.missingMaterialBriefs ?? []).map((brief) => [brief.affectedSlotId, brief])
  );
  const timingPlan = computeSlotTimings(structureGraph, input.targetDurationMode ?? DEFAULT_TARGET_DURATION_MODE);
  const timings = timingPlan.bySlot;

  const warnings = match.warning ? [match.warning] : [];

  const slots: OrchestratedSlot[] = structureGraph.shotSlots.map((slot) => {
    const slotMatch = matchBySlot.get(slot.id);
    const coverage = coverageBySlot.get(slot.id);
    const brief = briefBySlot.get(slot.id);
    const timing = timings.get(slot.id) ?? {
      sourceStartMs: 0,
      sourceEndMs: 1000,
      targetStartMs: 0,
      targetEndMs: 1000
    };
    const motif = findMotif(slot, targetCategory, input.categoryPreset);
    const gate = evaluateSourceSpecificGate({ slot, structureGraph, motif });
    const fillStatus = decideFillStatus({
      slot,
      match: slotMatch,
      coverage,
      motif,
      gateBlocked: gate.blocked,
      gateReasons: gate.reasons
    });
    const tier = fillStatusToTier(fillStatus);
    const referenceAssetIds = selectReferenceAssetIds(slotMatch, coverage, assetCards);
    const evidence = buildEvidence(coverage, slotMatch, gate.reasons);
    const motionTokens = sanitizeMotionGrammarText(buildSlotText(slot)).motionTokens;
    const transferableIntent = motionTokens.length > 0
      ? sanitizeMotionGrammarText(slot.intent?.purpose ?? buildSlotText(slot)).sanitizedIntent
      : undefined;
    const sourceAbstraction = buildSourceAbstraction({
      slot,
      motif,
      targetCategory
    });

    const fill = buildFill({
      tier,
      slot,
      slotMatch,
      coverage,
      brief,
      assetSupplyContext,
      contentBrief,
      referenceAssetIds,
      motionTokens,
      evidence,
      fillStatus,
      motif
    });

    return {
      slotId: slot.id,
      segmentId: slot.segmentId,
      role: slot.role,
      index: 0,
      startMs: timing.targetStartMs,
      endMs: timing.targetEndMs,
      sourceStartMs: timing.sourceStartMs,
      sourceEndMs: timing.sourceEndMs,
      targetStartMs: timing.targetStartMs,
      targetEndMs: timing.targetEndMs,
      fillStatus,
      // sourceIntent is provenance only; drop it whenever it carries source-product-specific semantics
      // so the raw source intent can never leak through the handoff (§12; mirrors the PR #60 leak fix).
      sourceIntent: safeSourceIntent(slot.intent?.purpose),
      transferableIntent,
      sourceAbstraction,
      motifType: motif?.motifType,
      motionTokens: motionTokens.length > 0 ? motionTokens : undefined,
      fill
    } satisfies OrchestratedSlot;
  });

  slots.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  slots.forEach((slot, index) => {
    slot.index = index;
  });

  const transitions = buildOrchestratedTransitions({
    slots,
    assetCards,
    contentBrief,
    hyperframesWeight: input.hyperframesTransitionWeight ?? DEFAULT_HYPERFRAMES_TRANSITION_WEIGHT
  });

  const timeline: OrchestratedTimeline = {
    schemaVersion: 'orchestrated-v1',
    projectId: input.projectId,
    renderProfile: buildRenderProfile(structureGraph),
    slots,
    transitions,
    reusableAssetPacks: buildReusableAssetPacks({ slots, contentBrief }),
    meta: {
      productName: contentBrief.productName,
      targetCategory,
      matchSource: match.alignmentSource,
      generatedAt: '1970-01-01T00:00:00.000Z',
      sourceDurationMs: timingPlan.sourceDurationMs,
      targetDurationMs: timingPlan.targetDurationMs,
      targetDurationMode: timingPlan.targetDurationMode,
      planOnly: true
    },
    warnings
  };

  return OrchestratedTimelineSchema.parse(timeline);
}

// --- matching ---------------------------------------------------------------

async function runMatch(input: BuildOrchestratedTimelineInput): Promise<MatchSlotsResultWithSource> {
  if (input.useLlmMatcher === false) {
    const result = matchSlots(input.structureGraph, input.assetCards, input.boundaries);
    return {
      matches: result.matches.map((entry) => ({ ...entry, alignmentSource: 'rule_based' as const })),
      gaps: result.gaps,
      alignmentSource: 'rule_based'
    };
  }
  return matchSlotsWithFallback({
    graph: input.structureGraph,
    assets: input.assetCards,
    boundaries: input.boundaries,
    clientFactory: input.clientFactory,
    model: input.model
  });
}

interface DecideFillStatusArgs {
  slot: ShotSlotNode;
  match: SlotMatch | undefined;
  coverage?: ContextualSlotCoverage;
  motif?: ViralMotifAnnotation;
  gateBlocked: boolean;
  gateReasons: string[];
}

function decideFillStatus(args: DecideFillStatusArgs): DirectorFillStatus {
  const quality = matchQuality(args.match);
  const hasAsset = Boolean(args.match?.assetId);
  if (!hasAsset || quality < PARTIAL_THRESHOLD) {
    return 'missing_generation_required';
  }

  if (args.gateBlocked) {
    return 'source_specific_not_transferable';
  }

  const missingCount =
    (args.coverage?.missingIngredients?.length ?? 0)
    + (args.coverage?.weakIngredients?.length ?? 0)
    + (args.match?.missingDescription ? 1 : 0);

  if (isKineticAssemblyMotif(args.motif) && args.coverage?.coverageStatus !== 'covered') {
    return 'needs_hyperframes_enhancement';
  }

  if (hasRawSourceSpecificSemantics(args.slot)) {
    return 'source_specific_not_transferable';
  }

  if (args.coverage?.coverageStatus === 'insufficient') {
    if (quality >= MATCHED_THRESHOLD && isDirectVisualRole(args.slot.role)) {
      return 'matched';
    }
    return 'needs_hyperframes_enhancement';
  }

  if (args.coverage?.coverageStatus === 'weak' || missingCount > 0) {
    return 'partial_asset_support';
  }

  if (quality >= MATCHED_THRESHOLD) {
    return 'matched';
  }

  return 'partial_asset_support';
}

function isDirectVisualRole(role: string): boolean {
  return role === 'opening_attention' || role === 'product_closeup' || role === 'cover' || role === 'cta_visual';
}

function hasRawSourceSpecificSemantics(slot: ShotSlotNode): boolean {
  const lower = buildSlotText(slot).toLowerCase();
  return /keyboard|touchpad|rocket|hardware|side port|interface|camera|chip|screen|grille|module/.test(lower)
    || /键盘|触控板|火箭|硬件功能|接口|摄像头|芯片|屏幕|格栅|脚垫|侧边按键|机身侧边|部件归位|功能部件/.test(lower);
}

function fillStatusToTier(status: DirectorFillStatus): 'matched' | 'partial' | 'gap' {
  if (status === 'matched') return 'matched';
  if (status === 'missing_generation_required') return 'gap';
  return 'partial';
}

function isKineticAssemblyMotif(motif: ViralMotifAnnotation | undefined): boolean {
  return motif?.motifType === 'kinetic_assembly_reveal';
}

function decideTier(match: SlotMatch | undefined, gateBlocked: boolean): 'matched' | 'partial' | 'gap' {
  const quality = matchQuality(match);
  const hasAsset = Boolean(match?.assetId);
  if (!hasAsset || quality < PARTIAL_THRESHOLD) {
    return 'gap';
  }
  if (quality >= MATCHED_THRESHOLD && !gateBlocked) {
    return 'matched';
  }
  return 'partial';
}

function matchQuality(match: SlotMatch | undefined): number {
  return clamp01(match?.quality ?? match?.score ?? 0);
}

// --- fills ------------------------------------------------------------------

interface BuildFillArgs {
  tier: 'matched' | 'partial' | 'gap';
  slot: ShotSlotNode;
  slotMatch?: SlotMatch;
  coverage?: ContextualSlotCoverage;
  brief?: MissingMaterialBrief;
  assetSupplyContext: AssetSupplyContext;
  contentBrief: ContentBrief;
  referenceAssetIds: string[];
  motionTokens?: string[];
  evidence: OrchestratedSlotEvidence;
  fillStatus: DirectorFillStatus;
  motif?: ViralMotifAnnotation;
}

function buildFill(args: BuildFillArgs): SlotFillMatched | SlotFillGap {
  const roleLabel = humanRole(args.slot.role);

  if (args.tier === 'matched') {
    const assetId = args.slotMatch?.assetId as string;
    return {
      kind: 'matched',
      assetId,
      matchQuality: matchQuality(args.slotMatch),
      matchedCriteria: args.slotMatch?.matchedCriteria ?? [],
      treatmentSpec: toTreatmentSpec(args.slotMatch),
      status: 'matched',
      videoEngineInstruction: `直接使用素材 ${assetId} 承接「${roleLabel}」槽位${treatmentSummary(args.slotMatch)}；保持原素材真实画面，不声明外部生成。`,
      evidence: args.evidence
    };
  }

  if (args.tier === 'partial') {
    const assetId = args.slotMatch?.assetId as string;
    const { options, recommendedOptionId } = buildGapResolutionOptions({
      slot: args.slot,
      tier: 'partial',
      coverage: args.coverage,
      missingBrief: args.brief,
      assetSupplyContext: args.assetSupplyContext,
      contentBrief: args.contentBrief,
      referenceAssetIds: args.referenceAssetIds,
      chosenAssetId: args.slotMatch?.assetId,
      motionTokens: args.motionTokens,
      fillStatus: args.fillStatus,
      motif: args.motif
    });
    const missing = args.slotMatch?.missingDescription;
    return {
      kind: 'matched',
      assetId,
      matchQuality: matchQuality(args.slotMatch),
      matchedCriteria: args.slotMatch?.matchedCriteria ?? [],
      missingCriteria: missing ? [missing] : undefined,
      treatmentSpec: toTreatmentSpec(args.slotMatch),
      status: 'partial',
      videoEngineInstruction:
        `先放入素材 ${assetId} 作为真实参考，再执行推荐的「${recommendedOptionId}」方案补足结构表达`
        + `${missing ? `；需补足：${missing}` : ''}。`,
      options,
      recommendedOptionId,
      evidence: args.evidence
    };
  }

  const { options, recommendedOptionId } = buildGapResolutionOptions({
    slot: args.slot,
    tier: 'gap',
    coverage: args.coverage,
    missingBrief: args.brief,
    assetSupplyContext: args.assetSupplyContext,
    contentBrief: args.contentBrief,
    referenceAssetIds: args.referenceAssetIds,
    motionTokens: args.motionTokens,
    fillStatus: args.fillStatus,
    motif: args.motif
  });
  return {
    kind: 'gap',
    reason: args.slotMatch?.missingDescription || args.slotMatch?.reason || `No asset can support the ${roleLabel} slot.`,
    missing: args.slotMatch?.missingDescription || `usable material for the ${roleLabel} slot`,
    recommendedOptionId,
    options,
    videoEngineInstruction:
      `当前没有可直接使用的真实素材；执行推荐的「${recommendedOptionId}」方案作为计划/任务卡，补足「${roleLabel}」槽位。`,
    evidence: args.evidence
  };
}

function toTreatmentSpec(match: SlotMatch | undefined): OrchestratedTreatmentSpec | undefined {
  const spec = match?.treatmentSpec;
  if (!spec) return undefined;
  const out: OrchestratedTreatmentSpec = {};
  if (typeof spec.motion === 'string') out.motion = spec.motion;
  if (typeof spec.durationMs === 'number') out.durationMs = spec.durationMs;
  if (typeof spec.syncPoint === 'string') out.syncPoint = spec.syncPoint;
  if (typeof spec.captionOverlay === 'string') out.captionOverlay = spec.captionOverlay;
  return Object.keys(out).length > 0 ? out : undefined;
}

function treatmentSummary(match: SlotMatch | undefined): string {
  const spec = match?.treatmentSpec;
  if (!spec) return '';
  const parts = [spec.motion, spec.syncPoint ? `卡点 ${spec.syncPoint}` : undefined].filter(Boolean);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

// --- evidence ---------------------------------------------------------------

function buildEvidence(
  coverage: ContextualSlotCoverage | undefined,
  match: SlotMatch | undefined,
  gateReasons: string[]
): OrchestratedSlotEvidence {
  // Evidence is a downstream-facing field, so its labels must be leak-safe too: a raw ingredient label
  // can be the source caption ("MacBook Neo / From $599 ..."). Drop leaky matched criteria; replace a
  // leaky missing-ingredient label with its safe id.
  const matchedIngredients = unique([
    ...(coverage?.availableIngredients?.map((entry) => entry.requiredIngredientId) ?? []),
    ...(match?.matchedCriteria ?? [])
  ]).filter((label) => !containsSourceSpecificTerm(label));
  const missingIngredients = unique([
    ...(coverage?.missingIngredients?.map((entry) => safeLabel(entry.label, entry.requiredIngredientId)) ?? []),
    ...(coverage?.weakIngredients?.map((entry) => safeLabel(entry.label, entry.requiredIngredientId)) ?? [])
  ]);
  return {
    coverageStatus: coverage?.coverageStatus,
    matchedIngredients,
    missingIngredients,
    blockingReasons: unique(gateReasons)
  };
}

function safeLabel(label: string, fallback: string): string {
  return containsSourceSpecificTerm(label) ? fallback : label;
}

// --- references -------------------------------------------------------------

function selectReferenceAssetIds(
  match: SlotMatch | undefined,
  coverage: ContextualSlotCoverage | undefined,
  assetCards: AssetCard[]
): string[] {
  const ids = unique([
    ...(match?.assetId ? [match.assetId] : []),
    ...(coverage?.candidateAssets?.map((candidate) => candidate.assetId) ?? [])
  ]);
  if (ids.length > 0) {
    return ids.slice(0, 3);
  }
  return assetCards.slice(0, 1).map((asset) => asset.id);
}

// --- timings ----------------------------------------------------------------

interface SlotTiming {
  sourceStartMs: number;
  sourceEndMs: number;
  targetStartMs: number;
  targetEndMs: number;
}

interface TimingPlan {
  bySlot: Map<string, SlotTiming>;
  sourceDurationMs: number;
  targetDurationMs: number;
  targetDurationMode: TargetDurationMode;
}

function computeSlotTimings(graph: ViralStructureGraph, targetDurationMode: TargetDurationMode): TimingPlan {
  const sourceTimings = new Map<string, { startMs: number; endMs: number }>();
  const segmentById = new Map(graph.segments.map((segment) => [segment.id, segment]));
  const bySegment = new Map<string, ShotSlotNode[]>();
  for (const slot of graph.shotSlots) {
    const group = bySegment.get(slot.segmentId) ?? [];
    group.push(slot);
    bySegment.set(slot.segmentId, group);
  }

  for (const [segmentId, slots] of bySegment) {
    const segment = segmentById.get(segmentId);
    const startMs = secondsToMs(segment?.start ?? 0);
    const endMs = segment ? secondsToMs(segment.end) : startMs + slots.length * 1000;
    const span = Math.max(slots.length, endMs - startMs);
    const per = Math.max(1, Math.floor(span / slots.length));
    slots.forEach((slot, index) => {
      const slotStart = startMs + index * per;
      const slotEnd = index === slots.length - 1 ? Math.max(slotStart + 1, endMs) : slotStart + per;
      sourceTimings.set(slot.id, { startMs: slotStart, endMs: Math.max(slotEnd, slotStart + 1) });
    });
  }

  const sorted = [...graph.shotSlots]
    .map((slot) => ({ slot, timing: sourceTimings.get(slot.id) }))
    .filter((entry): entry is { slot: ShotSlotNode; timing: { startMs: number; endMs: number } } => Boolean(entry.timing))
    .sort((a, b) => a.timing.startMs - b.timing.startMs || a.timing.endMs - b.timing.endMs);

  const sourceStart = sorted[0]?.timing.startMs ?? 0;
  const sourceEnd = Math.max(...sorted.map((entry) => entry.timing.endMs), 1);
  const sourceDurationMs = Math.max(1, sourceEnd - sourceStart);
  const targetDurationMs = targetDurationForMode(targetDurationMode, sourceDurationMs);
  const bySlot = new Map<string, SlotTiming>();

  sorted.forEach((entry, index) => {
    const sourceStartMs = entry.timing.startMs;
    const sourceEndMs = entry.timing.endMs;
    const nextSourceStartMs = sorted[index + 1]?.timing.startMs ?? sourceEnd;
    const targetStartMs = Math.round(((sourceStartMs - sourceStart) / sourceDurationMs) * targetDurationMs);
    const targetEndMs = index === sorted.length - 1
      ? targetDurationMs
      : Math.max(targetStartMs + 1, Math.round(((nextSourceStartMs - sourceStart) / sourceDurationMs) * targetDurationMs));
    bySlot.set(entry.slot.id, {
      sourceStartMs,
      sourceEndMs,
      targetStartMs,
      targetEndMs: Math.min(targetDurationMs, Math.max(targetEndMs, targetStartMs + 1))
    });
  });

  return { bySlot, sourceDurationMs, targetDurationMs, targetDurationMode };
}

function targetDurationForMode(mode: TargetDurationMode, sourceDurationMs: number): number {
  switch (mode) {
    case 'source_preserve':
      return sourceDurationMs;
    case 'high_click_15s':
      return Math.min(sourceDurationMs, 15000);
    case 'full_story_30s':
      return Math.min(sourceDurationMs, 30000);
    case 'high_conversion_20s':
    default:
      return Math.min(sourceDurationMs, 20000);
  }
}

function buildRenderProfile(graph: ViralStructureGraph): OrchestratedTimeline['renderProfile'] {
  const aspectRatio = graph.meta.aspectRatio === 'unknown' ? DEFAULT_ASPECT_RATIO : graph.meta.aspectRatio;
  const dimensions: Record<typeof aspectRatio, { width: number; height: number }> = {
    '9:16': { width: 1080, height: 1920 },
    '16:9': { width: 1920, height: 1080 },
    '1:1': { width: 1080, height: 1080 }
  };
  const size = dimensions[aspectRatio];
  return { width: size.width, height: size.height, fps: 30, aspectRatio };
}

// --- motif / category -------------------------------------------------------

function findMotif(
  slot: ShotSlotNode,
  targetCategory: string,
  categoryPreset?: CategoryPreset
): ViralMotifAnnotation | undefined {
  const existing = slot.motifAnnotations?.find((annotation) => annotation.motifType !== undefined);
  if (existing) {
    return existing;
  }
  return extractViralMotifAnnotation({ slot, targetCategory, preset: categoryPreset });
}

function inferTargetCategory(brief: ContentBrief, categoryPreset?: CategoryPreset): string {
  if (categoryPreset?.category) {
    return normalizeCategory(categoryPreset.category);
  }
  if (brief.category) {
    return normalizeCategory(brief.category);
  }
  const text = [brief.productName, brief.scenario, brief.stylePreference, ...(brief.sellingPoints ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (/beverage|drink|tea|iced|红茶|饮料|冰/.test(text)) {
    return 'beverage';
  }
  return 'unknown';
}

// --- helpers ----------------------------------------------------------------

function safeSourceIntent(purpose: string | undefined): string | undefined {
  if (!purpose) return undefined;
  return containsSourceSpecificTerm(purpose) ? undefined : purpose;
}

function buildSlotText(slot: ShotSlotNode): string {
  return [
    slot.intent?.purpose,
    slot.intent?.motionPattern,
    slot.sourceInstance?.specificAction,
    slot.requiredAsset.subject
  ]
    .filter(Boolean)
    .join(' ');
}

function humanRole(role: string): string {
  return role.replace(/_/g, ' ');
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function buildReusableAssetPacks(args: {
  slots: OrchestratedSlot[];
  contentBrief: ContentBrief;
}): ReusableAssetPackPlan[] {
  const slotIdsByRole = (roles: string[]): string[] =>
    args.slots.filter((slot) => roles.includes(slot.role)).map((slot) => slot.slotId);
  const motifSlotIds = args.slots
    .filter((slot) => slot.motifType === 'kinetic_assembly_reveal' || (slot.motionTokens ?? []).includes('component_cascade'))
    .map((slot) => slot.slotId);
  const product = args.contentBrief.productName;
  const packs: ReusableAssetPackPlan[] = [
    {
      id: 'pack_product_hero_reveal',
      packType: 'product_hero_reveal',
      title: '产品英雄亮相包',
      status: 'required',
      recommendedChannel: 'reshoot',
      promptSummary: `拍摄 ${product} 竖屏英雄亮相，标签清晰、入画有冲击力。`,
      targetSlots: slotIdsByRole(['opening_attention', 'product_closeup']),
      referencedAssetIds: [],
      ownership: 'director_handoff_plan_only'
    },
    {
      id: 'pack_product_closeup',
      packType: 'product_closeup',
      title: '产品标签特写包',
      status: 'required',
      recommendedChannel: 'reshoot',
      promptSummary: `补充 ${product} 瓶身、标签、冷凝水和包装细节，支持特写与卖点证明。`,
      targetSlots: slotIdsByRole(['product_closeup', 'benefit_visual']),
      referencedAssetIds: [],
      ownership: 'director_handoff_plan_only'
    },
    {
      id: 'pack_cap_open_usage',
      packType: 'cap_open_usage',
      title: '开盖使用动作包',
      status: 'required',
      recommendedChannel: 'reshoot',
      promptSummary: '补拍手部开盖、瓶身拿起和第一口饮用动作，提供真实使用证据。',
      targetSlots: slotIdsByRole(['usage_demo', 'technique_demo']),
      referencedAssetIds: [],
      ownership: 'director_handoff_plan_only'
    },
    {
      id: 'pack_pour_or_drink_usage',
      packType: 'pour_or_drink_usage',
      title: '倒入/饮用动作包',
      status: 'required',
      recommendedChannel: 'reshoot',
      promptSummary: '补拍倒入杯中、茶色流动或颈部以下饮用镜头，增强使用过程可信度。',
      targetSlots: slotIdsByRole(['usage_demo']),
      referencedAssetIds: [],
      ownership: 'director_handoff_plan_only'
    },
    {
      id: 'pack_cold_condensation_macro',
      packType: 'cold_condensation_macro',
      title: '冰爽微距包',
      status: 'required',
      recommendedChannel: 'hyperframes',
      promptSummary: '用冷凝水、冰块、柠檬片、茶滴微距强化冰爽和夏日感。',
      targetSlots: slotIdsByRole(['benefit_visual', 'product_closeup']),
      referencedAssetIds: [],
      ownership: 'director_handoff_plan_only'
    },
    {
      id: 'pack_motif_assembly_reveal',
      packType: 'motif_assembly_reveal',
      title: '结构动机迁移包',
      status: motifSlotIds.length ? 'required' : 'optional',
      recommendedChannel: 'aigc',
      promptSummary: '把源片的级联汇聚、由散到聚、激活爆发迁移为冰块/柠檬/茶滴/冷雾围绕产品形成 CTA 收口。',
      targetSlots: motifSlotIds,
      referencedAssetIds: [],
      ownership: 'director_handoff_plan_only'
    },
    {
      id: 'pack_transition_ice_lemon',
      packType: 'transition_ice_lemon_pack',
      title: '冰柠转场元素包',
      status: 'optional',
      recommendedChannel: 'hyperframes',
      promptSummary: '准备冰块雨、柠檬片扫过、茶色旋涡和冷雾擦除，用于镜头之间的语义承接。',
      targetSlots: args.slots.map((slot) => slot.slotId),
      referencedAssetIds: [],
      ownership: 'director_handoff_plan_only'
    },
    {
      id: 'pack_cta_lockup',
      packType: 'cta_lockup',
      title: 'CTA 结尾锁定包',
      status: 'required',
      recommendedChannel: 'hyperframes',
      promptSummary: `制作 ${product} 干净尾帧、行动号召和产品定格，明确购买/尝鲜引导。`,
      targetSlots: slotIdsByRole(['cta_visual']),
      referencedAssetIds: [],
      ownership: 'director_handoff_plan_only'
    },
    {
      id: 'pack_lineup_social_proof',
      packType: 'lineup_social_proof',
      title: '多瓶陈列/分享包',
      status: 'optional',
      recommendedChannel: 'reshoot',
      promptSummary: '补充多瓶陈列、朋友分享或货架场景，支持社交证明和对比段落。',
      targetSlots: slotIdsByRole(['comparison', 'testimonial']),
      referencedAssetIds: [],
      ownership: 'director_handoff_plan_only'
    }
  ];
  return packs;
}

// SegmentNode is referenced only for its time fields; keep the import meaningful for readers.
function secondsToMs(seconds: SegmentNode['start']): number {
  return Math.max(0, Math.round(seconds * 1000));
}
