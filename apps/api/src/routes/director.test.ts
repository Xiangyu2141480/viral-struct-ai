import assert from 'node:assert/strict';
import { type Server } from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import { directorRouter } from './director';
import { makeAssets, makeContentBrief, makeGraph } from '../services/directorAgent/testFixtures';
import { installRouteLlmMock, uninstallRouteLlmMock } from '../testSupport/routeLlmMock';

let server: Server;
let baseUrl = '';

before(async () => {
  installRouteLlmMock();
  const app = express();
  app.use(express.json({ limit: '4mb' }));
  app.use('/api/director', directorRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address();
      baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolve();
    });
  });
});

after(async () => {
  uninstallRouteLlmMock();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

async function orchestrate(body: unknown) {
  const response = await fetch(`${baseUrl}/api/director/orchestrate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

test('POST /api/director/orchestrate returns a plan-only OrchestratedTimeline + handoff', async () => {
  const { status, body } = await orchestrate({
    projectId: 'route_test',
    structureGraph: makeGraph(),
    assetCards: makeAssets(),
    contentBrief: makeContentBrief(),
    options: { useLlmMatcher: false }
  });

  assert.equal(status, 200);
  assert.equal(body.orchestratedTimeline.schemaVersion, 'orchestrated-v1');
  assert.equal(body.orchestratedTimeline.meta.planOnly, true);
  assert.equal(body.orchestratedTimeline.slots.length, 3);
  assert.equal(body.orchestratedTimeline.transitions.length, 2);
  assert.equal(body.ownership, 'director_agent_plan_only_not_rendered');
  // handoff is a timeline, not a rendered product
  assert.equal(body.authoredTimeline.schemaVersion, '1.0');
  assert.equal(body.authoredTimeline.beats.length, 3);
});

test('includeHandoff:false omits the AuthoredTimeline', async () => {
  const { status, body } = await orchestrate({
    structureGraph: makeGraph(),
    assetCards: makeAssets(),
    contentBrief: makeContentBrief(),
    includeHandoff: false,
    options: { useLlmMatcher: false }
  });
  assert.equal(status, 200);
  assert.equal(body.authoredTimeline, undefined);
  assert.ok(body.orchestratedTimeline);
});

test('a malformed request is rejected with 400', async () => {
  const { status, body } = await orchestrate({ assetCards: [] }); // missing structureGraph + contentBrief
  assert.equal(status, 400);
  assert.match(body.error, /Director orchestration failed/);
});
