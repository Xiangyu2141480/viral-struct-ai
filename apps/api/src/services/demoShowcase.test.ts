import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSeedVideoPath } from './videoAnalyzer';
import { getChampionDemoShowcase } from './demoShowcase';

test('champion demo showcase anchors a real seed and the P0 judging evidence', async () => {
  const showcase = getChampionDemoShowcase();

  assert.equal(showcase.case.productName, '便携咖啡杯');
  assert.equal(showcase.case.seedFilename, 'huaxizi.mp4');
  assert.ok(await getSeedVideoPath(showcase.case.seedFilename));

  assert.ok(showcase.case.assetBrief.includes('缺少真人讲解'));
  assert.ok(showcase.case.assetBrief.includes('缺少使用过程'));
  assert.ok(showcase.case.assetBrief.includes('缺少对比镜头'));
  assert.ok(showcase.case.assetBrief.includes('缺少 CTA 镜头'));

  const routes = new Set(showcase.steps.map((step) => step.route));
  assert.ok(routes.has('/analyze'));
  assert.ok(routes.has('/graph'));
  assert.ok(routes.has('/adapt'));
  assert.ok(routes.has('/gaps'));
  assert.ok(routes.has('/result'));

  const taskIds = new Set(showcase.scoreEvidence.map((item) => item.taskId));
  for (const taskId of ['task_1', 'task_2', 'task_3', 'task_5', 'task_6', 'task_7', 'task_8']) {
    assert.ok(taskIds.has(taskId), `missing score evidence for ${taskId}`);
  }
});
