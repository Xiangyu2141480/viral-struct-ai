import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { getRepoRoot } from './videoPaths';
import { getSeedVideoPath } from './videoAnalyzer';
import { getChampionDemoShowcase } from './demoShowcase';

test('champion demo showcase anchors a real seed and the P0 judging evidence', async () => {
  const showcase = getChampionDemoShowcase();

  assert.equal(showcase.case.productName, '康师傅冰红茶');
  assert.equal(showcase.case.seedFilename, 'macbook_neo.mp4');
  assert.equal(showcase.case.assetLibraryId, 'kangshifu_demo');
  assert.ok(await getSeedVideoPath(showcase.case.seedFilename));

  assert.ok(showcase.case.assetBrief.includes('缺少真人口播'));
  assert.ok(showcase.case.assetBrief.includes('缺少完整开盖畅饮过程'));
  assert.ok(showcase.case.assetBrief.includes('缺少对比镜头'));
  assert.ok(showcase.case.assetBrief.includes('缺少 CTA 结尾镜头'));

  assert.equal(showcase.case.assetFiles.length, 3);
  for (const asset of showcase.case.assetFiles) {
    assert.ok(asset.publicUrl.startsWith('/media/demo-assets/'));
    await access(resolve(getRepoRoot(), asset.repoPath));
  }

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
