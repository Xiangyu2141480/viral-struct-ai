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

test('POST /api/structure/extract consumes a Fine Scan fixture VideoAnalysis handoff', async () => {
  const response = await postExtract({
    videoAnalysis: {
      metadata: {
        videoId: 'fine-scan-macbook-fixture.mp4',
        duration: 28,
        fps: 30,
        width: 1920,
        height: 1080,
        aspectRatio: '16:9'
      },
      transcript: [
        { start: 0, end: 4, text: '为什么很多团队做不出稳定的产品视频？' },
        { start: 4, end: 10, text: '问题是结构和素材经常对不上。' },
        { start: 10, end: 18, text: '这个流程可以把样例拆成可迁移结构和镜头槽位。' },
        { start: 18, end: 24, text: '通过对比每个槽位和现有素材，系统会给出缺口和补全建议。' },
        { start: 24, end: 28, text: '现在把 Fine Scan 结果写入工作流即可生成图谱。' }
      ],
      shots: [
        { id: 'fs_shot_1', start: 0, end: 4, description: '标题问题与场景建立' },
        { id: 'fs_shot_2', start: 4, end: 10, description: '痛点解释和信息卡' },
        { id: 'fs_shot_3', start: 10, end: 18, description: '结构图与产品界面展示' },
        { id: 'fs_shot_4', start: 18, end: 24, description: '对比证明和补全建议' },
        { id: 'fs_shot_5', start: 24, end: 28, description: 'CTA 与结果收束' }
      ],
      keyframes: [
        { time: 2, url: '/fine-scan/frame_001.jpg', description: '开头标题卡' },
        { time: 7, url: '/fine-scan/frame_002.jpg', description: '痛点信息卡' },
        { time: 14, url: '/fine-scan/frame_003.jpg', description: '结构图界面' },
        { time: 21, url: '/fine-scan/frame_004.jpg', description: '对比与证据卡' },
        { time: 26, url: '/fine-scan/frame_005.jpg', description: '行动召唤卡' }
      ]
    }
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  const parsed = ViralStructureGraphSchema.parse(body.structureGraph);
  assert.equal(body.debug.fallbackUsed, false);
  assert.equal(parsed.meta.aspectRatio, '16:9');
  assert.ok(parsed.segments.length >= 3 && parsed.segments.length <= 6);
  assert.ok(parsed.structureSummary.includes('Fine Scan') || parsed.structureSummary.includes('规则引擎'));
  assert.ok(parsed.creativeIngredients.some((ingredient) =>
    ingredient.evidence.some((evidence) => evidence.value.includes('/fine-scan/frame_'))
  ));
});

function postExtract(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/structure/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}
