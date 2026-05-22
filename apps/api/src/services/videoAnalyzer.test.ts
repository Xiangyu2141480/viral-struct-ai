import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeVideoMock } from './videoAnalyzer';

test('analyzeVideoMock keeps the full manual transcript as timed segments', async () => {
  const analysis = await analyzeVideoMock(
    'manual-demo',
    '第一句抓注意。第二句讲痛点。第三句讲卖点。第四句做证明。第五句提示下单。'
  );

  assert.deepEqual(analysis.transcript.map((segment) => segment.text), [
    '第一句抓注意。',
    '第二句讲痛点。',
    '第三句讲卖点。',
    '第四句做证明。',
    '第五句提示下单。'
  ]);
  assert.equal(analysis.transcript[0]?.start, 0);
  assert.equal(analysis.transcript.at(-1)?.end, 15);
});

test('analyzeVideoMock leaves one-line manual transcript intact for downstream shot splitting', async () => {
  const analysis = await analyzeVideoMock(
    'single-line-demo',
    '没有标点的一整段字幕会保留下来交给结构抽取按镜头拆分'
  );

  assert.equal(analysis.transcript.length, 1);
  assert.equal(analysis.transcript[0]?.start, 0);
  assert.equal(analysis.transcript[0]?.end, 15);
  assert.equal(analysis.transcript[0]?.text, '没有标点的一整段字幕会保留下来交给结构抽取按镜头拆分');
});
