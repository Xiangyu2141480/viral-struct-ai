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
  assert.equal(body.assetSource.source, 'asset_library');
  assert.equal(body.assetSource.libraryId, 'kangshifu_demo');
  assert.equal(
    body.evidenceTrace.find((item: { id: string }) => item.id === 'rough_fine_scan')?.source,
    'rough_fine_scan_artifact'
  );
  assert.equal(
    body.evidenceTrace.find((item: { id: string }) => item.id === 'asset_library')?.artifactPath,
    'seed_assets/asset_libraries/kangshifu_demo/asset_cards.json'
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

test('POST /api/demo/run surfaces migration contracts and transition fidelity in evidence trace', async () => {
  const response = await fetch(`${baseUrl}/api/demo/run`, { method: 'POST' });
  assert.equal(response.status, 200);
  const body = await response.json();

  const slotsWithContract = body.structureGraph.shotSlots.filter((slot: {
    intent?: unknown;
    sourceInstance?: unknown;
    acceptanceCriteria?: unknown;
  }) => slot.intent && slot.sourceInstance && slot.acceptanceCriteria);
  assert.ok(slotsWithContract.length >= 3, 'demo graph should expose migration contracts on key slots');

  const migrationTrace = body.evidenceTrace.find((item: { id: string }) => item.id === 'migration_contract');
  assert.ok(migrationTrace, 'evidenceTrace should include a migration_contract node');
  assert.match(migrationTrace.detail, /迁移契约/);
  assert.match(migrationTrace.detail, /可迁移意图/);

  const timelineTrace = body.evidenceTrace.find((item: { id: string }) => item.id === 'timeline_quality');
  assert.ok(timelineTrace, 'evidenceTrace should include timeline_quality');
  assert.match(timelineTrace.detail, /转场保真/);
});
