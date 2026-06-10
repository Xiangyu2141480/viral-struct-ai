import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import { ContentBriefSchema, ProductIntelligenceSchema } from '@viral-struct/shared';
import { structRouter } from './struct';

let server: Server;
let baseUrl = '';

const previousEnv = {
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_MODEL: process.env.LLM_MODEL,
};

before(async () => {
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/struct', structRouter);

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
  restoreEnv('LLM_API_KEY', previousEnv.LLM_API_KEY);
  restoreEnv('LLM_BASE_URL', previousEnv.LLM_BASE_URL);
  restoreEnv('LLM_MODEL', previousEnv.LLM_MODEL);

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

test('POST /api/struct/product/parse rejects too-short product descriptions', async () => {
  const response = await fetch(`${baseUrl}/api/struct/product/parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawInput: '冰红茶' }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.match(body.error, /rawInput/i);
});

test('POST /api/struct/product/parse returns deterministic structured product understanding without LLM keys', async () => {
  const rawInput =
    '康师傅冰红茶，一款柠檬味即饮红茶饮料，卖给夏天通勤和爱聚餐的年轻人，适合天热口渴、饭后解腻、朋友聚会，主打冰爽解腻、柠檬茶香、大瓶分享、冰镇更清爽，希望观众现在就来一瓶，风格偏高节奏、夏日清爽、真实质感。';

  const response = await fetch(`${baseUrl}/api/struct/product/parse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rawInput }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, 'deterministic');
  assert.equal(body.product.description, rawInput);
  assert.ok(body.product.name.includes('康师傅冰红茶'));
  assert.ok(Array.isArray(body.product.sellingPoints));
  assert.ok(body.product.sellingPoints.length > 0);
  assert.doesNotThrow(() => ContentBriefSchema.parse(body.contentBrief));
  assert.doesNotThrow(() => ProductIntelligenceSchema.parse(body.productIntelligence));
  assert.deepEqual(body.parseWarnings, body.warnings);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
