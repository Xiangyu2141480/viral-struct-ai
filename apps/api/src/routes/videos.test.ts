import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import express from 'express';
import { getFrameDir } from '../services/videoPaths';
import { videosRouter } from './videos';

let server: Server;
let baseUrl = '';

before(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/videos', videosRouter);

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

test('GET /api/videos/seeds lists seed videos including names with spaces', async () => {
  const response = await fetch(`${baseUrl}/api/videos/seeds`);

  assert.equal(response.status, 200);
  const body = await response.json();
  const filenames = body.videos.map((video: { filename: string }) => video.filename);
  assert.ok(filenames.includes('huaxizi.mp4'));
  assert.ok(filenames.includes('YVES SAINT LAURENT .mp4'));
  assert.ok(body.videos.every((video: { sizeBytes: number }) => video.sizeBytes > 0));
});

test('POST /api/videos/seeds/analyze rejects path traversal', async () => {
  const response = await fetch(`${baseUrl}/api/videos/seeds/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: '../huaxizi.mp4' })
  });

  assert.equal(response.status, 400);
});

test('POST /api/videos/upload requires a file', async () => {
  const response = await fetch(`${baseUrl}/api/videos/upload`, { method: 'POST' });

  assert.equal(response.status, 400);
});

test('POST /api/videos/seeds/analyze returns real metadata and extracted frames', async () => {
  const response = await fetch(`${baseUrl}/api/videos/seeds/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: 'YVES SAINT LAURENT .mp4',
      manualTranscript: '第一句吸引注意。第二句展示卖点。第三句完成 CTA。'
    })
  });

  assert.equal(response.status, 200);
  const analysis = await response.json();
  assert.equal(analysis.analysisSource, 'real_ffmpeg');
  assert.ok(analysis.metadata.duration > 0);
  assert.ok(analysis.metadata.fps > 0);
  assert.ok(analysis.metadata.width > 0);
  assert.ok(analysis.metadata.height > 0);
  assert.equal(analysis.keyframes.length, 5);
  assert.ok(analysis.keyframes[0].url.startsWith('/media/frames/'));
  assert.equal(analysis.transcript.length, 3);

  const framePath = resolve(getFrameDir(), analysis.keyframes[0].url.replace('/media/frames/', ''));
  assert.equal(existsSync(framePath), true, `expected frame at ${framePath}`);
  assert.equal(dirname(framePath), getFrameDir());
});
