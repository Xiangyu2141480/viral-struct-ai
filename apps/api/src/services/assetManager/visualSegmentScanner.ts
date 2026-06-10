import { spawn } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import type {
  AssetVideoBoundaryCandidate,
  AssetVideoBoundarySource,
  VisualSegmentationProfile
} from '@viral-struct/shared';

export interface BuildVisualSegmentationProfileInput {
  durationSec: number;
  boundaryCandidates: AssetVideoBoundaryCandidate[];
  minSegmentDurationSec?: number;
  maxSegments?: number;
  confidenceFloor?: number;
}

export interface ScanVisualSegmentsInput {
  filePath: string;
  durationSec?: number;
  ffmpegPath?: string;
  sceneThreshold?: number;
  frameDiffFps?: number;
  probeWidth?: number;
  probeHeight?: number;
  minSegmentDurationSec?: number;
  maxSegments?: number;
}

const DEFAULT_MIN_SEGMENT_DURATION_SEC = 3;
const DEFAULT_MAX_SEGMENTS = 32;
const DEFAULT_CONFIDENCE_FLOOR = 0.45;
const DEFAULT_SCENE_THRESHOLD = 0.3;
const DEFAULT_FRAME_DIFF_FPS = 2;
const DEFAULT_PROBE_WIDTH = 32;
const DEFAULT_PROBE_HEIGHT = 18;
const DEFAULT_HARD_CUT_FALLBACK_CONFIDENCE = 0.68;

export async function scanVisualSegments(input: ScanVisualSegmentsInput): Promise<VisualSegmentationProfile> {
  const durationSec = normalizeTime(input.durationSec ?? 0);
  if (durationSec <= 0) {
    return buildVisualSegmentationProfile({
      durationSec,
      boundaryCandidates: [],
      minSegmentDurationSec: input.minSegmentDurationSec,
      maxSegments: input.maxSegments
    });
  }

  let ffmpegPath: string;
  try {
    ffmpegPath = resolveFfmpegPath(input.ffmpegPath);
  } catch (error) {
    const profile = buildVisualSegmentationProfile({
      durationSec,
      boundaryCandidates: [],
      minSegmentDurationSec: input.minSegmentDurationSec,
      maxSegments: input.maxSegments
    });
    return {
      ...profile,
      warnings: [...profile.warnings, `ffmpeg scene scan failed: ${errorMessage(error)}`]
    };
  }

  const warnings: string[] = [];
  const boundaryCandidates: AssetVideoBoundaryCandidate[] = [];

  try {
    boundaryCandidates.push(...await detectHardCuts({
      filePath: input.filePath,
      ffmpegPath,
      sceneThreshold: input.sceneThreshold ?? DEFAULT_SCENE_THRESHOLD
    }));
  } catch (error) {
    warnings.push(`ffmpeg hard-cut scan failed: ${errorMessage(error)}`);
  }

  try {
    boundaryCandidates.push(...await detectFrameDiffCandidates({
      filePath: input.filePath,
      ffmpegPath,
      fps: input.frameDiffFps ?? DEFAULT_FRAME_DIFF_FPS,
      width: input.probeWidth ?? DEFAULT_PROBE_WIDTH,
      height: input.probeHeight ?? DEFAULT_PROBE_HEIGHT
    }));
  } catch (error) {
    warnings.push(`ffmpeg frame-diff scan failed: ${errorMessage(error)}`);
  }

  const profile = buildVisualSegmentationProfile({
    durationSec,
    boundaryCandidates,
    minSegmentDurationSec: input.minSegmentDurationSec,
    maxSegments: input.maxSegments
  });
  return { ...profile, warnings: [...profile.warnings, ...warnings] };
}

export function buildVisualCandidatesFromFrameDiffs(input: {
  buffer: Buffer;
  width: number;
  height: number;
  fps: number;
}): AssetVideoBoundaryCandidate[] {
  const frameSize = Math.max(1, Math.floor(input.width * input.height));
  const frameCount = Math.floor(input.buffer.length / frameSize);
  const fps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : DEFAULT_FRAME_DIFF_FPS;
  if (frameCount < 2) return [];

  const diffs: Array<{ timeSec: number; score: number }> = [];
  for (let frameIndex = 1; frameIndex < frameCount; frameIndex++) {
    const previousOffset = (frameIndex - 1) * frameSize;
    const currentOffset = frameIndex * frameSize;
    let sum = 0;
    for (let pixel = 0; pixel < frameSize; pixel++) {
      sum += Math.abs(input.buffer[currentOffset + pixel] - input.buffer[previousOffset + pixel]);
    }
    diffs.push({
      timeSec: normalizeTime(frameIndex / fps),
      score: Number((sum / frameSize / 255).toFixed(4))
    });
  }

  const candidates: AssetVideoBoundaryCandidate[] = [];
  for (let index = 0; index < diffs.length; index++) {
    const current = diffs[index];
    const previous = diffs[index - 1]?.score ?? current.score;
    const next = diffs[index + 1]?.score ?? current.score;
    const delta = Math.max(Math.abs(current.score - previous), Math.abs(current.score - next));

    if (current.score >= 0.3 && current.score >= previous && current.score >= next) {
      candidates.push({
        timeSec: current.timeSec,
        source: 'visual_peak',
        confidence: clamp01(0.58 + current.score * 0.42),
        score: current.score,
        reason: `low-fps frame diff visual peak score=${current.score}`
      });
    }

    if (delta >= 0.22) {
      candidates.push({
        timeSec: current.timeSec,
        source: 'motion_regime',
        confidence: clamp01(0.55 + delta * 0.45),
        score: delta,
        reason: `low-fps motion regime change delta=${Number(delta.toFixed(4))}`
      });
    }
  }

  return candidates;
}

export function buildVisualSegmentationProfile(input: BuildVisualSegmentationProfileInput): VisualSegmentationProfile {
  const durationSec = normalizeTime(input.durationSec);
  const minSegmentDurationSec = Math.max(0.1, input.minSegmentDurationSec ?? DEFAULT_MIN_SEGMENT_DURATION_SEC);
  const maxSegments = Math.max(1, Math.floor(input.maxSegments ?? DEFAULT_MAX_SEGMENTS));
  const confidenceFloor = input.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR;
  const warnings: string[] = [];

  if (durationSec < minSegmentDurationSec) {
    return {
      durationSec,
      shouldSlice: false,
      boundaryCandidates: [],
      hardCutCount: 0,
      motionChangeCount: 0,
      visualPeakCount: 0,
      boundaryConfidence: 0,
      warnings: [`visual segmentation: clip shorter than ${minSegmentDurationSec}s, keep as one segment.`]
    };
  }

  const eligible = sanitizeCandidates(input.boundaryCandidates, durationSec)
    .filter((candidate) => candidate.confidence >= confidenceFloor)
    .filter((candidate) => candidate.source !== 'visual_peak' || candidate.confidence >= 0.75);

  const selected = selectCutpoints({
    candidates: eligible,
    durationSec,
    minSegmentDurationSec,
    maxSegments
  });

  if (selected.length === 0) {
    warnings.push('visual segmentation: continuous clip, no reliable split boundary.');
  }

  return {
    durationSec,
    shouldSlice: selected.length > 0,
    boundaryCandidates: selected,
    hardCutCount: selected.filter((candidate) => candidate.source === 'hard_cut').length,
    motionChangeCount: selected.filter((candidate) => candidate.source === 'motion_regime').length,
    visualPeakCount: selected.filter((candidate) => candidate.source === 'visual_peak').length,
    boundaryConfidence: selected.length ? average(selected.map((candidate) => candidate.confidence)) : 0,
    warnings
  };
}

function selectCutpoints(input: {
  candidates: AssetVideoBoundaryCandidate[];
  durationSec: number;
  minSegmentDurationSec: number;
  maxSegments: number;
}): AssetVideoBoundaryCandidate[] {
  const sorted = input.candidates
    .slice()
    .sort((a, b) => {
      const priority = sourcePriority(b.source) - sourcePriority(a.source);
      if (priority !== 0) return priority;
      return b.confidence - a.confidence;
    });

  const selected: AssetVideoBoundaryCandidate[] = [];
  for (const candidate of sorted) {
    if (selected.length >= input.maxSegments - 1) break;
    const proposed = [...selected, candidate].sort((a, b) => a.timeSec - b.timeSec);
    if (allWindowsMeetMinimum(proposed, input.durationSec, input.minSegmentDurationSec)) {
      selected.push(candidate);
    }
  }

  return selected.sort((a, b) => a.timeSec - b.timeSec);
}

function allWindowsMeetMinimum(
  candidates: AssetVideoBoundaryCandidate[],
  durationSec: number,
  minSegmentDurationSec: number
): boolean {
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.timeSec - cursor < minSegmentDurationSec) return false;
    cursor = candidate.timeSec;
  }
  return durationSec - cursor >= minSegmentDurationSec;
}

function sanitizeCandidates(candidates: AssetVideoBoundaryCandidate[], durationSec: number): AssetVideoBoundaryCandidate[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      timeSec: normalizeTime(candidate.timeSec),
      confidence: clamp01(candidate.confidence),
      score: Math.max(0, Number.isFinite(candidate.score) ? Number(candidate.score.toFixed(4)) : 0),
      reason: candidate.reason.trim() || `${candidate.source} boundary`
    }))
    .filter((candidate) => candidate.timeSec > 0 && candidate.timeSec < durationSec)
    .filter((candidate, index, items) =>
      items.findIndex((other) => Math.abs(other.timeSec - candidate.timeSec) < 0.05) === index
    );
}

function sourcePriority(source: AssetVideoBoundarySource): number {
  if (source === 'manual') return 5;
  if (source === 'hard_cut') return 4;
  if (source === 'motion_regime') return 3;
  if (source === 'visual_peak') return 2;
  return 1;
}

function detectHardCuts(input: {
  filePath: string;
  ffmpegPath: string;
  sceneThreshold: number;
}): Promise<AssetVideoBoundaryCandidate[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.ffmpegPath, [
      '-hide_banner',
      '-i',
      input.filePath,
      '-vf',
      `select='gt(scene,${input.sceneThreshold})',metadata=print,showinfo`,
      '-f',
      'null',
      '-'
    ], { windowsHide: true });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', () => {
      resolve(parseSceneCutCandidates(stderr));
    });
  });
}

function detectFrameDiffCandidates(input: {
  filePath: string;
  ffmpegPath: string;
  fps: number;
  width: number;
  height: number;
}): Promise<AssetVideoBoundaryCandidate[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.ffmpegPath, [
      '-hide_banner',
      '-i',
      input.filePath,
      '-vf',
      `fps=${input.fps},scale=${input.width}:${input.height},format=gray`,
      '-an',
      '-f',
      'rawvideo',
      '-'
    ], { windowsHide: true });

    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && chunks.length === 0) {
        reject(new Error(stderr.trim() || `ffmpeg frame-diff scan exited with code ${code}`));
        return;
      }
      resolve(buildVisualCandidatesFromFrameDiffs({
        buffer: Buffer.concat(chunks),
        width: input.width,
        height: input.height,
        fps: input.fps
      }));
    });
  });
}

export function parseSceneCutCandidates(stderr: string): AssetVideoBoundaryCandidate[] {
  const entries: Array<{ timeSec: number; sceneScore?: number }> = [];
  let pendingSceneScore: number | undefined;

  for (const line of stderr.split(/\r?\n/)) {
    const sceneScore = parseSceneScore(line);
    if (sceneScore !== undefined) {
      const target = [...entries].reverse().find((entry) => entry.sceneScore === undefined);
      if (target) {
        target.sceneScore = sceneScore;
      } else {
        pendingSceneScore = sceneScore;
      }
      continue;
    }

    const timeSec = parsePtsTime(line);
    if (timeSec === undefined) continue;
    const normalized = normalizeTime(timeSec);
    const existing = entries.find((entry) => Math.abs(entry.timeSec - normalized) < 0.01);
    if (existing) {
      if (pendingSceneScore !== undefined && existing.sceneScore === undefined) {
        existing.sceneScore = pendingSceneScore;
        pendingSceneScore = undefined;
      }
      continue;
    }

    entries.push({ timeSec: normalized, sceneScore: pendingSceneScore });
    pendingSceneScore = undefined;
  }

  return entries
    .filter((entry) => entry.timeSec > 0)
    .sort((a, b) => a.timeSec - b.timeSec)
    .map((entry, index) => {
      const confidence = entry.sceneScore === undefined
        ? DEFAULT_HARD_CUT_FALLBACK_CONFIDENCE
        : sceneScoreToHardCutConfidence(entry.sceneScore);
      const score = entry.sceneScore === undefined ? confidence : clamp01(entry.sceneScore);
      const sceneScoreText = entry.sceneScore === undefined
        ? 'scene_score unavailable'
        : `scene_score=${formatScore(entry.sceneScore)}`;
      return {
        timeSec: entry.timeSec,
        source: 'hard_cut',
        confidence,
        score,
        reason: `ffmpeg scene-detect hard cut ${index + 1}; ${sceneScoreText}`
      };
    });
}

function parsePtsTime(line: string): number | undefined {
  const match = /pts_time:([0-9]+(?:\.[0-9]+)?)/.exec(line);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function parseSceneScore(line: string): number | undefined {
  const match = /lavfi\.scene_score=([0-9]+(?:\.[0-9]+)?)/.exec(line);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

function sceneScoreToHardCutConfidence(sceneScore: number): number {
  return clamp01(0.52 + clamp01(sceneScore) * 0.48);
}

function formatScore(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function resolveFfmpegPath(configured?: string): string {
  const binary = configured?.trim() || process.env.FFMPEG_PATH?.trim() || ffmpegStatic;
  if (!binary) throw new Error('ffmpeg binary was not found.');
  return binary;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function normalizeTime(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(3));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
