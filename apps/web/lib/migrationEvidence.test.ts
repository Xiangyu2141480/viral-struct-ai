import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  AssetCard,
  ContentBrief,
  GapRepair,
  MaterialGap,
  SlotMatch,
  TimelineItem,
  ViralStructureGraph
} from '@viral-struct/shared';
import { buildMigrationEvidenceRows } from './migrationEvidence';

test('buildMigrationEvidenceRows joins source structure, asset match, gap, repair, and timeline', () => {
  const graph: ViralStructureGraph = {
    meta: { duration: 4, aspectRatio: '9:16', videoType: 'ecommerce', style: 'high_click' },
    structureSummary: 'Hook to CTA',
    segments: [
      {
        id: 'seg_hook',
        role: 'hook',
        start: 0,
        end: 2,
        duration: 2,
        purpose: '抓住注意力',
        transferRule: '迁移为冰爽开场',
        importance: 5
      }
    ],
    shotSlots: [
      {
        id: 'slot_hook',
        segmentId: 'seg_hook',
        role: 'opening_attention',
        requiredAsset: { type: 'image', subject: '强视觉开场' },
        fallbackStrategies: ['text_card'],
        importance: 5,
        intent: {
          purpose: '用高能产品画面制造停留',
          energyLevel: 'high',
          motionPattern: '快速推近',
          compositionPrincipal: '产品居中',
          durationMs: [1200, 1800]
        },
        sourceInstance: {
          productInSource: '源片产品',
          specificAction: '产品入画',
          colorSignature: '冷暖对比'
        },
        acceptanceCriteria: {
          anyOf: [{ motionType: 'push_in', compositionType: 'center', examples: ['冰块飞溅'] }],
          rejectIf: ['复制源片产品']
        }
      }
    ],
    rhythm: { avgShotDuration: 2, cutFrequency: 'high', pattern: 'fast_hook' },
    packaging: {
      captionDensity: 'high',
      captionPosition: 'bottom_center',
      titleStyle: 'large_bold',
      cardTypes: ['title_card'],
      transitions: ['quick_cut'],
      coverStyle: 'product_title'
    },
    creativeIngredients: [],
    edges: []
  };

  const brief: ContentBrief = {
    productName: '康师傅冰红茶',
    targetAudience: '夏季通勤人群',
    scenario: '午后高温',
    sellingPoints: ['冰爽解腻'],
    cta: '来一瓶冰红茶。'
  };

  const asset: AssetCard = {
    id: 'asset_splash',
    type: 'image',
    detectedObjects: ['bottle'],
    suitableSlots: ['opening_attention'],
    qualityScore: 0.88,
    visualContent: {
      primarySubject: '冰红茶瓶身',
      subjectPosition: 'center',
      kinematicElements: ['ice_splash']
    }
  };

  const match: SlotMatch = {
    slotId: 'slot_hook',
    assetId: 'asset_splash',
    score: 0.88,
    status: 'partial',
    reason: '素材可表达冰爽，但缺少真实动作。'
  };

  const gap: MaterialGap = {
    slotId: 'slot_hook',
    role: 'opening_attention',
    type: 'missing_opening_visual',
    severity: 'medium',
    reason: '缺少真实入画视频。',
    impact: '会削弱开场冲击。',
    affectedSegmentId: 'seg_hook'
  };

  const repair: GapRepair = {
    slotId: 'slot_hook',
    strategy: 'text_card',
    explanation: '用标题卡和产品推近补足开场。',
    gapSpec: {
      alternativeIfNoShoot: '使用 asset_splash 加 push_in 和冰爽标题。'
    }
  };

  const timeline: TimelineItem[] = [
    {
      id: 'tl_1',
      start: 0,
      end: 2,
      segmentRole: 'hook',
      sourceSegmentId: 'seg_hook',
      slotId: 'slot_hook',
      assetId: 'asset_splash',
      script: '午后这一口，冰爽醒神。',
      subtitles: ['午后这一口', '冰爽醒神'],
      visualAction: '产品推近到冰块飞溅',
      packaging: { captionStyle: 'click_large_bottom_bold', cardType: 'title_card', transition: 'push', motion: 'push_in' },
      repair
    }
  ];

  const rows = buildMigrationEvidenceRows({
    structureGraph: graph,
    contentBrief: brief,
    assetCards: [asset],
    slotMatches: [match],
    materialGaps: [gap],
    repairs: [repair],
    timeline,
    storyboard: []
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source.slotId, 'slot_hook');
  assert.match(rows[0].source.intent, /高能产品画面/);
  assert.match(rows[0].mapping.summary, /康师傅冰红茶/);
  assert.equal(rows[0].asset.assetId, 'asset_splash');
  assert.equal(rows[0].gap.hasGap, true);
  assert.equal(rows[0].repair.strategy, 'text_card');
  assert.equal(rows[0].final.timelineId, 'tl_1');
});
