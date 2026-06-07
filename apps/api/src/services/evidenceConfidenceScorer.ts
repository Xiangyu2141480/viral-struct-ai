import type {
  GapRepair,
  MaterialGap,
  MissingMaterialGenerationJob,
  SlotMatch,
  StoryboardFrame,
  TimelineItem
} from '@viral-struct/shared';

export function scoreEvidenceConfidence(input: {
  slotMatches?: SlotMatch[];
  materialGaps?: MaterialGap[];
  repairs?: GapRepair[];
  timeline?: TimelineItem[];
  storyboardFrames?: StoryboardFrame[];
  missingMaterialJobs?: MissingMaterialGenerationJob[];
}): { score: number; rowCount: number; explanation: string } {
  const timeline = input.timeline ?? [];
  const matches = input.slotMatches ?? [];
  const gaps = input.materialGaps ?? [];
  const repairs = input.repairs ?? [];
  const frames = input.storyboardFrames ?? [];
  const jobs = input.missingMaterialJobs ?? [];
  const rowCount = Math.max(timeline.length, matches.length, gaps.length, frames.length, jobs.length);

  if (!rowCount) {
    return {
      score: 0,
      rowCount: 0,
      explanation: 'No evidence rows are available yet, so confidence is 0 for the offline estimate.'
    };
  }

  const rowScores = Array.from({ length: rowCount }, (_, index) => {
    const item = timeline[index];
    const slotId = item?.slotId ?? matches[index]?.slotId ?? gaps[index]?.slotId ?? frames[index]?.slotId ?? jobs[index]?.gapId;
    const match = matches.find((entry) => entry.slotId === slotId) ?? matches[index];
    const gap = gaps.find((entry) => entry.slotId === slotId);
    const repair = repairs.find((entry) => entry.slotId === slotId);
    const frame = frames.find((entry) => entry.slotId === slotId || entry.timelineItemId === item?.id);
    const job = jobs.find((entry) => entry.gapId === slotId || entry.timelineItemId === item?.id);

    const matchScore = match ? (match.status === 'matched' ? 0.9 : match.status === 'partial' ? 0.65 : 0.35) * clamp01(match.score || 0.5) : 0.45;
    const repairScore = gap ? (repair ? 0.82 : 0.35) : 0.8;
    const frameScore = frame ? (frame.safetyStatus.status === 'passed' ? 0.86 : frame.safetyStatus.status === 'needs_review' ? 0.62 : 0.2) : 0.48;
    const jobScore = job ? (job.status === 'blocked' ? 0.35 : 0.78) : gap ? 0.46 : 0.72;

    return 0.35 * matchScore + 0.25 * repairScore + 0.25 * frameScore + 0.15 * jobScore;
  });

  const score = average(rowScores) * 100;
  return {
    score: round(score),
    rowCount,
    explanation: `Average confidence across ${rowCount} evidence row(s), combining slot match, repair, storyboard safety, and missing-material job status.`
  };
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
