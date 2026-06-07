import type {
  ContentBrief,
  DemoEstimate,
  DemoEstimateMetric,
  GapRepair,
  MaterialGap,
  MissingMaterialGenerationJob,
  QualityReport,
  SlotMatch,
  StoryboardFrame,
  TimelineItem,
  ViralStructureGraph
} from '@viral-struct/shared';
import { scoreEvidenceConfidence } from './evidenceConfidenceScorer';
import { evaluateVariantDistinctiveness, type DemoGenerationVariant } from './variantDistinctivenessEvaluator';

export interface DemoScoringEstimatorInput {
  structureGraph?: ViralStructureGraph | null;
  contentBrief?: ContentBrief;
  slotMatches?: SlotMatch[];
  materialGaps?: MaterialGap[];
  repairs?: GapRepair[];
  timeline?: TimelineItem[];
  storyboardFrames?: StoryboardFrame[];
  missingMaterialJobs?: MissingMaterialGenerationJob[];
  qualityReport?: QualityReport | null;
  generationVariant?: DemoGenerationVariant;
}

const templateFitFormula = '0.35*SlotMatchAvg + 0.20*SegmentCoverage + 0.20*BriefIntentAlignment + 0.15*RhythmCompatibility + 0.10*PackagingCompatibility';

export function estimateDemoAnalytics(input: DemoScoringEstimatorInput): DemoEstimate {
  const slotMatchAvg = average((input.slotMatches ?? []).map((match) => clamp01(match.score)));
  const segmentCoverage = computeSegmentCoverage(input.structureGraph, input.timeline);
  const briefIntentAlignment = computeBriefIntentAlignment(input.contentBrief, input.timeline);
  const rhythmCompatibility = computeRhythmCompatibility(input.structureGraph, input.timeline);
  const packagingCompatibility = computePackagingCompatibility(input.structureGraph, input.timeline);
  const templateFit = (
    0.35 * slotMatchAvg +
    0.20 * segmentCoverage +
    0.20 * briefIntentAlignment +
    0.15 * rhythmCompatibility +
    0.10 * packagingCompatibility
  ) * 100;
  const gapRepairCoverage = computeGapRepairCoverage(input.materialGaps ?? [], input.repairs ?? [], input.missingMaterialJobs ?? []);
  const evidence = scoreEvidenceConfidence({
    slotMatches: input.slotMatches,
    materialGaps: input.materialGaps,
    repairs: input.repairs,
    timeline: input.timeline,
    storyboardFrames: input.storyboardFrames,
    missingMaterialJobs: input.missingMaterialJobs
  });
  const variant = evaluateVariantDistinctiveness({
    timeline: input.timeline,
    generationVariant: input.generationVariant
  });
  const hookStrength = computeHookStrength(input.timeline);
  const packagingStrength = packagingCompatibility * 100;
  const ctaClarity = computeCtaClarity(input.contentBrief, input.timeline);
  const factuality = (input.qualityReport?.factuality ?? 0.7) * 100;
  const viralPotential = (
    0.25 * hookStrength +
    0.20 * templateFit +
    0.15 * gapRepairCoverage +
    0.15 * packagingStrength +
    0.10 * ctaClarity +
    0.10 * evidence.score +
    0.05 * factuality
  );
  const estimatedCtrLift = computeEstimatedCtrLift({
    viralPotential,
    templateFit,
    gapRepairCoverage,
    variantDistinctiveness: variant.score
  });

  return {
    disclaimer: 'Offline heuristic estimate. Not based on real user behavior.',
    generatedAt: deterministicTimestamp(input),
    metrics: {
      viralPotential: metric(round(viralPotential), 'Viral Potential Score', 'Weighted offline estimate from hook strength, template fit, repaired gaps, packaging, CTA clarity, evidence confidence, and factuality.', '0.25*HookStrength + 0.20*TemplateFit + 0.15*GapRepairCoverage + 0.15*PackagingStrength + 0.10*CTAClarity + 0.10*EvidenceConfidence + 0.05*Factuality'),
      templateFit: metric(round(templateFit), 'Template Fit Score', 'How well the new content fits the source structure using slot match, segment coverage, brief intent, rhythm, and packaging compatibility.', templateFitFormula),
      gapRepairCoverage: metric(round(gapRepairCoverage), 'Gap Repair Coverage', 'Weighted repaired high/medium/low material gaps divided by total weighted gaps, including planned external generation jobs.'),
      evidenceConfidence: metric(evidence.score, 'Evidence Confidence', evidence.explanation),
      variantDistinctiveness: metric(variant.score, 'Variant Distinctiveness', variant.explanation),
      estimatedCtrLift: {
        score: estimatedCtrLift,
        label: `Estimated CTR Lift +${estimatedCtrLift.toFixed(1)}% (simulated heuristic)`,
        explanation: 'Simulated heuristic only, derived from offline scores. It is not measured click-through data and not based on user sessions.',
        formula: 'Simulated lift = 2 + 0.055*ViralPotential + 0.025*TemplateFit + 0.018*GapRepairCoverage + 0.015*VariantDistinctiveness',
        simulated: true
      }
    },
    components: {
      slotMatchAvg: round(slotMatchAvg * 100),
      segmentCoverage: round(segmentCoverage * 100),
      briefIntentAlignment: round(briefIntentAlignment * 100),
      rhythmCompatibility: round(rhythmCompatibility * 100),
      packagingCompatibility: round(packagingCompatibility * 100),
      hookStrength: round(hookStrength),
      packagingStrength: round(packagingStrength),
      ctaClarity: round(ctaClarity),
      factuality: round(factuality)
    },
    warnings: [
      'All analytics are offline deterministic heuristics for demo explanation.',
      'Estimated CTR Lift is simulated and must not be presented as measured user behavior.'
    ]
  };
}

function computeSegmentCoverage(graph?: ViralStructureGraph | null, timeline?: TimelineItem[]): number {
  const segments = graph?.segments ?? [];
  if (!segments.length) return timeline?.length ? 0.65 : 0;
  const timelineSegmentIds = new Set((timeline ?? []).map((item) => item.sourceSegmentId));
  return clamp01(segments.filter((segment) => timelineSegmentIds.has(segment.id)).length / segments.length);
}

function computeBriefIntentAlignment(brief?: ContentBrief, timeline?: TimelineItem[]): number {
  if (!brief || !timeline?.length) return 0;
  const text = timeline.map((item) => `${item.script} ${item.visualAction} ${item.subtitles.join(' ')}`).join(' ');
  const terms = [brief.productName, brief.scenario, brief.cta, ...brief.sellingPoints].filter(Boolean);
  const hits = terms.filter((term) => text.includes(term)).length;
  return clamp01(0.35 + hits / Math.max(terms.length, 1) * 0.65);
}

function computeRhythmCompatibility(graph?: ViralStructureGraph | null, timeline?: TimelineItem[]): number {
  if (!timeline?.length) return 0;
  const avg = average(timeline.map((item) => Math.max(0.1, item.end - item.start)));
  const sourceAvg = graph?.rhythm.avgShotDuration ?? avg;
  const avgFit = 1 - Math.min(1, Math.abs(avg - sourceAvg) / Math.max(sourceAvg, 1));
  const quickCutFit = graph?.rhythm.cutFrequency === 'high'
    ? timeline.filter((item) => item.packaging.transition === 'quick_cut').length / timeline.length
    : 0.65;
  return clamp01(0.7 * avgFit + 0.3 * quickCutFit);
}

function computePackagingCompatibility(graph?: ViralStructureGraph | null, timeline?: TimelineItem[]): number {
  if (!timeline?.length) return 0;
  const targetCards = new Set<string>(graph?.packaging.cardTypes ?? []);
  const usedCards = timeline
    .map((item) => item.packaging.cardType)
    .filter((value): value is NonNullable<TimelineItem['packaging']['cardType']> => Boolean(value));
  const cardOverlap = targetCards.size
    ? usedCards.filter((card) => targetCards.has(card)).length / Math.max(usedCards.length, 1)
    : Math.min(1, usedCards.length / Math.max(timeline.length, 1));
  const transitionUse = timeline.filter((item) => Boolean(item.packaging.transition)).length / timeline.length;
  return clamp01(0.65 * cardOverlap + 0.35 * transitionUse);
}

function computeGapRepairCoverage(gaps: MaterialGap[], repairs: GapRepair[], jobs: MissingMaterialGenerationJob[]): number {
  const relevantGaps = gaps.filter((gap) => gap.severity === 'high' || gap.severity === 'medium' || gap.severity === 'low');
  if (!relevantGaps.length) return 100;
  const repairSlotIds = new Set(repairs.map((repair) => repair.slotId));
  const jobSlotIds = new Set(jobs.filter((job) => job.status !== 'blocked').map((job) => job.gapId));
  const total = relevantGaps.reduce((sum, gap) => sum + gapWeight(gap), 0);
  const repaired = relevantGaps.reduce((sum, gap) => {
    const covered = repairSlotIds.has(gap.slotId) || jobSlotIds.has(gap.slotId);
    return sum + (covered ? gapWeight(gap) : 0);
  }, 0);
  return total ? repaired / total * 100 : 100;
}

function computeHookStrength(timeline?: TimelineItem[]): number {
  const first = timeline?.[0];
  if (!first) return 0;
  const duration = Math.max(0.1, first.end - first.start);
  const shortHook = duration <= 3 ? 1 : Math.max(0.35, 1 - (duration - 3) / 5);
  const hasStrongCopy = /先|马上|热到|痛点|结果|别|看|冰|抓人/.test(first.script) ? 1 : 0.55;
  const hasMotion = first.packaging.transition === 'quick_cut' || first.packaging.motion === 'push_in' ? 1 : 0.6;
  return round((0.42 * shortHook + 0.34 * hasStrongCopy + 0.24 * hasMotion) * 100);
}

function computeCtaClarity(brief?: ContentBrief, timeline?: TimelineItem[]): number {
  const last = timeline?.at(-1);
  if (!last || !brief) return 0;
  const text = `${last.script} ${last.subtitles.join(' ')}`;
  const productHit = text.includes(brief.productName) ? 1 : 0.55;
  const ctaHit = brief.cta && text.includes(brief.cta.slice(0, Math.min(8, brief.cta.length))) ? 1 : /立即|现在|下单|购买|来一瓶|行动/.test(text) ? 0.85 : 0.45;
  const packagingHit = last.packaging.cardType === 'cta_card' ? 1 : 0.55;
  return round((0.38 * productHit + 0.42 * ctaHit + 0.20 * packagingHit) * 100);
}

function computeEstimatedCtrLift(input: {
  viralPotential: number;
  templateFit: number;
  gapRepairCoverage: number;
  variantDistinctiveness: number;
}): number {
  return Number((2 + 0.055 * input.viralPotential + 0.025 * input.templateFit + 0.018 * input.gapRepairCoverage + 0.015 * input.variantDistinctiveness).toFixed(1));
}

function metric(score: number, label: string, explanation: string, formula?: string): DemoEstimateMetric {
  return { score, label, explanation, formula };
}

function deterministicTimestamp(input: DemoScoringEstimatorInput): string {
  const count = (input.timeline?.length ?? 0) + (input.materialGaps?.length ?? 0) + (input.repairs?.length ?? 0);
  return `offline-estimate-v1-${count}`;
}

function gapWeight(gap: MaterialGap): number {
  if (gap.severity === 'high') return 3;
  if (gap.severity === 'medium') return 2;
  return 1;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Number(value.toFixed(1));
}
