import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import type { AigcBeatPlan, WanJob } from '@viral-struct/shared';
import { renderAigcTimeline } from './aigcRenderer';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CFG = { apiKey: 'k', baseUrl: 'https://host/api/v1', workspaceId: 'ws-1' };

function job(beatId: string): WanJob {
  return { beatId, model: 'wan2.7-r2v', prompt: 'p', media: [], parameters: { resolution: '720P', ratio: '9:16', duration: 3, promptExtend: false, watermark: true } };
}

const PLANS: AigcBeatPlan[] = [
  { kind: 'real_clip', beatId: 'b0', index: 0, startMs: 0, endMs: 1000, clipUrl: 'real0.mp4' },
  { kind: 'generate', beatId: 'b1', index: 1, startMs: 1000, endMs: 2000, job: job('b1') },
  { kind: 'generate', beatId: 'b2', index: 2, startMs: 2000, endMs: 3000, job: job('b2'), fallbackClipUrl: 'fb2.mp4' },
  { kind: 'generate', beatId: 'b3', index: 3, startMs: 3000, endMs: 4000, job: job('b3') }
];

test('renderAigcTimeline: resolves each beat (real/generated/fallback/failed) and stitches the survivors in order', async () => {
  const generate = (async (_cfg: any, j: WanJob) => {
    if (j.beatId === 'b1') return { beatId: 'b1', taskId: 't1', status: 'SUCCEEDED', videoUrl: 'https://oss/b1.mp4' };
    return { beatId: j.beatId, taskId: null, status: 'FAILED', error: 'boom' };
  }) as any;
  const download = async (_url: string, dest: string) => dest;
  let ffArgs: string[] = [];
  const runFfmpeg = async (args: string[]) => {
    ffArgs = args;
    return { code: 0, out: '' };
  };

  const result = await renderAigcTimeline(
    { plans: PLANS, outputPath: path.join(os.tmpdir(), 'aigc_out.mp4'), cfg: CFG, workDir: path.join(os.tmpdir(), 'aigc_test_work'), concurrency: 2 },
    { generate, download, runFfmpeg }
  );

  assert.equal(result.rendered, true);
  assert.equal(result.beats[0]!.source, 'real_clip');
  assert.equal(result.beats[1]!.source, 'generated');
  assert.equal(result.beats[2]!.source, 'fallback');
  assert.equal(result.beats[3]!.source, 'failed');

  // Survivors stitched in index order: real0, downloaded b1, fallback fb2; failed b3 dropped + warned.
  assert.ok(ffArgs.includes('real0.mp4'));
  assert.ok(ffArgs.some((a) => a.includes('beat_1.mp4')));
  assert.ok(ffArgs.includes('fb2.mp4'));
  assert.ok(result.warnings.some((w) => w.includes('b3')));

  const realIdx = ffArgs.indexOf('real0.mp4');
  const fbIdx = ffArgs.indexOf('fb2.mp4');
  assert.ok(realIdx < fbIdx, 'beats remain in timeline order');
});

test('renderAigcTimeline: no resolvable beats → rendered false, ffmpeg never called', async () => {
  let ffCalled = false;
  const generate = (async (_cfg: any, j: WanJob) => ({ beatId: j.beatId, taskId: null, status: 'FAILED', error: 'x' })) as any;
  const result = await renderAigcTimeline(
    { plans: [PLANS[3]!], outputPath: path.join(os.tmpdir(), 'aigc_out2.mp4'), cfg: CFG, workDir: path.join(os.tmpdir(), 'aigc_test_work2') },
    { generate, download: async (_u, d) => d, runFfmpeg: async () => { ffCalled = true; return { code: 0, out: '' }; } }
  );
  assert.equal(result.rendered, false);
  assert.equal(ffCalled, false);
});
