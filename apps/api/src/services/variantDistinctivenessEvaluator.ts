import type { TimelineItem } from '@viral-struct/shared';

export type DemoGenerationVariant = 'high_click' | 'high_conversion' | 'premium';

export function evaluateVariantDistinctiveness(input: {
  timeline?: TimelineItem[];
  generationVariant?: DemoGenerationVariant;
}): { score: number; explanation: string } {
  const timeline = input.timeline ?? [];
  if (!timeline.length) {
    return { score: 0, explanation: 'No timeline is available, so variant distinctiveness is 0.' };
  }

  const durations = timeline.map((item) => item.end - item.start).filter((value) => Number.isFinite(value) && value > 0);
  const durationSpread = durations.length ? (Math.max(...durations) - Math.min(...durations)) / Math.max(...durations) : 0;
  const uniqueCardTypes = new Set(timeline.map((item) => item.packaging.cardType).filter(Boolean)).size;
  const quickCuts = timeline.filter((item) => item.packaging.transition === 'quick_cut').length / timeline.length;
  const ctaItems = timeline.filter((item) => item.segmentRole === 'cta' || /立即|现在|下单|来一瓶|购买/.test(item.script)).length / timeline.length;
  const lowCaptionItems = timeline.filter((item) => item.subtitles.length <= 1).length / timeline.length;

  const variantSignal = input.generationVariant === 'high_click'
    ? 0.42 * quickCuts + 0.28 * cardDiversity(uniqueCardTypes) + 0.30 * durationSpread
    : input.generationVariant === 'high_conversion'
      ? 0.45 * ctaItems + 0.25 * cardDiversity(uniqueCardTypes) + 0.30 * sellingPointDensity(timeline)
      : input.generationVariant === 'premium'
        ? 0.44 * lowCaptionItems + 0.28 * restrainedMotion(timeline) + 0.28 * cardDiversity(uniqueCardTypes)
        : 0.34 * cardDiversity(uniqueCardTypes) + 0.33 * durationSpread + 0.33 * quickCuts;

  return {
    score: round(clamp01(0.25 + variantSignal) * 100),
    explanation: `Deterministic variant estimate from packaging variety, duration spread, transition rhythm, and ${input.generationVariant ?? 'current'} strategy cues.`
  };
}

function cardDiversity(count: number): number {
  return Math.min(1, count / 3);
}

function sellingPointDensity(timeline: TimelineItem[]): number {
  return timeline.filter((item) => item.segmentRole === 'selling_point' || /冰爽|柠檬|卖点|解腻|benefit/i.test(item.script)).length / timeline.length;
}

function restrainedMotion(timeline: TimelineItem[]): number {
  return timeline.filter((item) => item.packaging.motion === 'static' || item.packaging.transition === 'fade').length / timeline.length;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Number(value.toFixed(1));
}
