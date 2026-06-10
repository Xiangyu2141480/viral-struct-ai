import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContentBriefSchema } from '@viral-struct/shared';
import { buildDeterministicContentBrief, parseContentBrief, USER_BRIEF_INPUT_GUIDANCE } from './contentBriefParser';

const paragraph = '我想推广康师傅冰红茶，一款柠檬味即饮红茶饮料。主要卖给夏天通勤、爱聚餐的年轻人，'
  + '在天热口渴、饭后解腻、朋友聚会的时候喝。卖点是冰爽解腻、柠檬茶香、大瓶适合分享、冰镇后更清爽。'
  + '希望大家现在就来一瓶。';

test('deterministic parse yields a schema-valid ContentBrief from a free paragraph', () => {
  const brief = buildDeterministicContentBrief(paragraph);
  assert.doesNotThrow(() => ContentBriefSchema.parse(brief));
  assert.ok(brief.productName.length > 0);
  assert.ok(brief.sellingPoints.length >= 1);
  assert.ok(brief.cta.length > 0);
});

test('deterministic parse picks audience / scenario / cta from cue words', () => {
  const brief = buildDeterministicContentBrief(paragraph);
  // Rough heuristic: each field is a fragment carrying that field's cue word (audience ≠ scenario fragment).
  assert.match(brief.targetAudience, /年轻人|通勤|卖给/);
  assert.match(brief.scenario, /聚餐|天热|饭后|聚会|口渴|夏天/);
  assert.notEqual(brief.scenario, brief.targetAudience);
  assert.match(brief.cta, /来一瓶|现在/);
});

test('deterministic parse never crashes on empty / minimal input (always valid)', () => {
  for (const input of ['', '   ', '某产品']) {
    const brief = buildDeterministicContentBrief(input);
    assert.doesNotThrow(() => ContentBriefSchema.parse(brief), `input=${JSON.stringify(input)}`);
  }
});

test('parseContentBrief with useLlm:false returns the deterministic parse', async () => {
  const res = await parseContentBrief({ rawInput: paragraph, useLlm: false });
  assert.equal(res.source, 'deterministic');
  assert.doesNotThrow(() => ContentBriefSchema.parse(res.contentBrief));
});

test('the front-end guidance covers the fields the parser needs', () => {
  for (const kw of ['产品是什么', '卖给谁', '场景', '卖点', '行动号召']) {
    assert.ok(USER_BRIEF_INPUT_GUIDANCE.includes(kw), `guidance should mention ${kw}`);
  }
});
