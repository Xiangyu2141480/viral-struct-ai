import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { buildScanCommandEnv, resolveFfmpeg } from './roughScanRunner';

test('resolveFfmpeg prefers FFMPEG_PATH when explicitly configured', () => {
  const previous = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = 'C:/tools/custom-ffmpeg.exe';
  try {
    assert.equal(resolveFfmpeg(), 'C:/tools/custom-ffmpeg.exe');
  } finally {
    if (previous === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previous;
  }
});

test('resolveFfmpeg uses the bundled ffmpeg-static binary before falling back to PATH ffmpeg', () => {
  const previous = process.env.FFMPEG_PATH;
  delete process.env.FFMPEG_PATH;
  try {
    assert.equal(resolveFfmpeg(), ffmpegStatic || 'ffmpeg');
  } finally {
    if (previous === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previous;
  }
});

test('buildScanCommandEnv exposes bundled ffmpeg to child Python processes', () => {
  const env = buildScanCommandEnv({ PATH: 'C:/existing/bin' });
  if (!ffmpegStatic) {
    assert.equal(env.PATH, 'C:/existing/bin');
    return;
  }

  const ffmpegDir = path.dirname(ffmpegStatic);
  assert.ok(env.PATH?.split(path.delimiter).includes(ffmpegDir));
  assert.ok(env.PATH?.split(path.delimiter).includes('C:/existing/bin'));
});
