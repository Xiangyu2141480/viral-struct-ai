import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import { ViralStructureGraphSchema } from '@viral-struct/shared';
import { structureRouter } from './structure';

let server: Server;
let baseUrl = '';

before(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/structure', structureRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address();
      assert.notEqual(address, null);
      assert.notEqual(typeof address, 'string');
      baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});

test('POST /api/structure/extract returns graph and debug for normal input', async () => {
  const response = await postExtract({
    videoAnalysis: {
      metadata: { videoId: 'route-demo.mp4', duration: 9, width: 1080, height: 1920 },
      transcript: '你是不是也卡在剪视频？这个工具可以自动生成结构图。现在点击了解更多。',
      shots: [
        { start: 0, end: 3, description: '开头问题' },
        { start: 3, end: 6, description: '卖点展示' },
        { start: 6, end: 9, description: 'CTA' }
      ],
      keyframes: [{ time: 1, url: '/frame.jpg', description: '标题卡' }]
    }
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  const parsed = ViralStructureGraphSchema.parse(body.structureGraph);
  assert.equal(parsed.meta.aspectRatio, '9:16');
  assert.equal(body.debug.fallbackUsed, false);
  assert.ok(body.debug.segmentCount >= 3);
  assert.ok(body.debug.evidenceCount > 0);
});

test('POST /api/structure/extract returns schema-valid fallback for unusable input', async () => {
  const response = await postExtract({ videoAnalysis: { transcript: [] } });

  assert.equal(response.status, 200);
  const body = await response.json();
  const parsed = ViralStructureGraphSchema.parse(body.structureGraph);
  assert.equal(parsed.segments[0]?.role, 'hook');
  assert.equal(body.debug.fallbackUsed, true);
  assert.ok(Array.isArray(body.debug.warnings));
});

function postExtract(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/structure/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}
