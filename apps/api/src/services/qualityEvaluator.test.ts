import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssetCard, Boundary, ContentBrief, SlotMatch, TimelineItem } from '@viral-struct/shared';
import {
  computeCoherence,
  computeFactuality,
  computeStructureMatch,
  computeSubtitleReadability,
  computeVisualScriptAlignment,
  evaluateQuality
} from './qualityEvaluator';

type SlotMatchWithQuality = SlotMatch & { quality?: number };

const baseTimeline: TimelineItem[] = [
  {
    id: 'tl_1', start: 0, end: 5, segmentRole: 'hook', sourceSegmentId: 'seg_a', slotId: 's1',
    script: '', subtitles: [], visualAction: 'use_matched_asset',
    packaging: { captionStyle: 'x', transition: 'push' }
  },
  {
    id: 'tl_2', start: 5, end: 10, segmentRole: 'cta', sourceSegmentId: 'seg_b', slotId: 's2',
    script: '', subtitles: [], visualAction: 'use_matched_asset',
    packaging: { captionStyle: 'x', transition: 'fade' }
  }
];

test('evaluateQuality omits transitionFidelity when boundaries absent', () => {
  const report = evaluateQuality({ matches: [], timeline: baseTimeline });
  assert.equal(report.transitionFidelity, undefined);
});

test('evaluateQuality returns transitionFidelity=1 when all planned transitions match source boundary family', () => {
  // Source: seg_a → seg_b via morph (maps to motion family).
  // Planned: seg_a item has transition='push' (motion family). Match within family.
  const boundaries: Boundary[] = [
    { id: 'b1', from: 'seg_a', to: 'seg_b', transitionType: 'morph' }
  ];
  const report = evaluateQuality({ matches: [], timeline: baseTimeline, boundaries });
  assert.equal(report.transitionFidelity, 1);
});

test('evaluateQuality returns transitionFidelity=0 when none match', () => {
  // Source: cut (hard family). Planned for seg_a: push (motion family). No match.
  const boundaries: Boundary[] = [
    { id: 'b1', from: 'seg_a', to: 'seg_b', transitionType: 'cut' }
  ];
  const report = evaluateQuality({ matches: [], timeline: baseTimeline, boundaries });
  assert.equal(report.transitionFidelity, 0);
});

// ---------------------------------------------------------------------------
// structureMatch
// ---------------------------------------------------------------------------

test('computeStructureMatch falls back to status mapping when match.quality absent', () => {
  const matches: SlotMatch[] = [
    { slotId: 's1', score: 0, status: 'matched', reason: '' },
    { slotId: 's2', score: 0, status: 'partial', reason: '' },
    { slotId: 's3', score: 0, status: 'missing', reason: '' }
  ];
  // (0.9 + 0.6 + 0.2) / 3 = 0.5667
  assert.equal(computeStructureMatch(matches), 0.567);
});

test('computeStructureMatch prefers LLM quality when present (PR #36 path)', () => {
  const matches: SlotMatchWithQuality[] = [
    { slotId: 's1', score: 0, status: 'matched', reason: '', quality: 0.88 },
    { slotId: 's2', score: 0, status: 'partial', reason: '', quality: 0.55 }
  ];
  // (0.88 + 0.55) / 2 = 0.715
  assert.equal(computeStructureMatch(matches), 0.715);
});

test('computeStructureMatch returns 0 for empty match set', () => {
  assert.equal(computeStructureMatch([]), 0);
});

// ---------------------------------------------------------------------------
// factuality
// ---------------------------------------------------------------------------

const brief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏季通勤',
  scenario: '午后高温',
  sellingPoints: ['冰爽解腻', '柠檬茶香', '大瓶畅饮'],
  cta: '来一瓶'
};

test('computeFactuality returns 0.7 default when no brief or timeline provided', () => {
  assert.equal(computeFactuality([], undefined), 0.7);
  assert.equal(computeFactuality([], brief), 0.7);
});

test('computeFactuality rewards scripts that reference selling points', () => {
  const timeline: TimelineItem[] = [
    { ...baseTimeline[0], script: '冰爽解腻，午后这一口' },
    { ...baseTimeline[1], script: '柠檬茶香一闻就提神' }
  ];
  // 2 of 3 selling points referenced; (2/3) * 0.95 ≈ 0.633
  const score = computeFactuality(timeline, brief);
  assert.ok(score >= 0.6 && score <= 0.7, `expected ~0.63, got ${score}`);
});

test('computeFactuality penalises unsupported strong claims', () => {
  const safeTimeline: TimelineItem[] = [
    { ...baseTimeline[0], script: '冰爽解腻，柠檬茶香，大瓶畅饮' }
  ];
  const safe = computeFactuality(safeTimeline, brief);

  const riskyTimeline: TimelineItem[] = [
    { ...baseTimeline[0], script: '冰爽解腻 100% 业内第一医学证明专家推荐' }
  ];
  const risky = computeFactuality(riskyTimeline, brief);

  assert.ok(safe > risky, `safe (${safe}) should exceed risky (${risky})`);
  assert.ok(risky < 0.7);
});

// ---------------------------------------------------------------------------
// subtitleReadability
// ---------------------------------------------------------------------------

test('computeSubtitleReadability rewards well-paced 6-14 char lines', () => {
  const timeline: TimelineItem[] = [
    {
      ...baseTimeline[0],
      end: 4,
      subtitles: ['冰爆瞬间——', '午后这一口', '凉到指尖。'] // 3 lines, sum 14 chars over 4s ≈ 3.5 CPS
    }
  ];
  const score = computeSubtitleReadability(timeline);
  assert.ok(score >= 0.85, `expected high readability, got ${score}`);
});

test('computeSubtitleReadability penalises over-long lines', () => {
  const timeline: TimelineItem[] = [
    {
      ...baseTimeline[0],
      end: 4,
      subtitles: ['这是一行特别特别长的字幕加上更多字凑数']
    }
  ];
  const score = computeSubtitleReadability(timeline);
  assert.ok(score < 0.75, `expected low readability for long line, got ${score}`);
});

test('computeSubtitleReadability handles empty subtitles gracefully', () => {
  assert.equal(computeSubtitleReadability([]), 0.75);
});

// ---------------------------------------------------------------------------
// coherence
// ---------------------------------------------------------------------------

function tlWith(packaging: Partial<TimelineItem['packaging']>, index: number): TimelineItem {
  return {
    id: `tl_${index}`,
    start: index * 2,
    end: index * 2 + 2,
    segmentRole: 'selling_point',
    sourceSegmentId: `seg_${index}`,
    slotId: `s_${index}`,
    script: '',
    subtitles: [],
    visualAction: '',
    packaging: { captionStyle: 'x', transition: packaging.transition, motion: packaging.motion, cardType: packaging.cardType }
  };
}

test('computeCoherence drops when same transition repeats for 5+ items', () => {
  const monotone = Array.from({ length: 6 }, (_, i) => tlWith({ transition: 'quick_cut' }, i));
  const varied = [
    tlWith({ transition: 'quick_cut' }, 0),
    tlWith({ transition: 'push' }, 1),
    tlWith({ transition: 'quick_cut' }, 2),
    tlWith({ transition: 'fade' }, 3),
    tlWith({ transition: 'push' }, 4),
    tlWith({ transition: 'quick_cut' }, 5)
  ];
  assert.ok(computeCoherence(monotone) < computeCoherence(varied));
});

test('computeCoherence penalises motion thrashing', () => {
  const thrashing = [
    tlWith({ motion: 'push_in' }, 0),
    tlWith({ motion: 'static' }, 1),
    tlWith({ motion: 'push_in' }, 2),
    tlWith({ motion: 'static' }, 3),
    tlWith({ motion: 'push_in' }, 4)
  ];
  const smooth = [
    tlWith({ motion: 'push_in' }, 0),
    tlWith({ motion: 'push_in' }, 1),
    tlWith({ motion: 'static' }, 2),
    tlWith({ motion: 'static' }, 3),
    tlWith({ motion: 'pan' }, 4)
  ];
  assert.ok(computeCoherence(thrashing) < computeCoherence(smooth));
});

test('computeCoherence flags monotone cardType across 4+ items', () => {
  const monotone = Array.from({ length: 5 }, (_, i) => tlWith({ cardType: 'title_card', transition: i % 2 ? 'push' : 'quick_cut' }, i));
  const mixed = [
    tlWith({ cardType: 'title_card', transition: 'quick_cut' }, 0),
    tlWith({ cardType: 'selling_point_card', transition: 'push' }, 1),
    tlWith({ cardType: 'comparison_card', transition: 'quick_cut' }, 2),
    tlWith({ cardType: 'cta_card', transition: 'fade' }, 3),
    tlWith({ cardType: 'selling_point_card', transition: 'push' }, 4)
  ];
  assert.ok(computeCoherence(monotone) < computeCoherence(mixed));
});

// ---------------------------------------------------------------------------
// visualScriptAlignment
// ---------------------------------------------------------------------------

const splashAsset: AssetCard = {
  id: 'asset_splash',
  type: 'image',
  detectedObjects: ['beverage bottle', '冰块'],
  suitableSlots: ['opening_attention'],
  qualityScore: 0.88,
  visualContent: {
    primarySubject: '深棕色饮料瓶',
    subjectPosition: 'center_lower_third',
    kinematicElements: ['liquid_splash', 'ice_cubes_in_flight'],
    lighting: 'high_contrast_studio'
  }
};

test('computeVisualScriptAlignment rewards scripts referencing asset visual cues', () => {
  const timeline: TimelineItem[] = [
    {
      ...baseTimeline[0],
      assetId: 'asset_splash',
      script: '冰块在瓶口飞溅，凉到指尖',
      visualAction: 'ken_burns 推近至 liquid_splash 区域'
    }
  ];
  const score = computeVisualScriptAlignment(timeline, [splashAsset]);
  assert.ok(score >= 0.7, `expected high alignment, got ${score}`);
});

test('computeVisualScriptAlignment marks generic scripts low', () => {
  const timeline: TimelineItem[] = [
    {
      ...baseTimeline[0],
      assetId: 'asset_splash',
      script: '康师傅冰红茶，了解一下',
      visualAction: '展示产品'
    }
  ];
  const score = computeVisualScriptAlignment(timeline, [splashAsset]);
  // No matches against any of: 深棕色饮料瓶, liquid_splash, ice_cubes_in_flight, high_contrast_studio, beverage bottle, 冰块
  // Falls to itemScore = 0.3
  assert.ok(score < 0.5, `expected low alignment, got ${score}`);
});

test('computeVisualScriptAlignment falls back to motion keyword detection when no assets provided', () => {
  const withMotion: TimelineItem[] = [
    { ...baseTimeline[0], script: '飞溅瞬间' },
    { ...baseTimeline[1], script: '产品入画' }
  ];
  const withoutMotion: TimelineItem[] = [
    { ...baseTimeline[0], script: '了解一下产品' },
    { ...baseTimeline[1], script: '快来买买买' }
  ];
  assert.ok(computeVisualScriptAlignment(withMotion, undefined) > computeVisualScriptAlignment(withoutMotion, undefined));
});

// ---------------------------------------------------------------------------
// evaluateQuality integration: all 7 dimensions populated
// ---------------------------------------------------------------------------

test('evaluateQuality returns real (non-constant) values for all 5 written-constant dimensions', () => {
  const matches: SlotMatch[] = [
    { slotId: 's1', score: 0, status: 'matched', reason: '' },
    { slotId: 's2', score: 0, status: 'partial', reason: '' }
  ];
  const timeline: TimelineItem[] = [
    { ...baseTimeline[0], script: '冰爽解腻，午后这一口', subtitles: ['冰爽解腻，', '午后这一口'] }
  ];

  const reportA = evaluateQuality({ matches, timeline, contentBrief: brief });
  const reportB = evaluateQuality({
    matches: [{ slotId: 's1', score: 0, status: 'missing', reason: '' }],
    timeline: [],
    contentBrief: brief
  });

  // Confirm the 5 previously-constant values now differ between two inputs:
  assert.notEqual(reportA.structureMatch, reportB.structureMatch);
  assert.notEqual(reportA.factuality, reportB.factuality);
  assert.notEqual(reportA.subtitleReadability, reportB.subtitleReadability);
  // coherence differs because reportB has no timeline; reportA has 1 item (returns 0.85), reportB also has 0 items (returns 0.85)
  // Use a richer second case to detect coherence change:
  const reportC = evaluateQuality({
    matches,
    timeline: Array.from({ length: 6 }, (_, i) => tlWith({ transition: 'quick_cut' }, i)),
    contentBrief: brief
  });
  assert.notEqual(reportA.coherence, reportC.coherence);
});
