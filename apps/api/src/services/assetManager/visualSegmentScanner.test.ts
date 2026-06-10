import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildVisualCandidatesFromFrameDiffs,
  buildVisualSegmentationProfile,
  parseSceneCutCandidates,
  scanVisualSegments
} from './visualSegmentScanner';

test('buildVisualSegmentationProfile does not slice a continuous long video just because it is long', () => {
  const profile = buildVisualSegmentationProfile({
    durationSec: 40,
    boundaryCandidates: [
      { timeSec: 19, source: 'visual_peak', confidence: 0.18, score: 0.3, reason: 'minor camera drift' }
    ]
  });

  assert.equal(profile.shouldSlice, false);
  assert.equal(profile.boundaryCandidates.length, 0);
  assert.equal(profile.boundaryConfidence, 0);
  assert.ok(profile.warnings.some((warning) => warning.includes('continuous')));
});

test('buildVisualSegmentationProfile keeps reliable hard cuts and motion changes as slice boundaries', () => {
  const profile = buildVisualSegmentationProfile({
    durationSec: 26.2,
    boundaryCandidates: [
      { timeSec: 4.1, source: 'hard_cut', confidence: 0.92, score: 0.9, reason: 'shot cut' },
      { timeSec: 9.8, source: 'motion_regime', confidence: 0.8, score: 0.78, reason: 'motion state change' },
      { timeSec: 15.7, source: 'hard_cut', confidence: 0.86, score: 0.82, reason: 'shot cut' },
      { timeSec: 21.2, source: 'hard_cut', confidence: 0.83, score: 0.79, reason: 'shot cut' }
    ]
  });

  assert.equal(profile.shouldSlice, true);
  assert.equal(profile.hardCutCount, 3);
  assert.equal(profile.motionChangeCount, 1);
  assert.deepEqual(profile.boundaryCandidates.map((candidate) => candidate.timeSec), [4.1, 9.8, 15.7, 21.2]);
  assert.ok(profile.boundaryConfidence > 0.8);
});

test('buildVisualSegmentationProfile drops cutpoints that would create sub-three-second fragments', () => {
  const profile = buildVisualSegmentationProfile({
    durationSec: 12,
    minSegmentDurationSec: 3,
    boundaryCandidates: [
      { timeSec: 1.2, source: 'hard_cut', confidence: 0.95, score: 0.95, reason: 'too close to start' },
      { timeSec: 2.5, source: 'hard_cut', confidence: 0.93, score: 0.93, reason: 'would create short segment' },
      { timeSec: 4.1, source: 'hard_cut', confidence: 0.9, score: 0.9, reason: 'valid cut' },
      { timeSec: 5.4, source: 'hard_cut', confidence: 0.88, score: 0.88, reason: 'too close to previous' },
      { timeSec: 8.3, source: 'hard_cut', confidence: 0.87, score: 0.87, reason: 'valid cut' }
    ]
  });

  assert.deepEqual(profile.boundaryCandidates.map((candidate) => candidate.timeSec), [4.1, 8.3]);
  assert.equal(profile.shouldSlice, true);
});

test('scanVisualSegments falls back to one continuous segment when ffmpeg is unavailable', async () => {
  const profile = await scanVisualSegments({
    filePath: 'missing.mp4',
    durationSec: 18,
    ffmpegPath: 'C:/definitely/missing/ffmpeg.exe'
  });

  assert.equal(profile.shouldSlice, false);
  assert.deepEqual(profile.boundaryCandidates, []);
  assert.ok(profile.warnings.some((warning) => warning.includes('ffmpeg')));
});

test('buildVisualCandidatesFromFrameDiffs emits motion and peak candidates from low-fps frame changes', () => {
  const width = 2;
  const height = 2;
  const frames = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [240, 240, 240, 240],
    [245, 245, 245, 245],
    [10, 10, 10, 10],
    [10, 10, 10, 10]
  ];
  const buffer = Buffer.from(frames.flat());

  const candidates = buildVisualCandidatesFromFrameDiffs({ buffer, width, height, fps: 1 });

  assert.ok(candidates.some((candidate) => candidate.source === 'visual_peak'));
  assert.ok(candidates.some((candidate) => candidate.source === 'motion_regime'));
  assert.ok(candidates.every((candidate) => candidate.timeSec > 0));
});

test('parseSceneCutCandidates maps ffmpeg scene scores to non-uniform hard-cut confidence', () => {
  const candidates = parseSceneCutCandidates(`
    [Parsed_showinfo_2 @ 000001] n:0 pts:5050000 pts_time:5.05 pos:-1 fmt:yuv420p
    [Parsed_metadata_1 @ 000001] lavfi.scene_score=0.312345
    [Parsed_showinfo_2 @ 000002] n:1 pts:14100000 pts_time:14.1 pos:-1 fmt:yuv420p
    [Parsed_metadata_1 @ 000002] lavfi.scene_score=0.827654
  `);

  assert.deepEqual(candidates.map((candidate) => candidate.timeSec), [5.05, 14.1]);
  assert.equal(candidates[0].source, 'hard_cut');
  assert.ok(candidates[1].confidence > candidates[0].confidence);
  assert.ok(candidates[0].reason.includes('scene_score=0.3123'));
  assert.ok(candidates[1].reason.includes('scene_score=0.8277'));
});
