import type { Boundary, QualityReport, SlotMatch, TimelineItem } from '@viral-struct/shared';

export function evaluateQuality(input: {
  matches?: SlotMatch[];
  timeline?: TimelineItem[];
  boundaries?: Boundary[];
}): QualityReport {
  const matches = input.matches ?? [];
  const timeline = input.timeline ?? [];
  const boundaries = input.boundaries;
  const matched = matches.filter((m) => m.status === 'matched').length;
  const partial = matches.filter((m) => m.status === 'partial').length;
  const slotCoverage = matches.length ? (matched + partial * 0.5) / matches.length : 0.7;

  const report: QualityReport = {
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

  const transitionFidelity = computeTransitionFidelity(timeline, boundaries);
  if (transitionFidelity !== undefined) {
    report.transitionFidelity = transitionFidelity;
  }
  return report;
}

type PackagingTransition = NonNullable<TimelineItem['packaging']['transition']>;
type SourceTransition = Boundary['transitionType'];

const TRANSITION_FAMILY: Record<SourceTransition, 'hard' | 'soft' | 'motion' | null> = {
  cut: 'hard',
  fade: 'soft',
  dissolve: 'soft',
  morph: 'motion',
  wipe: 'motion',
  unknown: null
};

const PACKAGING_FAMILY: Record<PackagingTransition, 'hard' | 'soft' | 'motion'> = {
  quick_cut: 'hard',
  zoom_in: 'motion',
  push: 'motion',
  fade: 'soft'
};

function sameFamily(src: SourceTransition, planned: PackagingTransition | undefined): boolean {
  if (!planned) return false;
  const srcFam = TRANSITION_FAMILY[src];
  if (!srcFam) return false;
  return PACKAGING_FAMILY[planned] === srcFam;
}

function computeTransitionFidelity(
  timeline: TimelineItem[],
  boundaries: Boundary[] | undefined
): number | undefined {
  if (!boundaries?.length) return undefined;
  if (timeline.length === 0) return 0;
  const matches = boundaries.filter((b) => {
    const item = timeline.find((t) => t.sourceSegmentId === b.from);
    if (!item) return false;
    return sameFamily(b.transitionType, item.packaging.transition);
  }).length;
  return Number((matches / boundaries.length).toFixed(3));
}
