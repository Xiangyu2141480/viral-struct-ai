import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

test('POST /api/assets/analyze uses deterministic local analysis without LLM keys', async () => {
  const previousModel = process.env.LLM_MODEL;
  const previousKey = process.env.LLM_API_KEY;
  const previousBaseUrl = process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;

  const dir = await mkdtemp(path.join(tmpdir(), 'asset-route-test-'));
  const imgPath = path.join(dir, 'kangshifu-hand-demo.png');
  await writeFile(imgPath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  ));

  try {
    const form = new FormData();
    const image = new Blob([await readFile(imgPath)], { type: 'image/png' });
    form.append('assets', image, 'kangshifu-hand-demo.png');
    form.append('textBrief', '冰爽解腻，适合夏日聚餐。');

    const response = await fetch(`${baseUrl}/api/assets/analyze`, {
      method: 'POST',
      body: form
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.source, 'upload_analysis_deterministic');
    assert.equal(body.vlmStatus, 'disabled');
    assert.deepEqual(body.warnings, []);
    assert.equal(body.assetCards[0].analysisSource, 'deterministic');
    assert.equal(body.assetCards[0].analysis.source, 'deterministic');
    assert.equal(body.assetCards[1].id, 'asset_text_brief');
    assert.equal(body.assetCards[1].analysisSource, 'deterministic');
    assert.equal(body.assetCards[1].analysis.semantic.detectedObjects.includes('selling_point_copy'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (previousModel === undefined) {
      delete process.env.LLM_MODEL;
    } else {
      process.env.LLM_MODEL = previousModel;
    }
    if (previousKey === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = previousKey;
    }
    if (previousBaseUrl === undefined) {
      delete process.env.LLM_BASE_URL;
    } else {
      process.env.LLM_BASE_URL = previousBaseUrl;
    }
  }
});
