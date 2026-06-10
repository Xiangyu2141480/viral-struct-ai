import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WanJob } from '@viral-struct/shared';
import { generateClip } from './wanVideoClient';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CFG = { apiKey: 'k', baseUrl: 'https://host/api/v1', workspaceId: 'ws-1', pollIntervalMs: 1, maxWaitMs: 5000 };

const T2V_JOB: WanJob = {
  beatId: 'b1',
  model: 'wan2.7-t2v',
  prompt: '冰爽镜头',
  media: [],
  parameters: { resolution: '720P', ratio: '9:16', duration: 3, promptExtend: false, watermark: false }
};

function fakeRes(obj: unknown): any {
  return { ok: true, status: 200, json: async () => obj };
}

test('generateClip: creates a task then polls to SUCCEEDED and returns the video url', async () => {
  const calls: Array<{ url: string; init?: any }> = [];
  let polls = 0;
  const fetchImpl = (async (url: any, init?: any) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/video-synthesis')) {
      return fakeRes({ output: { task_id: 'task-1', task_status: 'PENDING' } });
    }
    polls += 1;
    return fakeRes({ output: polls < 2 ? { task_status: 'RUNNING' } : { task_status: 'SUCCEEDED', video_url: 'https://oss/v.mp4' } });
  }) as any;

  const res = await generateClip(CFG, T2V_JOB, { fetchImpl, sleep: async () => {} });

  assert.equal(res.status, 'SUCCEEDED');
  assert.equal(res.videoUrl, 'https://oss/v.mp4');
  assert.equal(res.taskId, 'task-1');

  const create = calls.find((c) => c.url.includes('/video-synthesis'))!;
  assert.equal(create.init.headers['X-DashScope-Async'], 'enable');
  assert.equal(create.init.headers['X-DashScope-WorkSpace'], 'ws-1');
  assert.match(create.init.headers.Authorization, /^Bearer k$/);
  const body = JSON.parse(create.init.body);
  assert.equal(body.model, 'wan2.7-t2v');
  assert.equal(body.parameters.duration, 3);
  assert.equal(body.input.prompt, '冰爽镜头');
});

test('generateClip: a create response without a task_id comes back as FAILED (never throws)', async () => {
  const fetchImpl = (async () => fakeRes({ code: 'InvalidApiKey', message: 'No API-key provided.' })) as any;
  const res = await generateClip(CFG, T2V_JOB, { fetchImpl, sleep: async () => {} });
  assert.equal(res.status, 'FAILED');
  assert.match(res.error ?? '', /InvalidApiKey/);
});

test('generateClip: a terminal FAILED task status surfaces the model error', async () => {
  let created = false;
  const fetchImpl = (async (url: any) => {
    if (String(url).includes('/video-synthesis')) {
      created = true;
      return fakeRes({ output: { task_id: 'task-2', task_status: 'PENDING' } });
    }
    return fakeRes({ output: { task_status: 'FAILED', code: 'InvalidParameter', message: 'bad size' } });
  }) as any;
  const res = await generateClip(CFG, T2V_JOB, { fetchImpl, sleep: async () => {} });
  assert.ok(created);
  assert.equal(res.status, 'FAILED');
  assert.match(res.error ?? '', /InvalidParameter/);
});
