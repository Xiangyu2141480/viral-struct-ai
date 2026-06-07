import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import { safetyRouter } from './safety';

let server: Server;
let baseUrl = '';

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/safety', safetyRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('POST /api/safety/check returns blocked status for high-risk generation text', async () => {
  const response = await fetch(`${baseUrl}/api/safety/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: 'Tom Cruise as a Marvel hero drinks tea.',
      script: '保证治愈，100% 第一。',
      packaging: '复制源视频视觉元素。'
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json() as {
    safetyStatus: {
      status: string;
      ipRisk: string;
      brandRisk: string;
      claimRisk: string;
      reasons: string[];
    };
  };
  assert.equal(body.safetyStatus.status, 'blocked');
  assert.equal(body.safetyStatus.ipRisk, 'high');
  assert.equal(body.safetyStatus.brandRisk, 'high');
  assert.equal(body.safetyStatus.claimRisk, 'high');
  assert.ok(body.safetyStatus.reasons.length >= 3);
});

test('POST /api/safety/check passes normal demo copy', async () => {
  const response = await fetch(`${baseUrl}/api/safety/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: '康师傅冰红茶瓶身特写，冰块与柠檬，夏日通勤场景。',
      script: '午后热到没精神，来一口冰爽解腻。',
      packaging: '清爽标题条和 CTA 卡片。'
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { safetyStatus: { status: string; reasons: string[] } };
  assert.equal(body.safetyStatus.status, 'passed');
  assert.ok(body.safetyStatus.reasons.some((reason) => reason.includes('No high-risk')));
});
