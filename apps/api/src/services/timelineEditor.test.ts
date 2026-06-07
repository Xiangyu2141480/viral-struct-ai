import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SegmentRole, TimelineItem } from '@viral-struct/shared';
import {
  applyEditOperations,
  applyNaturalLanguageEditWithFallback,
  parseEditInstructionRules,
  type ParseEditLLMOptions
} from './timelineEditor';

function item(
  id: string,
  role: SegmentRole,
  start: number,
  end: number,
  subtitles: string[],
  script = subtitles.join('')
): TimelineItem {
  return {
    id,
    start,
    end,
    segmentRole: role,
    sourceSegmentId: `seg_${id}`,
    slotId: `slot_${id}`,
    script,
    subtitles,
    visualAction: 'demo',
    packaging: { captionStyle: 'click_large_bottom_bold', transition: 'push' }
  };
}

function sampleTimeline(): TimelineItem[] {
  return [
    item('tl_1', 'hook', 0, 3, ['夏天热', '没胃口', '试试这个', '超解腻']),
    item('tl_2', 'pain_point', 3, 6, ['普通甜品太腻']),
    item('tl_3', 'selling_point', 6, 10, ['巧克力慕斯', '低负担']),
    item('tl_4', 'cta', 10, 12, ['现在下单'])
  ];
}

test('reduce_caption_density halves subtitle lines', () => {
  const { timeline, patches } = applyEditOperations(sampleTimeline(), [{ type: 'reduce_caption_density' }]);
  assert.equal(timeline[0].subtitles.length, 2); // 4 -> 2
  assert.deepEqual(timeline[0].subtitles, ['夏天热 没胃口', '试试这个 超解腻']);
  assert.ok(patches.some((p) => p.op === 'reduce_caption_density'));
});

test('increase_pace shortens total duration and sets quick_cut', () => {
  const before = sampleTimeline();
  const beforeTotal = before.at(-1)!.end - before[0].start;
  const { timeline } = applyEditOperations(before, [{ type: 'increase_pace' }]);
  const afterTotal = timeline.at(-1)!.end - timeline[0].start;
  assert.ok(afterTotal < beforeTotal, `expected ${afterTotal} < ${beforeTotal}`);
  assert.ok(timeline.every((t) => t.packaging.transition === 'quick_cut'));
});

test('move_product_info_earlier moves first selling_point ahead of pain_point', () => {
  const { timeline } = applyEditOperations(sampleTimeline(), [{ type: 'move_product_info_earlier' }]);
  const roles = timeline.map((t) => t.segmentRole);
  assert.deepEqual(roles, ['hook', 'selling_point', 'pain_point', 'cta']);
  // timeline stays contiguous after reorder
  assert.equal(timeline[0].end, timeline[1].start);
  assert.equal(timeline[1].end, timeline[2].start);
});

test('rewrite op applies LLM-provided newText to the hook item', () => {
  const newText = '热到没胃口？这口冰慕斯直接救场';
  const { timeline, patches } = applyEditOperations(sampleTimeline(), [
    { type: 'strengthen_hook', newText }
  ]);
  assert.equal(timeline[0].script, newText);
  assert.ok(timeline[0].subtitles.length >= 1);
  assert.ok(patches.some((p) => p.op === 'strengthen_hook' && p.field === 'script'));
});

test('rewrite op without newText is a no-op (needs LLM)', () => {
  const { timeline, patches } = applyEditOperations(sampleTimeline(), [{ type: 'strengthen_hook' }]);
  assert.equal(timeline[0].script, sampleTimeline()[0].script);
  assert.equal(patches.length, 0);
});

test('applyEditOperations does not mutate the input timeline', () => {
  const original = sampleTimeline();
  const snapshot = JSON.stringify(original);
  applyEditOperations(original, [{ type: 'reduce_caption_density' }, { type: 'increase_pace' }]);
  assert.equal(JSON.stringify(original), snapshot);
});

test('rule parser maps "减少字幕，增强节奏感" to two structural ops', () => {
  const ops = parseEditInstructionRules('减少字幕，增强节奏感');
  const types = ops.map((o) => o.type);
  assert.ok(types.includes('reduce_caption_density'));
  assert.ok(types.includes('increase_pace'));
});

test('rule parser maps "把商品信息提前"', () => {
  const ops = parseEditInstructionRules('把商品信息提前');
  assert.deepEqual(ops.map((o) => o.type), ['move_product_info_earlier']);
});

test('orchestrator uses llm_parsed when client succeeds', async () => {
  const operations = [{ type: 'reduce_caption_density', reason: 'mock' }];
  const mockClient = {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: JSON.stringify({ operations }) } }] })
      }
    }
  };
  const result = await applyNaturalLanguageEditWithFallback({
    instruction: '减少字幕',
    timeline: sampleTimeline(),
    model: 'test-model',
    clientFactory: (() => mockClient) as unknown as ParseEditLLMOptions['clientFactory']
  });
  assert.equal(result.editSource, 'llm_parsed');
  assert.equal(result.timeline[0].subtitles.length, 2);
});

test('orchestrator falls back to rule_based when client throws', async () => {
  const result = await applyNaturalLanguageEditWithFallback({
    instruction: '减少字幕，增强节奏感',
    timeline: sampleTimeline(),
    model: 'test-model',
    clientFactory: (() => {
      throw new Error('LLM down');
    }) as ParseEditLLMOptions['clientFactory']
  });
  assert.equal(result.editSource, 'rule_based');
  assert.ok(result.warning);
  assert.ok(result.operations.some((o) => o.type === 'increase_pace'));
});
