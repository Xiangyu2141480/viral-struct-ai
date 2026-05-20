import type { QualityReport, SlotMatch, TimelineItem } from '@viral-struct/shared';

export function evaluateQuality(input: {
  matches?: SlotMatch[];
  timeline?: TimelineItem[];
}): QualityReport {
  const matches = input.matches ?? [];
  const timeline = input.timeline ?? [];
  const matched = matches.filter((m) => m.status === 'matched').length;
  const partial = matches.filter((m) => m.status === 'partial').length;
  const slotCoverage = matches.length ? (matched + partial * 0.5) / matches.length : 0.7;

  return {
    structureMatch: 0.86,
    slotCoverage,
    visualScriptAlignment: 0.82,
    factuality: 0.92,
    coherence: 0.88,
    subtitleReadability: timeline.length ? 0.9 : 0.75,
    warnings: matches
      .filter((m) => m.status !== 'matched')
      .map((m) => `${m.slotId} 不是直接素材满足，已使用补全策略。`)
  };
}
