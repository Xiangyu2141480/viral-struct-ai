import type { AudioCue, BeatSyncMap } from '@viral-struct/shared';
import type { AudioVariant } from './sonicMotifMapper';

export interface BuildBeatSyncMapInput {
  cues: AudioCue[];
  durationSec: number;
  variant: AudioVariant;
}

export function buildBeatSyncMap(input: BuildBeatSyncMapInput): BeatSyncMap {
  const bpm = chooseBpm(input.variant);
  const beatInterval = 60 / bpm;
  const beatTimes: number[] = [];
  for (let time = 0; time <= input.durationSec + 0.001; time += beatInterval) {
    beatTimes.push(Number(time.toFixed(2)));
  }

  return {
    id: `beat_sync_${input.variant}`,
    bpm,
    beatTimes,
    syncPoints: input.cues.map((cue) => ({
      time: cue.startTime,
      targetId: cue.syncTarget,
      reason: `${cue.cueType} supports ${cue.narrativeFunction}`
    })),
    warnings: [
      'Beat map is an offline plan only; no BGM analysis or audio mixing has been performed.'
    ]
  };
}

function chooseBpm(variant: AudioVariant): number {
  if (variant === 'high_click') {
    return 128;
  }
  if (variant === 'premium') {
    return 92;
  }
  return 112;
}
