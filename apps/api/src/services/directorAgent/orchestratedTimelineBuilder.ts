import type {
  AssetCard,
  AssetSupplyContext,
  Boundary,
  ContentBrief,
  ContextualSlotCoverage,
  MissingMaterialBrief,
  OrchestratedSlot,
  OrchestratedSlotEvidence,
  OrchestratedTimeline,
  OrchestratedTreatmentSpec,
  SegmentNode,
  ShotSlotNode,
  SlotFillGap,
  SlotFillMatched,
  SlotMatch,
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
import { DEFAULT_ASPECT_RATIO, DEFAULT_HYPERFRAMES_TRANSITION_WEIGHT } from './constants';

type LlmClient = ReturnType<typeof createOpenAICompatibleClient>;

const MATCHED_THRESHOLD = 0.85;
const PARTIAL_THRESHOLD = 0.45;

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
  const timings = computeSlotTimings(structureGraph);

  const warnings = match.warning ? [match.warning] : [];

  const slots: OrchestratedSlot[] = structureGraph.shotSlots.map((slot) => {
    const slotMatch = matchBySlot.get(slot.id);
    const coverage = coverageBySlot.get(slot.id);
    const brief = briefBySlot.get(slot.id);
    const timing = timings.get(slot.id) ?? { startMs: 0, endMs: 1000 };
    const motif = findMotif(slot, targetCategory, input.categoryPreset);
    const gate = evaluateSourceSpecificGate({ slot, structureGraph, motif });
    const tier = decideTier(slotMatch, gate.blocked);
    const referenceAssetIds = selectReferenceAssetIds(slotMatch, coverage, assetCards);
    const evidence = buildEvidence(coverage, slotMatch, gate.reasons);
    const motionTokens = sanitizeMotionGrammarText(buildSlotText(slot)).motionTokens;
    const transferableIntent = motionTokens.length > 0
      ? sanitizeMotionGrammarText(slot.intent?.purpose ?? buildSlotText(slot)).sanitizedIntent
      : undefined;

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
      evidence
    });

    return {
      slotId: slot.id,
      segmentId: slot.segmentId,
      role: slot.role,
      index: 0,
      startMs: timing.startMs,
      endMs: timing.endMs,
      // sourceIntent is provenance only; drop it whenever it carries source-product-specific semantics
      // so the raw source intent can never leak through the handoff (§12; mirrors the PR #60 leak fix).
      sourceIntent: safeSourceIntent(slot.intent?.purpose),
      transferableIntent,
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
    meta: {
      productName: contentBrief.productName,
      targetCategory,
      matchSource: match.alignmentSource,
      generatedAt: '1970-01-01T00:00:00.000Z',
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
      videoEngineInstruction: `Use ${assetId} directly for the ${roleLabel} slot${treatmentSummary(args.slotMatch)}.`,
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
      motionTokens: args.motionTokens
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
        `Place ${assetId}, then enhance via the recommended "${recommendedOptionId}" option`
        + `${missing ? ` to satisfy: ${missing}` : ''}.`,
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
    motionTokens: args.motionTokens
  });
  return {
    kind: 'gap',
    reason: args.slotMatch?.missingDescription || args.slotMatch?.reason || `No asset can support the ${roleLabel} slot.`,
    missing: args.slotMatch?.missingDescription || `usable material for the ${roleLabel} slot`,
    recommendedOptionId,
    options,
    videoEngineInstruction:
      `No matched asset; execute the recommended "${recommendedOptionId}" option as a plan/job card to fill the ${roleLabel} slot.`,
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
  const parts = [spec.motion, spec.syncPoint ? `sync on ${spec.syncPoint}` : undefined].filter(Boolean);
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

function computeSlotTimings(graph: ViralStructureGraph): Map<string, { startMs: number; endMs: number }> {
  const out = new Map<string, { startMs: number; endMs: number }>();
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
      out.set(slot.id, { startMs: slotStart, endMs: Math.max(slotEnd, slotStart + 1) });
    });
  }

  return out;
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

// SegmentNode is referenced only for its time fields; keep the import meaningful for readers.
function secondsToMs(seconds: SegmentNode['start']): number {
  return Math.max(0, Math.round(seconds * 1000));
}
