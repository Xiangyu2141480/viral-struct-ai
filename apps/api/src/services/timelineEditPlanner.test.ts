import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ContentBrief, TimelineItem } from '@viral-struct/shared';
import { applyTimelineEdit } from './timelineEditPlanner';

const brief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏季通勤和校园人群',
  scenario: '午后高温',
  sellingPoints: ['冰爽解腻', '柠檬茶香', '大瓶畅饮'],
  cta: '想要冰爽解腻，就来一瓶康师傅冰红茶。'
};

function sampleTimeline(): TimelineItem[] {
  return [
    {
      id: 'tl_hook',
      start: 0,
      end: 3,
      segmentRole: 'hook',
      sourceSegmentId: 'seg_hook',
      slotId: 'slot_hook',
      script: '午后太热怎么办？',
      subtitles: ['午后太热', '怎么办', '先看这个'],
      visualAction: '静态展示产品场景',
      packaging: { captionStyle: 'clean_subtitle_only', transition: 'fade', motion: 'static' },
      scriptSource: 'template'
    },
    {
      id: 'tl_problem',
      start: 3,
      end: 5,
      segmentRole: 'pain_point',
      sourceSegmentId: 'seg_problem',
      slotId: 'slot_problem',
      script: '普通饮料不够解腻。',
      subtitles: ['普通饮料', '不够解腻'],
      visualAction: '展示普通场景',
      packaging: { captionStyle: 'clean_subtitle_only', cardType: 'selling_point_card', transition: 'fade', motion: 'static' },
      scriptSource: 'template'
    },
    {
      id: 'tl_usage',
      start: 5,
      end: 7,
      segmentRole: 'usage',
      sourceSegmentId: 'seg_usage',
      slotId: 'slot_usage',
      script: '运动后和饭后都可以来一口。',
      subtitles: ['运动后', '饭后', '来一口'],
      visualAction: '展示饮用场景',
      packaging: { captionStyle: 'clean_subtitle_only', transition: 'fade', motion: 'static' },
      scriptSource: 'template'
    },
    {
      id: 'tl_selling',
      start: 7,
      end: 10,
      segmentRole: 'selling_point',
      sourceSegmentId: 'seg_selling',
      slotId: 'slot_selling',
      script: '冰爽解腻，柠檬茶香。',
      subtitles: ['冰爽解腻', '柠檬茶香'],
      visualAction: '展示产品特写',
      packaging: { captionStyle: 'clean_subtitle_only', cardType: 'selling_point_card', transition: 'fade', motion: 'static' },
      scriptSource: 'template'
    },
    {
      id: 'tl_cta',
      start: 10,
      end: 12,
      segmentRole: 'cta',
      sourceSegmentId: 'seg_cta',
      slotId: 'slot_cta',
      script: '现在试试看。',
      subtitles: ['现在', '试试看'],
      visualAction: '结尾展示',
      packaging: { captionStyle: 'clean_subtitle_only', transition: 'fade', motion: 'static' },
      scriptSource: 'template'
    }
  ];
}

test('applyTimelineEdit makes the opening hook stronger and shorter', () => {
  const result = applyTimelineEdit({
    instruction: '开头更抓人',
    timeline: sampleTimeline(),
    contentBrief: brief
  });

  assert.equal(result.editType, 'hook_stronger');
  assert.notEqual(result.updatedTimeline[0].script, '午后太热怎么办？');
  assert.ok(result.updatedTimeline[0].script.includes('康师傅冰红茶'));
  assert.ok(result.updatedTimeline[0].end - result.updatedTimeline[0].start < 3);
  assert.equal(result.updatedTimeline[0].packaging.cardType, 'title_card');
  assert.ok(result.changedItems.some((item) => item.itemId === 'tl_hook'));
});

test('applyTimelineEdit moves product and selling point information earlier', () => {
  const result = applyTimelineEdit({
    instruction: '商品信息提前',
    timeline: sampleTimeline(),
    contentBrief: brief
  });

  assert.equal(result.editType, 'product_info_earlier');
  assert.equal(result.updatedTimeline[1].id, 'tl_selling');
  assert.ok(result.updatedTimeline[1].script.includes('康师傅冰红茶'));
  assert.ok(result.changedItems.some((item) => item.itemId === 'tl_selling'));
});

test('applyTimelineEdit reduces subtitles and weakens non-essential cards', () => {
  const before = sampleTimeline();
  const result = applyTimelineEdit({
    instruction: '减少字幕',
    timeline: before,
    contentBrief: brief
  });

  const beforeSubtitleCount = before.reduce((sum, item) => sum + item.subtitles.length, 0);
  const afterSubtitleCount = result.updatedTimeline.reduce((sum, item) => sum + item.subtitles.length, 0);
  assert.equal(result.editType, 'reduce_subtitles');
  assert.ok(afterSubtitleCount < beforeSubtitleCount);
  assert.equal(result.updatedTimeline[1].packaging.cardType, undefined);
});

test('applyTimelineEdit increases rhythm with shorter durations and quick cuts', () => {
  const before = sampleTimeline();
  const result = applyTimelineEdit({
    instruction: '增强节奏感',
    timeline: before,
    contentBrief: brief
  });

  assert.equal(result.editType, 'increase_rhythm');
  assert.ok(result.updatedTimeline.at(-1)!.end < before.at(-1)!.end);
  assert.ok(result.updatedTimeline.every((item) => item.packaging.transition === 'quick_cut'));
  assert.ok(result.changedItems.length >= 3);
});

test('applyTimelineEdit strengthens CTA copy and packaging', () => {
  const result = applyTimelineEdit({
    instruction: 'CTA 更强，购买引导更明确',
    timeline: sampleTimeline(),
    contentBrief: brief
  });

  const last = result.updatedTimeline.at(-1)!;
  assert.equal(result.editType, 'stronger_cta');
  assert.match(last.script, /立即|现在|下单/);
  assert.ok(last.script.includes('康师傅冰红茶'));
  assert.equal(last.packaging.cardType, 'cta_card');
  assert.ok(result.changedItems.some((item) => item.itemId === 'tl_cta'));
});

test('applyTimelineEdit returns supported suggestions for unknown instructions without crashing', () => {
  const before = sampleTimeline();
  const result = applyTimelineEdit({
    instruction: '换成赛博朋克风格',
    timeline: before,
    contentBrief: brief
  });

  assert.equal(result.editType, 'unsupported');
  assert.deepEqual(result.updatedTimeline, before);
  assert.equal(result.changedItems.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes('未识别')));
  assert.ok(result.supportedEditSuggestions.length >= 5);
});
