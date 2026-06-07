import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import type { AssetCard, ContentBrief, MaterialGap, SlotMatch, ViralStructureGraph } from '@viral-struct/shared';
import { analyticsRouter } from './analytics';
import { gapsRouter } from './gaps';
import { materialGenerationRouter } from './materialGeneration';
import { storyboardRouter } from './storyboard';
import { slotsRouter } from './slots';
import { timelineRouter } from './timeline';

let server: Server;
let baseUrl = '';

const previousEnv = {
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_BASE_URL: process.env.LLM_BASE_URL,
  LLM_MODEL: process.env.LLM_MODEL
};

const graph: ViralStructureGraph = {
  meta: { duration: 6, aspectRatio: '9:16', videoType: 'ecommerce', style: 'high_click' },
  structureSummary: 'Hook -> CTA',
  segments: [
    {
      id: 'seg_hook',
      role: 'hook',
      start: 0,
      end: 3,
      duration: 3,
      purpose: '抓住注意力',
      transferRule: '迁移为新商品强视觉开头',
      importance: 5
    },
    {
      id: 'seg_cta',
      role: 'cta',
      start: 3,
      end: 6,
      duration: 3,
      purpose: '促成行动',
      transferRule: '迁移为明确 CTA',
      importance: 4
    }
  ],
  shotSlots: [
    {
      id: 'slot_hook',
      segmentId: 'seg_hook',
      role: 'opening_attention',
      requiredAsset: { type: 'image', subject: '动感产品开头', motion: 'unknown' },
      visualIngredientRequirements: ['product_closeup_trait'],
      fallbackStrategies: ['text_card'],
      importance: 5,
      intent: {
        purpose: '用高能开场画面制造停留',
        energyLevel: 'high',
        motionPattern: '快速推近到产品飞溅中心',
        compositionPrincipal: '产品居中，占据视觉焦点',
        durationMs: [1200, 1800],
        soundDesignHint: '强拍入场'
      },
      sourceInstance: {
        productInSource: '源片产品',
        specificAction: '产品冲击画面开场',
        colorSignature: '高对比冷暖色'
      },
      acceptanceCriteria: {
        anyOf: [
          {
            motionType: 'product_splash',
            compositionType: 'center_focus',
            examples: ['产品飞溅', '冰块冲击', '快速推近']
          }
        ],
        rejectIf: ['照搬源片产品']
      }
    },
    {
      id: 'slot_cta',
      segmentId: 'seg_cta',
      role: 'cta_visual',
      requiredAsset: { type: 'generated', subject: '行动号召卡', motion: 'unknown' },
      fallbackStrategies: ['cta_card'],
      importance: 4
    }
  ],
  rhythm: { avgShotDuration: 3, cutFrequency: 'medium', pattern: 'hook_to_cta' },
  packaging: {
    captionDensity: 'medium',
    captionPosition: 'bottom_center',
    titleStyle: 'large_bold',
    cardTypes: ['title_card', 'cta_card'],
    transitions: ['quick_cut'],
    coverStyle: 'product_title'
  },
  creativeIngredients: [],
  edges: [],
  boundaries: [{ id: 'b1', from: 'seg_hook', to: 'seg_cta', transitionType: 'morph', intensity: 'strong' }]
};

const assetCards: AssetCard[] = [
  {
    id: 'asset_splash',
    type: 'image',
    detectedObjects: ['bottle', 'ice'],
    suitableSlots: ['opening_attention'],
    detectedIngredients: ['product_closeup_trait'],
    qualityScore: 0.9,
    visualContent: {
      primarySubject: '康师傅冰红茶瓶身',
      subjectPosition: 'center',
      kinematicElements: ['ice_splash']
    },
    motionPotential: {
      isStill: true,
      implicitMotion: 'high'
    }
  }
];

const contentBrief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏季通勤人群',
  scenario: '午后高温',
  sellingPoints: ['冰爽解腻', '柠檬茶香'],
  cta: '想要冰爽解腻，就来一瓶康师傅冰红茶。',
  stylePreference: '清爽高点击'
};

before(async () => {
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  process.env.LLM_MODEL = 'fake-model';

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/slots', slotsRouter);
  app.use('/api/gaps', gapsRouter);
  app.use('/api/timeline', timelineRouter);
  app.use('/api/storyboard', storyboardRouter);
  app.use('/api/material-generation', materialGenerationRouter);

  await new Promise<void>((resolveServer) => {
    server = app.listen(0, () => {
      const address = server.address();
      assert.notEqual(address, null);
      assert.notEqual(typeof address, 'string');
      baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolveServer();
    });
  });
});

after(async () => {
  restoreEnv('LLM_API_KEY', previousEnv.LLM_API_KEY);
  restoreEnv('LLM_BASE_URL', previousEnv.LLM_BASE_URL);
  restoreEnv('LLM_MODEL', previousEnv.LLM_MODEL);

  await new Promise<void>((resolveServer, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolveServer();
    });
  });
});

test('POST /api/slots/match exposes fallback alignment source when LLM is unavailable', async () => {
  const response = await fetch(`${baseUrl}/api/slots/match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ structureGraph: graph, assetCards, boundaries: graph.boundaries })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.alignmentSource, 'rule_based');
  assert.ok(body.warning.includes('LLM alignment failed'));
  assert.deepEqual(body.warnings, [body.warning]);
  assert.ok(body.matches.every((match: SlotMatch) => match.alignmentSource === 'rule_based'));
});

test('POST /api/gaps/repair exposes fallback gap-spec source when LLM is unavailable', async () => {
  const gap: MaterialGap = {
    slotId: 'slot_cta',
    role: 'cta_visual',
    type: 'missing_cta_visual',
    severity: 'high',
    reason: '缺少结尾 CTA 镜头',
    impact: '影响收束转化',
    affectedSegmentId: 'seg_cta'
  };

  const response = await fetch(`${baseUrl}/api/gaps/repair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gaps: [gap],
      assetCards,
      newContent: contentBrief,
      structureGraph: graph,
      boundaries: graph.boundaries
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.gapSpecSource, 'rule_based');
  assert.ok(body.warning.includes('LLM gap-spec failed'));
  assert.deepEqual(body.warnings, [body.warning]);
  assert.equal(body.repairs[0].slotId, 'slot_cta');
  assert.equal(body.repairs[0].strategy, 'cta_card');
});

test('POST /api/timeline/generate exposes fallback script source when LLM is unavailable', async () => {
  const match: SlotMatch = {
    slotId: 'slot_hook',
    assetId: 'asset_splash',
    score: 0.9,
    status: 'matched',
    reason: 'matched',
    alignmentSource: 'rule_based'
  };

  const response = await fetch(`${baseUrl}/api/timeline/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      structureGraph: graph,
      newContent: contentBrief,
      matches: [match],
      repairs: [],
      assets: assetCards,
      variant: 'high_click',
      boundaries: graph.boundaries
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.scriptSource, 'template');
  assert.ok(body.warning.includes('LLM script generation failed'));
  assert.deepEqual(body.warnings, [body.warning]);
  assert.ok(body.timeline.length >= 1);
  assert.ok(body.timeline.every((item: { scriptSource?: string }) => item.scriptSource === 'template'));
});

test('POST /api/timeline/apply-edit returns a real patch summary and changed timeline items', async () => {
  const timeline = [
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
      id: 'tl_cta',
      start: 3,
      end: 6,
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

  const response = await fetch(`${baseUrl}/api/timeline/apply-edit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      instruction: '开头更抓人',
      timeline,
      contentBrief
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.editType, 'hook_stronger');
  assert.ok(body.patchSummary.includes('开头'));
  assert.notEqual(body.updatedTimeline[0].script, timeline[0].script);
  assert.ok(body.updatedTimeline[0].end - body.updatedTimeline[0].start < 3);
  assert.ok(body.changedItems.some((item: { itemId: string }) => item.itemId === 'tl_hook'));
});

test('POST /api/storyboard/plan returns prompt-ready storyboard frames without image API keys', async () => {
  delete process.env.IMAGE_API_KEY;
  const response = await fetch(`${baseUrl}/api/storyboard/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      structureGraph: graph,
      contentBrief,
      assetCards,
      slotMatches: [
        {
          slotId: 'slot_hook',
          assetId: 'asset_splash',
          score: 0.9,
          status: 'matched',
          reason: 'matched',
          alignmentSource: 'rule_based'
        }
      ],
      materialGaps: [
        {
          slotId: 'slot_cta',
          role: 'cta_visual',
          type: 'missing_cta_visual',
          severity: 'high',
          reason: '缺少 CTA 画面',
          impact: '结尾转化弱'
        }
      ],
      repairs: [
        {
          slotId: 'slot_cta',
          strategy: 'cta_card',
          explanation: '用 CTA 卡片补足结尾。'
        }
      ],
      timeline: [
        {
          id: 'tl_hook',
          start: 0,
          end: 3,
          segmentRole: 'hook',
          sourceSegmentId: 'seg_hook',
          slotId: 'slot_hook',
          assetId: 'asset_splash',
          script: '热到没精神？先冰一下。',
          subtitles: ['热到没精神', '先冰一下'],
          visualAction: '冰块飞溅中推近康师傅冰红茶瓶身',
          packaging: { captionStyle: 'bold_title', cardType: 'title_card', transition: 'quick_cut', motion: 'push_in' },
          scriptSource: 'template'
        },
        {
          id: 'tl_cta',
          start: 3,
          end: 6,
          segmentRole: 'cta',
          sourceSegmentId: 'seg_cta',
          slotId: 'slot_cta',
          script: '想要冰爽解腻，就来一瓶康师傅冰红茶。',
          subtitles: ['现在来一瓶'],
          visualAction: '红色 CTA 卡片收束',
          packaging: { captionStyle: 'cta', cardType: 'cta_card', transition: 'fade', motion: 'static' },
          scriptSource: 'template'
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.frames.length >= 2);
  assert.ok(body.frames.length <= 5);
  assert.equal(body.frames[0].frameType, 'opening_hook');
  assert.ok(body.frames.every((frame: { imagePrompt?: { positivePrompt?: string } }) => frame.imagePrompt?.positivePrompt?.includes('康师傅冰红茶')));
  assert.ok(body.frames.every((frame: { generatedVisualAsset?: { generationSource?: string; url?: string } }) => frame.generatedVisualAsset?.generationSource === 'placeholder'));
  assert.ok(body.frames.every((frame: { generatedVisualAsset?: { url?: string } }) => frame.generatedVisualAsset?.url?.startsWith('data:image/svg+xml')));
  assert.ok(body.warnings.some((warning: string) => warning.includes('placeholder')));
});

test('POST /api/material-generation/plan returns external generation plans without submitting jobs', async () => {
  const response = await fetch(`${baseUrl}/api/material-generation/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      materialGaps: [
        {
          slotId: 'slot_cta',
          role: 'cta_visual',
          type: 'missing_cta_visual',
          severity: 'medium',
          reason: '缺少 CTA 画面',
          impact: '结尾转化弱'
        }
      ],
      repairs: [
        {
          slotId: 'slot_cta',
          strategy: 'cta_card',
          explanation: '用 CTA 卡片补足结尾。'
        }
      ],
      storyboardFrames: [
        {
          id: 'storyboard_cta',
          frameIndex: 0,
          frameType: 'cta_cover',
          title: 'CTA / 封面分镜',
          timelineItemId: 'tl_cta',
          slotId: 'slot_cta',
          structureIntent: '明确行动号召',
          sourceInstance: '源片结尾收束',
          acceptanceCriteria: ['产品清晰', 'CTA 明确'],
          imagePrompt: {
            positivePrompt: '康师傅冰红茶 CTA card, red product poster, summer refreshment.',
            negativePrompt: '不要照搬源片商品，不要混入其他品牌',
            aspectRatio: '9:16',
            styleHints: ['清爽高点击'],
            promptSource: 'storyboard_prompt_planner'
          },
          safetyStatus: { status: 'passed', ipRisk: 'low', brandRisk: 'low', claimRisk: 'low', reasons: ['safe'] },
          rationale: 'cta'
        }
      ],
      timeline: [
        {
          id: 'tl_cta',
          start: 3,
          end: 6,
          segmentRole: 'cta',
          sourceSegmentId: 'seg_cta',
          slotId: 'slot_cta',
          script: '想要冰爽解腻，就来一瓶康师傅冰红茶。',
          subtitles: ['现在来一瓶'],
          visualAction: '红色 CTA 卡片收束',
          packaging: { captionStyle: 'cta', cardType: 'cta_card', transition: 'fade', motion: 'static' },
          scriptSource: 'template'
        }
      ],
      contentBrief,
      aspectRatio: '9:16'
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.jobs.length, 1);
  assert.equal(body.jobs[0].mode, 'image_to_video');
  assert.equal(body.jobs[0].provider, 'mock');
  assert.equal(body.jobs[0].status, 'planned');
  assert.equal(body.jobs[0].timelineItemId, 'tl_cta');
  assert.ok(body.jobs[0].providerLabel.includes('Seedance-ready'));
  assert.ok(body.jobs[0].positivePrompt.includes('康师傅冰红茶'));
  assert.ok(body.warnings.some((warning: string) => warning.includes('not submitted')));
});

test('POST /api/analytics/demo-estimate returns simulated offline analytics only', async () => {
  const response = await fetch(`${baseUrl}/api/analytics/demo-estimate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      structureGraph: graph,
      contentBrief,
      slotMatches: [
        { slotId: 'slot_hook', assetId: 'asset_splash', score: 0.9, status: 'matched', reason: 'matched' },
        { slotId: 'slot_cta', score: 0.35, status: 'missing', reason: 'missing cta' }
      ],
      materialGaps: [
        { slotId: 'slot_cta', role: 'cta_visual', type: 'missing_cta_visual', severity: 'medium', reason: '缺少 CTA', impact: '转化弱' }
      ],
      repairs: [
        { slotId: 'slot_cta', strategy: 'cta_card', explanation: '用 CTA 卡片补足。' }
      ],
      timeline: [
        {
          id: 'tl_hook',
          start: 0,
          end: 3,
          segmentRole: 'hook',
          sourceSegmentId: 'seg_hook',
          slotId: 'slot_hook',
          script: '热到没精神？先冰一下。',
          subtitles: ['热到没精神'],
          visualAction: '冰块飞溅推近产品',
          packaging: { captionStyle: 'bold_title', cardType: 'title_card', transition: 'quick_cut', motion: 'push_in' },
          scriptSource: 'template'
        }
      ],
      qualityReport: { factuality: 0.82, structureMatch: 0.7, slotCoverage: 0.65, visualScriptAlignment: 0.7, coherence: 0.72, subtitleReadability: 0.78, warnings: [] },
      generationVariant: 'high_click'
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.demoEstimate.disclaimer, /Offline heuristic estimate/);
  assert.match(body.demoEstimate.metrics.estimatedCtrLift.label, /simulated/i);
  assert.equal(body.demoEstimate.metrics.estimatedCtrLift.simulated, true);
  assert.ok(body.demoEstimate.metrics.templateFit.score >= 0);
  assert.ok(body.demoEstimate.metrics.viralPotential.explanation.length > 0);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
