import type {
  PreservedStructureFunction,
  ProductComplexity,
  ProductIntelligence,
  ProofType,
  SegmentNode,
  ShotSlotNode,
  StructuralCompressionBeat,
  StructuralCompressionDecision,
  TargetDurationMode,
  TargetEquivalentFamily,
  ViralStructureGraph
} from '@viral-struct/shared';

/**
 * Structural Compression Planner (P0-B).
 *
 * The legacy timeline maps every source shotSlot 1:1 into the target (proportional time-scaling), so a
 * 229s / 27-slot MacBook tour becomes 27 sub-second machine-gun beats with 53% of the runtime still
 * spent on feature explanation. This planner instead RE-BUDGETS the source's functional skeleton (its
 * segments, which already carry functional roles) into a small canonical TARGET arc of ~6-8 beats whose
 * count and family are decided by Product Intelligence (complexity + proof types) + the duration preset.
 *
 * Output is a rewritten graph (shotSlots = the K representative slots) + a budgeted timing plan, so the
 * existing Director machinery (matcher / fill ladder / transitions / channel authoring) runs unchanged on
 * K beats instead of 27 slots. Deterministic by design (testable, demo-stable); LLM refinement is a
 * future option. See docs/product-intelligence-optimization-plan.md §3 (P0-B).
 */

export interface CompressionSlotTiming {
  sourceStartMs: number;
  sourceEndMs: number;
  targetStartMs: number;
  targetEndMs: number;
}

export interface StructuralCompressionPlan {
  /** Rewritten graph whose shotSlots are the K representative beats. */
  graph: ViralStructureGraph;
  /** Budgeted timing keyed by representative slot id. */
  timingBySlot: Map<string, CompressionSlotTiming>;
  sourceDurationMs: number;
  targetDurationMs: number;
  /** Beat metadata keyed by representative slot id (attached to OrchestratedSlot.compressionBeat). */
  beatBySlotId: Map<string, StructuralCompressionBeat>;
  beats: StructuralCompressionBeat[];
}

export interface PlanStructuralCompressionInput {
  structureGraph: ViralStructureGraph;
  productIntelligence: ProductIntelligence;
  targetDurationMode: TargetDurationMode;
}

const MIN_BEAT_MS = 800;

const CANONICAL_FUNCTION_ORDER: Record<PreservedStructureFunction, number> = {
  attention_hook: 0,
  context_setup: 1,
  product_reveal: 2,
  feature_or_benefit_proof: 3,
  usage_or_ritual: 4,
  social_or_trust_proof: 5,
  emotional_payoff: 6,
  cta_lockup: 7
};

const FUNCTION_WEIGHT: Record<PreservedStructureFunction, number> = {
  attention_hook: 1.2,
  context_setup: 0.8,
  product_reveal: 1.0,
  feature_or_benefit_proof: 1.0,
  usage_or_ritual: 1.3,
  social_or_trust_proof: 1.0,
  emotional_payoff: 1.1,
  cta_lockup: 1.0
};

interface SegmentInfo {
  segment: SegmentNode;
  slots: ShotSlotNode[];
  representativeSlot: ShotSlotNode;
  startMs: number;
  endMs: number;
  func: PreservedStructureFunction;
}

interface BeatDraft {
  func: PreservedStructureFunction;
  chunk: SegmentInfo[];
  family: TargetEquivalentFamily;
  decision: StructuralCompressionDecision;
  proofType: ProofType;
}

export function planStructuralCompression(input: PlanStructuralCompressionInput): StructuralCompressionPlan {
  const { structureGraph: graph, productIntelligence: pi } = input;
  const targetDurationMode = input.targetDurationMode;

  const segmentInfos = buildSegmentInfos(graph);
  const sourceDurationMs = Math.max(
    1,
    Math.max(...segmentInfos.map((s) => s.endMs), 1) - Math.min(...segmentInfos.map((s) => s.startMs), 0)
  );
  const targetDurationMs = targetDurationForMode(targetDurationMode, sourceDurationMs);

  // Group source segments by functional role, then cap the count of target beats per function by complexity.
  const caps = capsForComplexity(pi.complexity);
  const byFunction = new Map<PreservedStructureFunction, SegmentInfo[]>();
  for (const info of segmentInfos) {
    const group = byFunction.get(info.func) ?? [];
    group.push(info);
    byFunction.set(info.func, group);
  }

  const drafts: BeatDraft[] = [];
  for (const [func, group] of byFunction) {
    const cap = caps[func] ?? 1;
    if (cap <= 0) continue; // dropped function family (e.g. context_setup at low complexity)
    const ordered = [...group].sort((a, b) => a.startMs - b.startMs);
    const chunks = splitIntoChunks(ordered, Math.min(cap, ordered.length));
    chunks.forEach((chunk, indexWithinFunction) => {
      const family = pickTargetFamily(func, indexWithinFunction, pi.complexity, pi.recommendedProofTypes);
      drafts.push({
        func,
        chunk,
        family,
        decision: decideStrategy(func, chunk.length, family, pi.complexity),
        proofType: pickProofType(func, pi.recommendedProofTypes)
      });
    });
  }

  // Canonical target arc order: hook → reveal → feature/benefit → usage → social → payoff → cta.
  drafts.sort((a, b) =>
    (CANONICAL_FUNCTION_ORDER[a.func] - CANONICAL_FUNCTION_ORDER[b.func])
    || (a.chunk[0]?.startMs ?? 0) - (b.chunk[0]?.startMs ?? 0)
  );

  const timings = allocateDurations(drafts.map((d) => FUNCTION_WEIGHT[d.func]), targetDurationMs);

  const beats: StructuralCompressionBeat[] = [];
  const beatBySlotId = new Map<string, StructuralCompressionBeat>();
  const timingBySlot = new Map<string, CompressionSlotTiming>();
  const representativeSlots: ShotSlotNode[] = [];

  drafts.forEach((draft, index) => {
    const rep = pickRepresentative(draft.chunk);
    const mergedSegmentIds = draft.chunk.map((c) => c.segment.id);
    const mergedSlotIds = draft.chunk.flatMap((c) => c.slots.map((s) => s.id));
    const beat: StructuralCompressionBeat = {
      beatId: `beat_${String(index + 1).padStart(2, '0')}_${draft.func}`,
      preservedStructureFunction: draft.func,
      sourceFunctionFamily: draft.chunk.map((c) => c.segment.role).join('+'),
      targetEquivalentFamily: draft.family,
      targetEquivalentBeat: buildBeatNL(draft.func, draft.family, pi),
      compressionDecision: draft.decision,
      compressionReason: buildReason(draft, pi.complexity),
      proofType: draft.proofType,
      mergedSourceSegmentIds: mergedSegmentIds,
      mergedSourceSlotIds: mergedSlotIds
    };
    const sourceStartMs = Math.min(...draft.chunk.map((c) => c.startMs));
    const sourceEndMs = Math.max(...draft.chunk.map((c) => c.endMs));
    beats.push(beat);
    beatBySlotId.set(rep.id, beat);
    timingBySlot.set(rep.id, {
      sourceStartMs,
      sourceEndMs,
      targetStartMs: timings[index].startMs,
      targetEndMs: timings[index].endMs
    });
    representativeSlots.push(rep);
  });

  return {
    graph: { ...graph, shotSlots: representativeSlots },
    timingBySlot,
    sourceDurationMs,
    targetDurationMs,
    beatBySlotId,
    beats
  };
}

// ---------------------------------------------------------------------------
// Source-side preparation
// ---------------------------------------------------------------------------

function buildSegmentInfos(graph: ViralStructureGraph): SegmentInfo[] {
  const slotsBySegment = new Map<string, ShotSlotNode[]>();
  for (const slot of graph.shotSlots) {
    const group = slotsBySegment.get(slot.segmentId) ?? [];
    group.push(slot);
    slotsBySegment.set(slot.segmentId, group);
  }
  return graph.segments
    .map((segment) => {
      const slots = slotsBySegment.get(segment.id) ?? [];
      if (slots.length === 0) return undefined;
      return {
        segment,
        slots,
        representativeSlot: pickHighestImportanceSlot(slots),
        startMs: secondsToMs(segment.start),
        endMs: Math.max(secondsToMs(segment.end), secondsToMs(segment.start) + 1),
        func: roleToFunction(segment.role)
      } satisfies SegmentInfo;
    })
    .filter((info): info is SegmentInfo => Boolean(info))
    .sort((a, b) => a.startMs - b.startMs);
}

function pickHighestImportanceSlot(slots: ShotSlotNode[]): ShotSlotNode {
  return [...slots].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))[0];
}

function pickRepresentative(chunk: SegmentInfo[]): ShotSlotNode {
  const topSegment = [...chunk].sort((a, b) => (b.segment.importance ?? 0) - (a.segment.importance ?? 0))[0];
  return topSegment.representativeSlot;
}

/** Split `items` (already in source order) into `count` contiguous, roughly even chunks. */
function splitIntoChunks<T>(items: T[], count: number): T[][] {
  if (count <= 1) return items.length ? [items] : [];
  const chunks: T[][] = [];
  const base = Math.floor(items.length / count);
  let remainder = items.length % count;
  let cursor = 0;
  for (let c = 0; c < count; c += 1) {
    const size = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    chunks.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return chunks.filter((chunk) => chunk.length > 0);
}

function roleToFunction(role: string): PreservedStructureFunction {
  const r = role.toLowerCase();
  if (/(hook|opening|attention)/.test(r)) return 'attention_hook';
  if (/(intro|context|problem|need)/.test(r)) return 'context_setup';
  if (/(reveal)/.test(r)) return 'product_reveal';
  if (/(usage|demo|use|tutorial|technique)/.test(r)) return 'usage_or_ritual';
  if (/(social|testimonial|proof|review|comparison)/.test(r)) return 'social_or_trust_proof';
  if (/(payoff|emotion|climax)/.test(r)) return 'emotional_payoff';
  if (/(cta|call_to_action|closing|close)/.test(r)) return 'cta_lockup';
  // selling_point / feature / benefit and any unmatched role → feature/benefit proof
  return 'feature_or_benefit_proof';
}

// ---------------------------------------------------------------------------
// Budget rules (PI-driven)
// ---------------------------------------------------------------------------

function capsForComplexity(complexity: ProductComplexity): Record<PreservedStructureFunction, number> {
  const base: Record<PreservedStructureFunction, number> = {
    attention_hook: 1,
    context_setup: 1,
    product_reveal: 1,
    feature_or_benefit_proof: 2,
    usage_or_ritual: 2,
    social_or_trust_proof: 1,
    emotional_payoff: 1,
    cta_lockup: 1
  };
  if (complexity === 'low_complexity_impulse_product') {
    // collapse feature-heavy explanation hard; drop standalone context.
    return { ...base, context_setup: 0, feature_or_benefit_proof: 2, usage_or_ritual: 2 };
  }
  if (complexity === 'medium_complexity_lifestyle_product') {
    return { ...base, feature_or_benefit_proof: 3, usage_or_ritual: 2 };
  }
  // high complexity keeps more explanatory / risk-reducing beats.
  return { ...base, feature_or_benefit_proof: 4, usage_or_ritual: 3 };
}

function pickTargetFamily(
  func: PreservedStructureFunction,
  indexWithinFunction: number,
  complexity: ProductComplexity,
  proofTypes: ProofType[]
): TargetEquivalentFamily {
  const sensory = proofTypes.includes('sensory_proof');
  const feature = proofTypes.includes('feature_proof');
  switch (func) {
    case 'attention_hook':
      return sensory ? 'sensory_cascade' : 'feature_demo';
    case 'context_setup':
      return 'benefit_proof';
    case 'product_reveal':
      return feature && complexity === 'high_complexity_feature_product' ? 'feature_demo' : 'benefit_proof';
    case 'feature_or_benefit_proof':
      if (complexity === 'high_complexity_feature_product' || (feature && !sensory)) return 'feature_demo';
      return indexWithinFunction === 0 && sensory ? 'sensory_cascade' : 'benefit_proof';
    case 'usage_or_ritual':
      return indexWithinFunction === 0 ? 'ritual_activation' : 'benefit_proof';
    case 'social_or_trust_proof':
      return complexity === 'high_complexity_feature_product' ? 'trust_scene' : 'social_scene';
    case 'emotional_payoff':
      return 'burst_payoff';
    case 'cta_lockup':
    default:
      return 'cta_lockup';
  }
}

function decideStrategy(
  func: PreservedStructureFunction,
  chunkSize: number,
  family: TargetEquivalentFamily,
  complexity: ProductComplexity
): StructuralCompressionDecision {
  if (chunkSize > 1) return 'merge';
  if (
    func === 'feature_or_benefit_proof'
    && complexity === 'low_complexity_impulse_product'
    && (family === 'sensory_cascade' || family === 'benefit_proof')
  ) {
    return 'replace';
  }
  return 'keep';
}

function pickProofType(func: PreservedStructureFunction, proofTypes: ProofType[]): ProofType {
  switch (func) {
    case 'attention_hook':
      return proofTypes.includes('sensory_proof') ? 'sensory_proof' : (proofTypes[0] ?? 'feature_proof');
    case 'usage_or_ritual':
      return proofTypes.includes('usage_proof') ? 'usage_proof' : (proofTypes[0] ?? 'usage_proof');
    case 'social_or_trust_proof':
      return proofTypes.includes('social_proof') ? 'social_proof' : 'trust_proof';
    case 'feature_or_benefit_proof':
      return proofTypes.includes('sensory_proof') ? 'sensory_proof' : (proofTypes.includes('feature_proof') ? 'feature_proof' : (proofTypes[0] ?? 'feature_proof'));
    case 'cta_lockup':
      return 'claim_proof';
    default:
      return proofTypes[0] ?? 'feature_proof';
  }
}

// ---------------------------------------------------------------------------
// Target-equivalent natural language (neutral; feeds prompt context)
// ---------------------------------------------------------------------------

function buildBeatNL(func: PreservedStructureFunction, family: TargetEquivalentFamily, pi: ProductIntelligence): string {
  const name = pi.productName;
  const sensory = topValues(pi.sensoryCues, 3);
  const benefits = topValues(pi.coreBenefits, 3);
  const rituals = topValues(pi.usageRituals, 3);
  const social = topValues(pi.socialContexts, 2);
  const cascadeNL = `把"由散到聚"的结构动势迁移成 ${name} 的感官汇聚：${sensory.join('、') || '感官元素'}围绕产品高速掠入并收束成一次冷冽利落的 reveal`;
  const benefitNL = `用感官化方式归纳核心利益：${benefits.join('、') || '核心卖点'}`;
  const ritualNL = `真人完成 ${name} 的真实使用激活：${rituals.join('、') || '开盖、使用'}`;
  const socialNL = `${social.join('、') || '日常使用'}的社交场景，${name} 作为共享中心`;

  switch (func) {
    case 'attention_hook':
      return `先给强感官钩子：${sensory.slice(0, 2).join('、') || '强视觉冲击'}快速逼近 ${name}，先制造"想要"的冲动而不是讲道理`;
    case 'context_setup':
      return benefitNL;
    case 'product_reveal':
      return `${name} 包装/标签清晰亮相，完成品牌识别`;
    case 'feature_or_benefit_proof':
      return family === 'sensory_cascade' ? cascadeNL : family === 'feature_demo' ? `演示 ${name} 的关键功能与价值点：${benefits.join('、') || '核心卖点'}` : benefitNL;
    case 'usage_or_ritual':
      return family === 'social_scene' ? socialNL : ritualNL;
    case 'social_or_trust_proof':
      return family === 'trust_scene' ? `用可信证据（资质/口碑/真实评价）强化 ${name} 的信任感` : socialNL;
    case 'emotional_payoff':
      return `情绪/感官释放的高点：${sensory.slice(0, 2).join('、') || '爽感'}爆发后收束`;
    case 'cta_lockup':
    default:
      return `${name} 包装/瓶身 hero + 行动号召收口`;
  }
}

function buildReason(draft: BeatDraft, complexity: ProductComplexity): string {
  const segs = draft.chunk.map((c) => c.segment.role).join('+');
  if (draft.decision === 'merge') {
    return `${draft.chunk.length} 个源「${segs}」段在 ${complexity} 预算下合并为 1 个目标 ${draft.family} beat。`;
  }
  if (draft.decision === 'replace') {
    return `源「${segs}」(偏功能解释) 在 ${complexity} 下替换成目标品类等价的 ${draft.family}。`;
  }
  return `源「${segs}」功能保留，映射为目标 ${draft.family}。`;
}

function topValues(facts: ProductIntelligence['coreBenefits'], n: number): string[] {
  return facts.slice(0, n).map((f) => f.value).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

function allocateDurations(weights: number[], targetDurationMs: number): Array<{ startMs: number; endMs: number }> {
  const out: Array<{ startMs: number; endMs: number }> = [];
  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
  let cursor = 0;
  weights.forEach((weight, index) => {
    const isLast = index === weights.length - 1;
    const remainingBeats = weights.length - index;
    const raw = Math.round((weight / totalWeight) * targetDurationMs);
    // keep enough room for the remaining beats' minimum, and let the last beat absorb rounding.
    const maxForThis = targetDurationMs - cursor - (remainingBeats - 1) * MIN_BEAT_MS;
    const dur = isLast ? targetDurationMs - cursor : Math.min(Math.max(raw, MIN_BEAT_MS), Math.max(MIN_BEAT_MS, maxForThis));
    const startMs = cursor;
    const endMs = Math.max(startMs + 1, isLast ? targetDurationMs : startMs + dur);
    out.push({ startMs, endMs });
    cursor = endMs;
  });
  return out;
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

function secondsToMs(seconds: number): number {
  return Math.round(seconds * 1000);
}
