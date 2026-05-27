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
  assert.equal(body.showcase.case.seedFilename, 'macbook_neo.mp4');
  assert.equal(body.videoAnalysis.analysisSource, 'real_ffmpeg');
  assert.equal(body.videoAnalysis.metadata.videoId, 'macbook_neo.mp4');
  assert.equal(body.structureDebug.extractionSource, 'rough_fine_scan_artifact');
  assert.ok(body.structureGraph.segments.length >= 4);
  assert.deepEqual(
    body.assetCards.map((card: { id: string }) => card.id),
    ['asset_001', 'asset_002', 'asset_003']
  );
  assert.ok(body.assetCards.some((card: { url?: string }) => card.url?.includes('kangshifu_iced_tea')));
  assert.ok(body.materialGaps.length >= 1);
  assert.ok(body.repairs.length >= 1);
  assert.ok(body.timeline.length >= 4);
  assert.ok(body.qualityReport.structureMatch > 0);
});

test('POST /api/demo/run propagates boundaries into qualityReport.transitionFidelity', async () => {
  const response = await fetch(`${baseUrl}/api/demo/run`, { method: 'POST' });
  assert.equal(response.status, 200);
  const body = await response.json();

  // Macbook_neo structure_graph.json now has 9 boundaries committed (Task 7).
  assert.equal(body.structureDebug.extractionSource, 'rough_fine_scan_artifact');
  assert.ok(Array.isArray(body.structureGraph.boundaries), 'structureGraph.boundaries should be an array');
  assert.ok(body.structureGraph.boundaries.length >= 1, 'at least one boundary expected');

  // Quality report should include transitionFidelity since boundaries flowed in.
  assert.equal(typeof body.qualityReport.transitionFidelity, 'number');
  assert.ok(body.qualityReport.transitionFidelity >= 0 && body.qualityReport.transitionFidelity <= 1);
});
