import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import { demoRouter } from './demo';

let server: Server;
let baseUrl = '';

before(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/demo', demoRouter);

  await new Promise<void>((resolveServer) => {
    server = app.listen(0, () => {
      const address = server.address();
      assert.notEqual(address, null);
      assert.notEqual(typeof address, 'string');
      baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolveServer();
    });
  });
});

after(async () => {
  await new Promise<void>((resolveServer, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolveServer();
    });
  });
});

test('GET /api/demo/showcase exposes the judge-facing demo config', async () => {
  const response = await fetch(`${baseUrl}/api/demo/showcase`);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.showcase.case.productName, '康师傅冰红茶');
  assert.ok(body.showcase.steps.length >= 5);
  assert.ok(body.showcase.scoreEvidence.length >= 7);
  assert.equal(body.showcase.case.assetFiles.length, 3);
});

test('POST /api/demo/run returns a complete judge-facing workflow result', async () => {
  const response = await fetch(`${baseUrl}/api/demo/run`, { method: 'POST' });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.showcase.case.productName, '康师傅冰红茶');
  assert.equal(body.videoAnalysis.analysisSource, 'real_ffmpeg');
  assert.ok(body.structureGraph.segments.length >= 4);
  assert.ok(body.assetCards.length >= 3); // real library has 3 images; mock had 3 + 1 text brief
  assert.ok(body.assetCards.some((card: { url?: string }) => card.url?.includes('kangshifu_iced_tea')));
  assert.ok(body.materialGaps.length >= 1);
  assert.ok(body.repairs.length >= 1);
  assert.ok(body.timeline.length >= 4);
  assert.ok(body.qualityReport.structureMatch > 0);
});
