import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ContentBrief, GapRepair, MaterialGap, StoryboardFrame, TimelineItem } from '@viral-struct/shared';
import { planMissingMaterialGenerationJobs } from './missingMaterialGenerationPlanner';

const brief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏季通勤人群',
  scenario: '午后高温',
  sellingPoints: ['冰爽解腻', '柠檬茶香'],
  cta: '想要冰爽解腻，就来一瓶康师傅冰红茶。'
};

const gaps: MaterialGap[] = [
  {
    slotId: 'slot_usage',
    role: 'usage_demo',
    type: 'missing_usage_demo',
    severity: 'high',
    reason: '缺少手持饮用动作',
    impact: '使用场景表达不足',
    gapSpec: {
      ideal: '真实手持瓶身，拧开并饮用一口',
      minimalAcceptable: '产品与冰块场景动效',
      alternativeIfNoShoot: '卖点卡加推近动效'
    },
    gapSpecSource: 'rule_based'
  },
  {
    slotId: 'slot_cta',
    role: 'cta_visual',
    type: 'missing_cta_visual',
    severity: 'medium',
    reason: '缺少收口 CTA 画面',
    impact: '结尾转化弱'
  },
  {
    slotId: 'slot_low',
    role: 'benefit_visual',
    severity: 'low',
    reason: '轻微缺少辅助卖点画面',
    impact: '影响较小'
  }
];

const repairs: GapRepair[] = [
  {
    slotId: 'slot_usage',
    strategy: 'selling_point_card',
    explanation: '用场景卖点卡和推近动效补足饮用动作。'
  },
  {
    slotId: 'slot_cta',
    strategy: 'cta_card',
    explanation: '用 CTA 卡片补足结尾转化。'
  }
];

const timeline: TimelineItem[] = [
  {
    id: 'tl_usage',
    start: 4,
    end: 7,
    segmentRole: 'usage',
    sourceSegmentId: 'seg_usage',
    slotId: 'slot_usage',
    script: '运动后和饭后来一口。',
    subtitles: ['运动后', '饭后', '来一口'],
    visualAction: '用卖点卡补足饮用动作缺口',
    packaging: { captionStyle: 'clean', cardType: 'selling_point_card', transition: 'push', motion: 'static' },
    repair: repairs[0],
    scriptSource: 'template'
  },
  {
    id: 'tl_cta',
    start: 7,
    end: 10,
    segmentRole: 'cta',
    sourceSegmentId: 'seg_cta',
    slotId: 'slot_cta',
    script: '想要冰爽解腻，就来一瓶康师傅冰红茶。',
    subtitles: ['现在来一瓶'],
    visualAction: '红色 CTA 卡片收束',
    packaging: { captionStyle: 'cta', cardType: 'cta_card', transition: 'fade', motion: 'static' },
    repair: repairs[1],
    scriptSource: 'template'
  }
];

const storyboardFrame: StoryboardFrame = {
  id: 'storyboard_usage',
  frameIndex: 0,
  frameType: 'gap_repair',
  title: '缺口补全分镜',
  timelineItemId: 'tl_usage',
  slotId: 'slot_usage',
  structureIntent: '用使用场景补足卖点理解',
  sourceInstance: '源片动态入画',
  acceptanceCriteria: ['手持动作', '产品清晰', '夏日冰爽'],
  repair: repairs[0],
  imagePrompt: {
    positivePrompt: 'Prompt-ready commercial storyboard still for 康师傅冰红茶, hand drinking scene, ice tea bottle, summer.',
    negativePrompt: '不要照搬源片商品，不要混入其他品牌，不要医疗功效承诺',
    aspectRatio: '9:16',
    styleHints: ['清爽高点击'],
    promptSource: 'storyboard_prompt_planner'
  },
  generatedVisualAsset: {
    id: 'placeholder_usage',
    type: 'placeholder_svg',
    url: 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E',
    mimeType: 'image/svg+xml',
    generationSource: 'placeholder',
    promptId: 'prompt_usage',
    label: 'Prompt-ready storyboard draft'
  },
  safetyStatus: { status: 'passed', ipRisk: 'low', brandRisk: 'low', claimRisk: 'low', reasons: ['safe'] },
  rationale: 'gap repair'
};

test('planMissingMaterialGenerationJobs creates jobs for high and medium gaps only', () => {
  const result = planMissingMaterialGenerationJobs({
    materialGaps: gaps,
    repairs,
    timeline,
    storyboardFrames: [storyboardFrame],
    contentBrief: brief,
    aspectRatio: '9:16'
  });

  assert.equal(result.jobs.length, 2);
  assert.deepEqual(result.jobs.map((job) => job.gapId), ['slot_usage', 'slot_cta']);
  assert.equal(result.jobs[0].mode, 'image_to_video');
  assert.equal(result.jobs[1].mode, 'text_to_video');
  assert.equal(result.jobs[0].status, 'planned');
  assert.equal(result.jobs[0].provider, 'mock');
  assert.ok(result.jobs[0].providerLabel.includes('Seedance-ready'));
  assert.equal(result.jobs[0].timelineItemId, 'tl_usage');
  assert.equal(result.jobs[0].repairId, 'slot_usage:selling_point_card');
  assert.ok(result.jobs[0].positivePrompt.includes('康师傅冰红茶'));
  assert.ok(result.jobs[0].shotSpec.includes('真实手持瓶身'));
  assert.ok(result.jobs.every((job) => job.negativePrompt.includes('不要声称已生成视频')));
  assert.ok(result.warnings.some((warning) => warning.includes('No external video generation')));
});

test('planMissingMaterialGenerationJobs compacts generation prompts while preserving shotSpec evidence', () => {
  const result = planMissingMaterialGenerationJobs({
    materialGaps: gaps,
    repairs,
    timeline,
    storyboardFrames: [storyboardFrame],
    contentBrief: brief,
    aspectRatio: '9:16'
  });

  const job = result.jobs[0];
  const metadata = job.promptMetadata;

  assert.ok(job.positivePrompt.length <= 520, `prompt was ${job.positivePrompt.length} characters`);
  assert.ok(job.positivePrompt.includes('9:16'));
  assert.ok(job.positivePrompt.includes('康师傅冰红茶'));
  assert.ok(!job.positivePrompt.includes('External missing-material video generation plan'));
  assert.ok(!job.positivePrompt.includes('Source structure intent to transfer'));
  assert.ok(job.shotSpec.includes('真实手持瓶身'));
  assert.ok(job.shotSpec.includes('卖点卡加推近动效'));
  assert.equal(metadata?.source, 'prompt_compactor');
  assert.ok((metadata?.originalPositivePromptLength ?? 0) > job.positivePrompt.length);
  assert.equal(metadata?.shotSpecPreserved, true);
});

test('planMissingMaterialGenerationJobs blocks unsafe jobs instead of planning generation', () => {
  const result = planMissingMaterialGenerationJobs({
    materialGaps: [{
      slotId: 'slot_unsafe',
      role: 'usage_demo',
      severity: 'high',
      reason: '需要违法暴力血腥画面',
      impact: '不能安全生成'
    }],
    repairs: [{
      slotId: 'slot_unsafe',
      strategy: 'text_card',
      explanation: '不要生成危险画面。'
    }],
    timeline: [],
    storyboardFrames: [],
    contentBrief: brief,
    aspectRatio: '9:16'
  });

  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].status, 'blocked');
  assert.equal(result.jobs[0].safetyStatus.status, 'blocked');
  assert.ok(result.jobs[0].blockedReason?.includes('brand safety'));
});
