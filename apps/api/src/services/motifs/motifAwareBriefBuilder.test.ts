import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import type { ContentBrief, ShotSlotNode } from '@viral-struct/shared';
import { MissingMaterialBriefSchema } from '@viral-struct/shared';
import { buildMissingMaterialBriefs } from '../assetManager/missingMaterialBriefBuilder';
import { buildMotifAwareBriefs } from './motifAwareBriefBuilder';
import { extractViralMotifAnnotation } from './viralMotifExtractor';

const contentBrief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏天需要解渴的年轻用户',
  scenario: 'ready-to-drink iced tea beverage',
  sellingPoints: ['冰爽解腻'],
  cta: '马上来一瓶',
  stylePreference: 'summer energetic'
};

const slotBlock004: ShotSlotNode = {
  id: 'slot_block_004_asset_001',
  segmentId: 'segment_block_004',
  role: 'usage_demo',
  requiredAsset: {
    type: 'video',
    subject: 'source-specific surreal interaction',
    motion: 'fast_cut'
  },
  fallbackStrategies: ['hand_demo'],
  intent: {
    purpose: '键盘碎片在空中飞舞后落到笔记本上自动组装完成，手指按触控板控制屏幕里的火箭飞出笔记本炸开撒彩屑，按圆形按键弹出购买窗口。',
    energyLevel: 'high',
    motionPattern: 'component cascade, chaos to order, assembly completion, interaction activation, spectacle burst, CTA reveal',
    compositionPrincipal: 'surreal kinetic assembly reveal',
    durationMs: [1600, 4200]
  },
  sourceInstance: {
    productInSource: 'MacBook',
    specificAction: 'keyboard fragments assemble, touchpad controls rocket, circular button opens purchase window'
  },
  acceptanceCriteria: {
    anyOf: [
      {
        motionType: 'keyboard fragments fly then assemble on laptop',
        compositionType: 'hardware activation spectacle',
        examples: ['rocket flies out of laptop', 'purchase window pops up']
      }
    ]
  }
};

test('buildMotifAwareBriefs keeps kinetic assembly structure in beverage-native briefs', () => {
  const motif = extractViralMotifAnnotation({
    slot: slotBlock004,
    targetCategory: 'beverage'
  });
  assert.ok(motif);

  const briefs = buildMotifAwareBriefs({
    motif,
    contentBrief,
    referenceAssetIds: ['plain_001_table_product_pan']
  });

  assert.ok(briefs);
  assert.deepEqual(briefs.manualShootBrief.mustCapture, [
    'ice drop',
    'cap opening',
    'pour to cup',
    'cold detail with droplets or mist',
    'clean CTA end frame'
  ]);
  assert.match(briefs.aigcGenerationBrief.prompt, /ice cubes/i);
  assert.match(briefs.aigcGenerationBrief.prompt, /lemon slices/i);
  assert.match(briefs.aigcGenerationBrief.prompt, /tea droplets/i);
  assert.match(briefs.aigcGenerationBrief.prompt, /cold mist/i);
  assert.match(briefs.aigcGenerationBrief.prompt, /chaos-to-order ingredient cascade/i);
  assert.match(briefs.aigcGenerationBrief.negativePrompt, /no keyboard/i);
  assert.match(briefs.aigcGenerationBrief.negativePrompt, /no laptop/i);
  assert.match(briefs.aigcGenerationBrief.negativePrompt, /no rocket/i);
  assert.match(briefs.aigcGenerationBrief.negativePrompt, /no hardware/i);

  const positiveSurface = [
    briefs.manualShootBrief.shotDescription,
    briefs.aigcGenerationBrief.prompt,
    briefs.hyperframesBrief.visualElements.join(' '),
    briefs.hyperframesBrief.animationHints.join(' ')
  ].join(' ').toLowerCase();
  for (const banned of ['keyboard', 'laptop', 'touchpad', 'rocket', 'hardware', 'macbook', 'apple', '键盘', '笔记本', '触控板', '火箭']) {
    assert.equal(positiveSurface.includes(banned.toLowerCase()), false, `positive surface leaked ${banned}`);
  }

  assert.equal(JSON.stringify(briefs).includes('fallbackCards'), false);
  assert.equal(JSON.stringify(briefs).includes('suggestedRepair'), false);
});

test('usage demo plain template remains available for ordinary usage slots', () => {
  const motif = extractViralMotifAnnotation({
    slot: {
      ...slotBlock004,
      id: 'slot_usage_plain',
      requiredAsset: {
        type: 'video',
        subject: 'ordinary bottle opening and drinking',
        motion: 'hand_operation'
      },
      intent: {
        purpose: '手拿起瓶子，打开瓶盖，喝一口冰红茶。',
        energyLevel: 'medium',
        motionPattern: 'hand pickup, open cap, drink',
        compositionPrincipal: 'ordinary usage demo',
        durationMs: [1200, 2600]
      },
      sourceInstance: {
        productInSource: 'iced tea bottle',
        specificAction: 'hand pickup, open cap, drink'
      },
      acceptanceCriteria: {
        anyOf: [
          {
            motionType: 'open cap and drink',
            compositionType: 'product usage closeup',
            examples: ['hand opens cap', 'bottle remains visible']
          }
        ]
      }
    },
    targetCategory: 'beverage'
  });

  assert.equal(motif, undefined);
});

test('motif-aware sample JSON validates as MissingMaterialBrief and remains handoff-only', () => {
  const samplePath = join(process.cwd(), '../../docs/examples/motif-aware-brief-slot-block-004.sample.json');
  const sample = JSON.parse(readFileSync(samplePath, 'utf8'));

  const parsed = MissingMaterialBriefSchema.parse(sample);

  assert.equal(parsed.ownership, 'asset_manager_handoff_brief_only');
  assert.equal(parsed.affectedSlotId, 'slot_block_004_asset_001');
  assert.match(parsed.aigcGenerationBrief?.prompt ?? '', /chaos-to-order ingredient cascade/i);
  assert.equal(JSON.stringify(parsed).includes('fallbackCards'), false);
  assert.equal(JSON.stringify(parsed).includes('suggestedRepair'), false);
});

test('buildMissingMaterialBriefs uses motif-aware templates for kinetic assembly slots', () => {
  const result = buildMissingMaterialBriefs({
    structureGraph: {
      meta: {
        duration: 10,
        aspectRatio: '9:16',
        videoType: 'ecommerce',
        style: 'high_click'
      },
      structureSummary: 'Kinetic assembly reveal structure.',
      segments: [
        {
          id: 'segment_block_004',
          role: 'usage',
          start: 3,
          end: 7,
          duration: 4,
          purpose: 'kinetic reveal',
          transferRule: 'transfer motion grammar only',
          importance: 5
        }
      ],
      shotSlots: [slotBlock004],
      rhythm: {
        avgShotDuration: 1.2,
        cutFrequency: 'high',
        pattern: 'chaos-to-order reveal'
      },
      packaging: {
        captionDensity: 'medium',
        captionPosition: 'bottom_center',
        titleStyle: 'bold',
        cardTypes: ['benefit_card'],
        transitions: ['cut'],
        coverStyle: 'clean CTA lock-up'
      },
      creativeIngredients: [],
      edges: []
    },
    contextualCoverage: {
      graphId: 'test_graph',
      libraryId: 'test_library',
      coverageSummary: {
        totalSlots: 1,
        coveredSlots: 0,
        weakSlots: 0,
        insufficientSlots: 1,
        coverageScore: 0
      },
      slotCoverages: [
        {
          slotId: slotBlock004.id,
          affectedSegmentId: slotBlock004.segmentId,
          slotRole: 'usage_demo',
          slotIntent: slotBlock004.intent?.purpose ?? '',
          requiredIngredients: [],
          availableIngredients: [],
          missingIngredients: [
            {
              requiredIngredientId: 'missing_motif_action',
              label: 'kinetic beverage assembly action',
              reason: 'Kinetic assembly reveal has no beverage-native footage.',
              evidence: ['slot_block_004 source motion grammar']
            }
          ],
          weakIngredients: [],
          candidateAssets: [],
          coverageStatus: 'insufficient',
          confidence: 'high',
          evidence: ['no matching footage'],
          limitations: ['ordinary open-cap footage would lose assembly structure']
        }
      ],
      observations: [],
      warnings: []
    },
    assetCards: [],
    contentBrief,
    materialScenario: {
      scenarioType: 'single_image_only',
      assetCount: 0,
      imageCount: 0,
      videoCount: 0,
      textCount: 0,
      generatedAssetCount: 0,
      realFootageCount: 0,
      evidenceCoverageScore: 0,
      completionFeasibilityScore: 45,
      summary: 'test scenario',
      strengths: [],
      weaknesses: ['missing kinetic motif footage'],
      recommendedDownstreamMode: 'single_image_motion_reuse',
      warnings: []
    }
  });

  const brief = result[0];
  assert.ok(brief);
  assert.equal(brief.ownership, 'asset_manager_handoff_brief_only');
  assert.ok(brief.manualShootBrief?.mustCapture.includes('ice drop'));
  assert.match(brief.aigcGenerationBrief?.prompt ?? '', /chaos-to-order ingredient cascade/i);
  assert.notEqual(brief.hyperframesBrief?.cardType, 'usage_placeholder_card');
});
