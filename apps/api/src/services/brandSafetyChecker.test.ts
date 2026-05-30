import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkBrandSafety } from './brandSafetyChecker';

test('checkBrandSafety blocks high-risk celebrity IP and medical guarantee claims', () => {
  const result = checkBrandSafety({
    prompt: 'Tom Cruise holding a Marvel-style bottle, 保证治愈 and 100% 第一.',
    script: '用 Disney Star Wars 视觉复制源视频开场。',
    packaging: '最好效果，保证治愈。'
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.ipRisk, 'high');
  assert.equal(result.brandRisk, 'high');
  assert.equal(result.claimRisk, 'high');
  assert.ok(result.reasons.some((reason) => reason.includes('Tom Cruise')));
  assert.ok(result.reasons.some((reason) => reason.includes('Marvel')));
  assert.ok(result.reasons.some((reason) => reason.includes('保证治愈')));
});

test('checkBrandSafety passes normal Kangshifu iced tea demo prompts', () => {
  const result = checkBrandSafety({
    prompt: '康师傅冰红茶冰爽产品特写，柠檬、冰块、夏日通勤场景。',
    script: '午后热到没精神，来一口冰爽解腻。',
    packaging: '标题条、卖点卡、CTA 卡片。'
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.ipRisk, 'low');
  assert.equal(result.brandRisk, 'low');
  assert.equal(result.claimRisk, 'low');
  assert.ok(result.reasons.some((reason) => reason.includes('No high-risk')));
});
