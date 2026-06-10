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
  ProductIntelligence,
  ReusableAssetPackPlan,
  SegmentNode,
  ShotSlotNode,
  SlotFillGap,
  SlotFillMatched,
  SlotMatch,
  StructuralCompressionBeat,
  TargetDurationMode,
  ViralMotifAnnotation,
  ViralStructureGraph
} from '@viral-struct/shared';
import { OrchestratedTimelineSchema } from '@viral-struct/shared';
import { planStructuralCompression, beatOwnsSensoryCascade, type CompressionSlotTiming } from './structuralCompressionPlanner';
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
  /**
   * P0-B (opt-in): when provided, re-budget the source's functional skeleton into a small canonical
   * target arc (~6-8 beats) instead of mapping every source slot 1:1. Default (omitted) keeps the
   * legacy proportional per-slot timing so existing behavior/tests are unchanged.
   */
  structuralCompression?: { productIntelligence: ProductIntelligence };
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
  const targetDurationMode = input.targetDurationMode ?? DEFAULT_TARGET_DURATION_MODE;

  // P0-B (opt-in): re-budget the functional skeleton into ~6-8 canonical beats. When enabled we run the
  // whole pipeline on the rewritten (K representative slot) graph + a budgeted timing plan; otherwise we
  // keep the legacy 1:1 proportional timing on the original 27 slots.
  const compression = input.structuralCompression
    ? planStructuralCompression({
        structureGraph,
        productIntelligence: input.structuralCompression.productIntelligence,
        targetDurationMode
      })
    : undefined;
  const workingGraph = compression?.graph ?? structureGraph;
  const beatBySlotId = compression?.beatBySlotId ?? new Map<string, StructuralCompressionBeat>();

  const assetSupplyContext =
    (!compression && input.assetSupplyContext)
      ? input.assetSupplyContext
      : buildAssetSupplyContext({
          structureGraph: workingGraph,
          assetCards,
          contentBrief,
          categoryPreset: input.categoryPreset
        });

  const match = await runMatch(input, workingGraph);
  const matchBySlot = new Map(match.matches.map((entry) => [entry.slotId, entry]));
  const coverageBySlot = new Map(
    (assetSupplyContext.contextualCoverage?.slotCoverages ?? []).map((coverage) => [coverage.slotId, coverage])
  );
  const briefBySlot = new Map(
    (assetSupplyContext.missingMaterialBriefs ?? []).map((brief) => [brief.affectedSlotId, brief])
  );
  const legacyTimingPlan = compression ? undefined : computeSlotTimings(structureGraph, targetDurationMode);
  const timings: Map<string, CompressionSlotTiming> = compression ? compression.timingBySlot : legacyTimingPlan!.bySlot;
  const sourceDurationMs = compression?.sourceDurationMs ?? legacyTimingPlan!.sourceDurationMs;
  const targetDurationMs = compression?.targetDurationMs ?? legacyTimingPlan!.targetDurationMs;

  const warnings = match.warning ? [match.warning] : [];

  const slots: OrchestratedSlot[] = workingGraph.shotSlots.map((slot) => {
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
    const gate = evaluateSourceSpecificGate({ slot, structureGraph: workingGraph, motif });
    const compressionBeat = beatBySlotId.get(slot.id);
    const fillStatus = decideFillStatus({
      slot,
      match: slotMatch,
      coverage,
      motif,
      gateBlocked: gate.blocked,
      gateReasons: gate.reasons
    });
    const tier = fillStatusToTier(fillStatus, slotMatch);
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
      motif,
      compressionBeat
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
      compressionBeat,
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
      sourceDurationMs,
      targetDurationMs,
      targetDurationMode,
      planOnly: true
    },
    warnings
  };

  return OrchestratedTimelineSchema.parse(timeline);
}

// --- matching ---------------------------------------------------------------

async function runMatch(input: BuildOrchestratedTimelineInput, graph: ViralStructureGraph): Promise<MatchSlotsResultWithSource> {
  if (input.useLlmMatcher === false) {
    const result = matchSlots(graph, input.assetCards, input.boundaries);
    return {
      matches: result.matches.map((entry) => ({ ...entry, alignmentSource: 'rule_based' as const })),
      gaps: result.gaps,
      alignmentSource: 'rule_based'
    };
  }
  return matchSlotsWithFallback({
    graph,
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
  if (args.gateBlocked && hasTransferableSourceSpecificGrammar(args)) {
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

  if (!hasAsset || quality < PARTIAL_THRESHOLD) {
    return 'missing_generation_required';
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

function hasTransferableSourceSpecificGrammar(args: DecideFillStatusArgs): boolean {
  return Boolean(args.motif)
    || args.gateReasons.length > 0
    || sanitizeMotionGrammarText(buildSlotText(args.slot)).motionTokens.length > 0
    || hasRawSourceSpecificSemantics(args.slot);
}

function isDirectVisualRole(role: string): boolean {
  return role === 'opening_attention' || role === 'product_closeup' || role === 'cover' || role === 'cta_visual';
}

function hasRawSourceSpecificSemantics(slot: ShotSlotNode): boolean {
  const lower = buildSlotText(slot).toLowerCase();
  return /keyboard|touchpad|rocket|hardware|side port|interface|camera|chip|screen|grille|module/.test(lower)
    || /键盘|触控板|火箭|硬件功能|接口|摄像头|芯片|屏幕|格栅|脚垫|侧边按键|机身侧边|部件归位|功能部件/.test(lower);
}

function fillStatusToTier(status: DirectorFillStatus, match?: SlotMatch): 'matched' | 'partial' | 'gap' {
  if (status === 'matched') return 'matched';
  if (status === 'missing_generation_required') return 'gap';
  if (!match?.assetId) return 'gap';
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
  compressionBeat?: StructuralCompressionBeat;
}

function buildFill(args: BuildFillArgs): SlotFillMatched | SlotFillGap {
  const roleLabel = humanRole(args.slot.role);
  // 由散到聚 / 汇聚 / 组装 belongs ONLY to the single beat that owns the sensory-cascade reveal. For every
  // other compressed beat, gate the source cascade grammar out of the prompts so it does not bleed across
  // the whole video (the hook / benefit / usage / cta beats then express their own target function).
  const gateSourceCascade = Boolean(args.compressionBeat) && !beatOwnsSensoryCascade(args.compressionBeat);

  if (args.tier === 'matched') {
    const assetId = args.slotMatch?.assetId as string;
    // A covered beat still carries all three channels as ALTERNATIVES (替代/增强方案): use the real asset
    // by default, but hand the editor reshoot / HyperFrames / AIGC job-card options should they want to
    // re-shoot, polish, or regenerate the beat. status:'matched' keeps the real asset primary downstream.
    const { options, recommendedOptionId } = buildGapResolutionOptions({
      slot: args.slot,
      tier: 'matched',
      coverage: args.coverage,
      missingBrief: args.brief,
      assetSupplyContext: args.assetSupplyContext,
      contentBrief: args.contentBrief,
      referenceAssetIds: args.referenceAssetIds,
      chosenAssetId: args.slotMatch?.assetId,
      motionTokens: args.motionTokens,
      fillStatus: args.fillStatus,
      motif: args.motif,
      gateSourceCascade
    });
    return {
      kind: 'matched',
      assetId,
      matchQuality: matchQuality(args.slotMatch),
      matchedCriteria: args.slotMatch?.matchedCriteria ?? [],
      treatmentSpec: toTreatmentSpec(args.slotMatch),
      status: 'matched',
      mediaStartSec: args.slotMatch?.mediaStartSec,
      mediaEndSec: args.slotMatch?.mediaEndSec,
      videoEngineInstruction:
        `直接使用素材 ${assetId} 承接「${roleLabel}」槽位${treatmentSummary(args.slotMatch)}；保持原素材真实画面，不声明外部生成。`
        + `如需替代或增强，可选「${recommendedOptionId}」等方案（补拍 / HyperFrames / AIGC 任务卡），默认仍用原素材。`,
      options,
      recommendedOptionId,
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
      motif: args.motif,
      gateSourceCascade
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
      mediaStartSec: args.slotMatch?.mediaStartSec,
      mediaEndSec: args.slotMatch?.mediaEndSec,
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
    motif: args.motif,
    gateSourceCascade
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
  return containsDirectorSourceSpecificTerm(purpose) ? undefined : purpose;
}

function containsDirectorSourceSpecificTerm(text: string): boolean {
  return containsSourceSpecificTerm(text)
    || /MacBook|Apple|laptop|keyboard|trackpad|touchpad|screen|port|interface|camera|hinge|chassis|rocket|hardware|purchase window|multi[-_\s]?window|system interaction/i.test(text)
    || /笔记本|苹果|键盘|触控板|屏幕|接口|摄像头|机身|火箭|购买窗口|硬件功能|硬件|开合结构|闭合|按键|功能部件|多窗口|系统交互|侧边/.test(text);
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
  const slotIdsByPredicate = (predicate: (slot: OrchestratedSlot) => boolean): string[] => {
    const ids = args.slots.filter(predicate).map((slot) => slot.slotId);
    return ids.length ? ids : args.slots.map((slot) => slot.slotId).slice(0, 1);
  };
  const slotIdsByRole = (roles: string[]): string[] => slotIdsByPredicate((slot) => roles.includes(slot.role));
  const actionsByPredicate = (predicate: (slot: OrchestratedSlot) => boolean, fallback: string): string => {
    const matchingSlots = args.slots.filter(predicate);
    const vocabulary = packActionVocabulary(matchingSlots.length ? matchingSlots : args.slots);
    return vocabulary.slice(0, 5).join('、') || fallback;
  };
  const motifSlotIds = slotIdsByPredicate((slot) =>
    slot.motifType === 'kinetic_assembly_reveal'
    || (slot.motionTokens ?? []).includes('component_cascade')
    || slot.sourceAbstraction?.subtype === 'kinetic_assembly_reveal'
  );
  const heroActions = actionsByPredicate(
    (slot) => slot.role === 'opening_attention' || slot.sourceAbstraction?.subtype === 'opening_transform',
    '强开场入场、产品英雄亮相、hook 标题定格'
  );
  const closeupActions = actionsByPredicate(
    (slot) => slot.role === 'product_closeup' || slot.sourceAbstraction?.subtype === 'interface_detail',
    '瓶盖特写、标签扫光、冷凝水擦除、瓶身微距'
  );
  const usageActions = actionsByPredicate(
    (slot) => slot.role === 'usage_demo' || slot.role === 'technique_demo',
    '开盖动作、倒茶入杯、饮用动作、手部互动'
  );
  const benefitActions = actionsByPredicate(
    (slot) => slot.role === 'benefit_visual' || slot.sourceAbstraction?.subtype === 'assembly_detail',
    '冰块汇聚、柠檬片扫过、茶滴环绕、卖点卡落下'
  );
  const motifActions = actionsByPredicate(
    (slot) => motifSlotIds.includes(slot.slotId),
    '冰块级联、柠檬片扫过、红茶水滴汇聚、开盖激活、CTA 收口'
  );
  const transitionActions = actionsByPredicate(
    (slot) => Boolean(slot.sourceAbstraction) || (slot.motionTokens?.length ?? 0) > 0,
    '镜头运动、卖点承接、产品定格'
  );
  const ctaActions = actionsByPredicate(
    (slot) => slot.role === 'cta_visual' || slot.sourceAbstraction?.subtype === 'cta_lockup',
    '多瓶阵列、产品定格、CTA 留白、购买引导弹出'
  );
  const socialActions = actionsByPredicate(
    (slot) => slot.role === 'comparison'
      || slot.role === 'testimonial'
      || slot.sourceAbstraction?.subtype === 'device_handoff',
    '手递产品、通勤场景切换、朋友分享、多瓶陈列'
  );
  const product = args.contentBrief.productName;
  const packs: ReusableAssetPackPlan[] = [
    {
      id: 'pack_product_hero_reveal',
      packType: 'product_hero_reveal',
      title: '产品英雄亮相包',
      status: 'required',
      recommendedChannel: 'reshoot',
      promptSummary: `根据 opening / hero 槽位补齐 ${product} 竖屏英雄亮相；重点动作：${heroActions}；标签清晰、入画有冲击力。`,
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
      promptSummary: `从 product_closeup / detail 槽位聚类生成：补充 ${product} 的包装、标签、材质和关键卖点视觉证据；动作参考：${closeupActions}。`,
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
      promptSummary: `从 usage_demo 槽位聚类生成：补齐真实使用动作和手部/场景证据；优先动作：${usageActions}。`,
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
      promptSummary: `根据 usage_demo 的 motionTokens 与 target equivalents 生成连续动作素材包；用于增强使用过程可信度，覆盖：${usageActions}。`,
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
      promptSummary: `从 benefit / product evidence 槽位聚类生成质感证明素材；使用目标品类等价元素：${benefitActions || closeupActions}。`,
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
      promptSummary: `从 motif / motionTokens 聚类生成：保留级联、由散到聚、激活、爆发、收口的抽象语法；目标动作：${motifActions}。仅任务卡，不代表已生成。`,
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
      promptSummary: `从相邻 slot 的 motionTokens/sourceAbstraction 聚类生成转场元素；用于镜头之间的语义承接：${transitionActions}。`,
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
      promptSummary: `根据 cta_visual / lockup 槽位聚类生成 ${product} 结尾定格、行动号召和产品收口画面；使用：${ctaActions}。`,
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
      promptSummary: `从 comparison / testimonial / device_handoff 槽位聚类生成陈列、分享或证明素材；支持对比和社交证明：${socialActions}。`,
      targetSlots: slotIdsByRole(['comparison', 'testimonial']),
      referencedAssetIds: [],
      ownership: 'director_handoff_plan_only'
    }
  ];
  return packs;
}

function packActionVocabulary(slots: OrchestratedSlot[]): string[] {
  return unique(
    slots.flatMap((slot) => [
      ...(slot.sourceAbstraction?.targetEquivalentActions ?? []),
      ...(slot.motionTokens ?? []).map((token) => tokenToPackAction(token)),
      slot.sourceAbstraction?.targetEquivalentLabel
    ])
      .filter((value): value is string => Boolean(value))
      .filter((value) => !containsSourceSpecificTerm(value))
  );
}

function tokenToPackAction(token: string): string {
  const table: Record<string, string> = {
    dynamic_entry: '动感入场',
    component_cascade: '元素级联',
    chaos_to_order: '由散到聚',
    assembly_completion: '完成定格',
    interaction_activation: '交互激活',
    spectacle_burst: '爆发瞬间',
    cta_reveal: 'CTA 收口',
    snap_open: '开启动作',
    bottle_rotation: '产品旋转',
    lineup_sweep: '阵列扫过',
    card_drop: '卡片落下',
    clean_hold: '干净定格'
  };
  return table[token] ?? token;
}

// SegmentNode is referenced only for its time fields; keep the import meaningful for readers.
function secondsToMs(seconds: SegmentNode['start']): number {
  return Math.max(0, Math.round(seconds * 1000));
}
