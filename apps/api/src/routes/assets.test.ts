import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import { assetsRouter } from './assets';

let server: Server;
let baseUrl = '';

before(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/assets', assetsRouter);

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

test('GET /api/assets/libraries/:libraryId loads the pre-generated AssetCard library', async () => {
  const response = await fetch(`${baseUrl}/api/assets/libraries/kangshifu_demo`);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, 'asset_library');
  assert.equal(body.libraryId, 'kangshifu_demo');
  assert.deepEqual(
    body.assetCards.map((card: { id: string }) => card.id),
    ['asset_001', 'asset_002', 'asset_003']
  );
});

test('GET /api/assets/libraries/:libraryId rejects traversal-like library ids', async () => {
  const response = await fetch(`${baseUrl}/api/assets/libraries/..%2Fsecret`);

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /could not be loaded/i);
});
