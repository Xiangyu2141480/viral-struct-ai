import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  ContentBrief,
  GapRepair,
  MaterialGap,
  MissingMaterialGenerationJob,
  QualityReport,
  SlotMatch,
  StoryboardFrame,
  TimelineItem,
  ViralStructureGraph
} from '@viral-struct/shared';
import { estimateDemoAnalytics } from './demoScoringEstimator';

const brief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏季通勤人群',
  scenario: '午后高温',
  sellingPoints: ['冰爽解腻', '柠檬茶香'],
  cta: '想要冰爽解腻，就来一瓶康师傅冰红茶。',
  stylePreference: '清爽高点击'
};

const graph: ViralStructureGraph = {
  meta: { duration: 10, aspectRatio: '9:16', videoType: 'ecommerce', style: 'high_click' },
  structureSummary: 'Hook -> usage -> CTA',
  segments: [
    { id: 'seg_hook', role: 'hook', start: 0, end: 2, duration: 2, purpose: '强开头', transferRule: '迁移高能 hook', importance: 5 },
    { id: 'seg_usage', role: 'usage', start: 2, end: 7, duration: 5, purpose: '使用场景', transferRule: '迁移场景表达', importance: 4 },
    { id: 'seg_cta', role: 'cta', start: 7, end: 10, duration: 3, purpose: '行动收束', transferRule: '迁移 CTA', importance: 4 }
  ],
  shotSlots: [
    { id: 'slot_hook', segmentId: 'seg_hook', role: 'opening_attention', requiredAsset: { type: 'image', subject: '高能开场' }, fallbackStrategies: ['text_card'], importance: 5 },
    { id: 'slot_usage', segmentId: 'seg_usage', role: 'usage_demo', requiredAsset: { type: 'video', subject: '饮用动作' }, fallbackStrategies: ['selling_point_card'], importance: 4 },
    { id: 'slot_cta', segmentId: 'seg_cta', role: 'cta_visual', requiredAsset: { type: 'generated', subject: 'CTA' }, fallbackStrategies: ['cta_card'], importance: 4 }
  ],
  rhythm: { avgShotDuration: 3.3, cutFrequency: 'high', pattern: 'fast_hook_then_cta' },
  packaging: {
    captionDensity: 'medium',
    captionPosition: 'bottom_center',
    titleStyle: 'large_bold',
    cardTypes: ['title_card', 'selling_point_card', 'cta_card'],
    transitions: ['quick_cut'],
    coverStyle: 'product_cover'
  },
  creativeIngredients: [],
  edges: []
};

const slotMatches: SlotMatch[] = [
  { slotId: 'slot_hook', assetId: 'asset_hook', score: 0.9, status: 'matched', reason: '高能开场适配' },
  { slotId: 'slot_usage', score: 0.35, status: 'missing', reason: '缺少动作' },
  { slotId: 'slot_cta', score: 0.7, status: 'partial', reason: '可用卡片补足' }
];

const gaps: MaterialGap[] = [
  { slotId: 'slot_usage', role: 'usage_demo', type: 'missing_usage_demo', severity: 'high', reason: '缺少饮用动作', impact: '场景表达不足' },
  { slotId: 'slot_cta', role: 'cta_visual', type: 'missing_cta_visual', severity: 'medium', reason: '缺少 CTA 画面', impact: '结尾转化弱' }
];

const repairs: GapRepair[] = [
  { slotId: 'slot_usage', strategy: 'selling_point_card', explanation: '用卖点卡补足场景表达。' },
  { slotId: 'slot_cta', strategy: 'cta_card', explanation: '用 CTA 卡片收束。' }
];

const timeline: TimelineItem[] = [
  {
    id: 'tl_hook',
    start: 0,
    end: 2,
    segmentRole: 'hook',
    sourceSegmentId: 'seg_hook',
    slotId: 'slot_hook',
    script: '热到没精神？先冰一下。',
    subtitles: ['热到没精神', '先冰一下'],
    visualAction: '冰块飞溅推近产品',
    packaging: { captionStyle: 'bold_title', cardType: 'title_card', transition: 'quick_cut', motion: 'push_in' },
    scriptSource: 'template'
  },
  {
    id: 'tl_usage',
    start: 2,
    end: 7,
    segmentRole: 'usage',
    sourceSegmentId: 'seg_usage',
    slotId: 'slot_usage',
    script: '运动后和饭后来一口，冰爽解腻。',
    subtitles: ['运动后', '饭后', '冰爽解腻'],
    visualAction: '卖点卡补足饮用动作',
    packaging: { captionStyle: 'selling', cardType: 'selling_point_card', transition: 'push', motion: 'static' },
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
    visualAction: 'CTA 卡片收束',
    packaging: { captionStyle: 'cta', cardType: 'cta_card', transition: 'fade', motion: 'static' },
    repair: repairs[1],
    scriptSource: 'template'
  }
];

const storyboardFrames: StoryboardFrame[] = [
  {
    id: 'frame_hook',
    frameIndex: 0,
    frameType: 'opening_hook',
    title: '开场抓停分镜',
    timelineItemId: 'tl_hook',
    slotId: 'slot_hook',
    structureIntent: '高能开场',
    sourceInstance: '源片快速入画',
    acceptanceCriteria: ['快速推近', '产品清晰'],
    imagePrompt: {
      positivePrompt: '康师傅冰红茶 high energy hook',
      negativePrompt: '不要照搬源片商品',
      aspectRatio: '9:16',
      styleHints: ['high click'],
      promptSource: 'storyboard_prompt_planner'
    },
    safetyStatus: { status: 'passed', ipRisk: 'low', brandRisk: 'low', claimRisk: 'low', reasons: ['safe'] },
    rationale: 'hook'
  }
];

const jobs: MissingMaterialGenerationJob[] = [
  {
    id: 'job_usage',
    gapId: 'slot_usage',
    repairId: 'slot_usage:selling_point_card',
    timelineItemId: 'tl_usage',
    provider: 'mock',
    providerLabel: 'Dry-run adapter / Seedance-ready spec',
    mode: 'text_to_video',
    status: 'planned',
    durationSec: 5,
    aspectRatio: '9:16',
    positivePrompt: '康师傅冰红茶 usage support clip',
    negativePrompt: '不要声称已生成视频',
    shotSpec: '手持饮用动作',
    gapType: 'missing_usage_demo',
    gapSeverity: 'high',
    repairStrategy: 'selling_point_card',
    safetyStatus: { status: 'passed', ipRisk: 'low', brandRisk: 'low', claimRisk: 'low', reasons: ['safe'] },
    disclaimer: 'External generation plan, not current core output.'
  },
  {
    id: 'job_cta',
    gapId: 'slot_cta',
    repairId: 'slot_cta:cta_card',
    timelineItemId: 'tl_cta',
    provider: 'mock',
    providerLabel: 'Dry-run adapter / Seedance-ready spec',
    mode: 'image_to_video',
    status: 'planned',
    durationSec: 3,
    aspectRatio: '9:16',
    positivePrompt: '康师傅冰红茶 CTA support clip',
    negativePrompt: '不要声称已生成视频',
    shotSpec: 'CTA 卡片收束',
    gapType: 'missing_cta_visual',
    gapSeverity: 'medium',
    repairStrategy: 'cta_card',
    storyboardFrameId: 'frame_cta',
    safetyStatus: { status: 'passed', ipRisk: 'low', brandRisk: 'low', claimRisk: 'low', reasons: ['safe'] },
    disclaimer: 'External generation plan, not current core output.'
  }
];

const qualityReport: QualityReport = {
  structureMatch: 0.78,
  slotCoverage: 0.72,
  visualScriptAlignment: 0.8,
  factuality: 0.86,
  coherence: 0.82,
  subtitleReadability: 0.78,
  transitionFidelity: 0.75,
  warnings: []
};

test('estimateDemoAnalytics returns deterministic offline scores with required disclaimers', () => {
  const first = estimateDemoAnalytics({
    structureGraph: graph,
    contentBrief: brief,
    slotMatches,
    materialGaps: gaps,
    repairs,
    timeline,
    storyboardFrames,
    missingMaterialJobs: jobs,
    qualityReport,
    generationVariant: 'high_click'
  });
  const second = estimateDemoAnalytics({
    structureGraph: graph,
    contentBrief: brief,
    slotMatches,
    materialGaps: gaps,
    repairs,
    timeline,
    storyboardFrames,
    missingMaterialJobs: jobs,
    qualityReport,
    generationVariant: 'high_click'
  });

  assert.deepEqual(first, second);
  assert.match(first.disclaimer, /Offline heuristic estimate/);
  assert.match(first.disclaimer, /Not based on real user behavior/);
  assert.equal(first.metrics.templateFit.formula, '0.35*SlotMatchAvg + 0.20*SegmentCoverage + 0.20*BriefIntentAlignment + 0.15*RhythmCompatibility + 0.10*PackagingCompatibility');
  assert.ok(first.metrics.gapRepairCoverage.score > 90);
  assert.ok(first.metrics.estimatedCtrLift.simulated);
  assert.match(first.metrics.estimatedCtrLift.label, /simulated/i);
  assert.ok(first.metrics.viralPotential.explanation.length > 20);
  assert.ok(Object.values(first.metrics).every((metric) => metric.explanation.length > 0));
});
