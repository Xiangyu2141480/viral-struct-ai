import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import {
  AudioGenerationJobCardSchema,
  AudioTrackPlanSchema,
  BeatSyncMapSchema,
  SoundGapSchema,
  type TimelineItem,
  type TransitionRecipe
} from '@viral-struct/shared';
import { generateAudioPlan } from './audioPlanGenerator';

const timeline: TimelineItem[] = [
  {
    id: 'tl_hook',
    start: 0,
    end: 3,
    segmentRole: 'hook',
    sourceSegmentId: 'segment_hook',
    slotId: 'slot_hook',
    script: '热浪开场，冰爽反差进入。',
    subtitles: ['热浪开场'],
    visualAction: 'hot scene breaks into cold product reveal',
    packaging: { captionStyle: 'bold', cardType: 'title_card', transition: 'quick_cut', motion: 'push_in' }
  },
  {
    id: 'tl_product',
    start: 3,
    end: 8,
    segmentRole: 'selling_point',
    sourceSegmentId: 'segment_product',
    slotId: 'slot_product',
    script: '冰块、柠檬和茶感聚拢到瓶身。',
    subtitles: ['冰爽茶感'],
    visualAction: 'ingredient cascade resolves into product closeup',
    packaging: { captionStyle: 'clean', cardType: 'selling_point_card', transition: 'fade', motion: 'push_in' }
  },
  {
    id: 'tl_usage',
    start: 8,
    end: 13,
    segmentRole: 'usage',
    sourceSegmentId: 'segment_usage',
    slotId: 'slot_usage',
    script: '开盖、倒入杯中，冷感细节形成证明。',
    subtitles: ['开盖 倒入 冷感'],
    visualAction: 'cap pop and tea splash',
    packaging: { captionStyle: 'clean', transition: 'push', motion: 'pan' }
  },
  {
    id: 'tl_cta',
    start: 13,
    end: 16,
    segmentRole: 'cta',
    sourceSegmentId: 'segment_cta',
    slotId: 'slot_cta',
    script: '现在就来一瓶。',
    subtitles: ['现在就来一瓶'],
    visualAction: 'clean CTA end frame',
    packaging: { captionStyle: 'bold', cardType: 'cta_card', transition: 'quick_cut', motion: 'static' }
  }
];

const transitionRecipes: TransitionRecipe[] = [
  {
    id: 'transition_beverage_ice_cube_rain_wipe',
    name: 'Ice Cube Rain Wipe',
    sourceMotifType: 'kinetic_assembly_reveal',
    targetCategory: 'beverage',
    transitionFunction: 'ingredient_to_product',
    beforeShotId: 'tl_hook',
    afterShotId: 'tl_product',
    transitionAction: 'Use falling refresh objects as a wipe into product focus.',
    emotionShift: 'from heat to refresh',
    narrativeFunction: 'ingredient_to_product',
    motionGrammar: {
      id: 'motion_ice_rain',
      name: 'Ice rain grammar',
      motionTokens: ['component_cascade', 'impact_beat', 'chaos_to_order'],
      objectContinuity: 'ice cubes -> tea droplets -> product closeup',
      rhythm: 'beat_cut',
      emotionalBridge: 'from heat to refresh',
      notes: ['plan-only']
    },
    requiredAssets: [],
    missingAssetFallback: {
      mode: 'external_generation_brief',
      description: 'Missing falling-object footage can become an external generation job card.',
      limitations: ['plan-only']
    },
    implementationMode: 'external_video_generation',
    storyboardPrompt: 'Ice cube rain wipe into product closeup.',
    videoPrompt: 'Plan-only beverage transition.',
    ipRiskNotes: ['review before rendering'],
    ownership: 'transition_plan_only_not_rendered'
  },
  {
    id: 'transition_beverage_cap_pop_transition',
    name: 'Cap Pop Transition',
    targetCategory: 'beverage',
    transitionFunction: 'usage_to_benefit',
    beforeShotId: 'tl_product',
    afterShotId: 'tl_usage',
    transitionAction: 'Use a cap pop beat to activate the benefit frame.',
    emotionShift: 'from passive viewing to tactile refresh',
    narrativeFunction: 'usage_to_benefit',
    motionGrammar: {
      id: 'motion_cap_pop',
      name: 'Cap pop grammar',
      motionTokens: ['snap_open', 'activation_moment', 'impact_beat'],
      objectContinuity: 'cap pop -> pour -> benefit proof',
      rhythm: 'beat_cut',
      emotionalBridge: 'from passive viewing to tactile refresh',
      notes: ['plan-only']
    },
    requiredAssets: [],
    missingAssetFallback: {
      mode: 'storyboard_prompt',
      description: 'Missing cap action can become a manual shoot brief.',
      limitations: ['plan-only']
    },
    implementationMode: 'storyboard_image',
    storyboardPrompt: 'Cap pop activates benefit frame.',
    videoPrompt: 'Plan-only cap pop transition.',
    ipRiskNotes: ['review before rendering'],
    ownership: 'transition_plan_only_not_rendered'
  }
];

test('generateAudioPlan creates a beverage plan-only cue sequence and job cards without real audio assets', () => {
  const result = generateAudioPlan({
    timeline,
    transitionRecipes,
    targetCategory: 'beverage',
    productBrief: {
      productName: '康师傅冰红茶',
      targetAudience: 'young summer shoppers',
      scenario: 'hot outdoor commute',
      sellingPoints: ['ice-cold refresh', 'lemon tea taste'],
      cta: '现在就来一瓶'
    },
    variant: 'high_click',
    durationSec: 16
  });

  AudioTrackPlanSchema.parse(result.audioTrackPlan);
  BeatSyncMapSchema.parse(result.beatSyncMap);
  z.array(SoundGapSchema).parse(result.soundGaps);
  z.array(AudioGenerationJobCardSchema).parse(result.audioGenerationJobs);

  assert.equal(result.audioTrackPlan.mode, 'plan_only');
  assert.equal(result.audioTrackPlan.hasRenderableAudio, false);
  assert.ok(result.audioTrackPlan.warnings.some((warning) => warning.includes('No renderable audio assets')));
  assert.ok(result.audioGenerationJobs.length > 0);
  assert.ok(result.audioGenerationJobs.every((job) => job.ownership === 'external_audio_job_card_only'));

  const cueDescriptions = result.cues.map((cue) => cue.soundDescription.toLowerCase()).join('\n');
  for (const expected of [
    'heat ambience',
    'silence dip',
    'ice cube rain hits',
    'ice impact',
    'cap pop',
    'fizz',
    'tea splash',
    'lemon slice whoosh',
    'condensation wipe',
    'cta pop',
    'logo sting'
  ]) {
    assert.ok(cueDescriptions.includes(expected), `Expected cue descriptions to include ${expected}`);
  }

  const hookCues = result.cues.filter((cue) => cue.startTime < 3);
  assert.ok(hookCues.some((cue) => cue.variantBehavior?.high_click?.includes('stronger')));
});

test('generateAudioPlan falls back to the generic sonic preset for unsupported categories', () => {
  const result = generateAudioPlan({
    timeline,
    transitionRecipes: [],
    targetCategory: 'beauty',
    productBrief: { productName: 'Generic product' },
    variant: 'premium',
    durationSec: 12
  });

  assert.equal(result.audioTrackPlan.targetCategory, 'generic');
  assert.ok(result.warnings.some((warning) => warning.includes('generic preset')));
  assert.ok(result.audioTrackPlan.cues.some((cue) => cue.cueType === 'music_bed'));
});

test('generateAudioPlan annotates available audio assets without claiming MP4 mixing', () => {
  const result = generateAudioPlan({
    timeline,
    transitionRecipes,
    targetCategory: 'beverage',
    productBrief: { productName: '康师傅冰红茶' },
    variant: 'high_conversion',
    availableAudioAssets: [
      {
        id: 'licensed_bgm_001',
        kind: 'bgm',
        cueTypes: ['music_bed'],
        label: 'licensed summer bed',
        source: 'licensed_library',
        licenseStatus: 'cleared'
      },
      {
        id: 'user_sfx_cap_pop',
        kind: 'sfx',
        cueTypes: ['foley', 'impact'],
        label: 'user uploaded cap pop',
        source: 'user_upload',
        licenseStatus: 'needs_review'
      }
    ],
    durationSec: 16
  });

  assert.equal(result.audioTrackPlan.hasRenderableAudio, false);
  assert.ok(result.audioTrackPlan.warnings.some((warning) => warning.includes('not mixed into MP4')));
  assert.ok(result.cues.some((cue) => cue.assetId === 'licensed_bgm_001' && cue.licenseStatus === 'cleared'));
  assert.ok(result.cues.some((cue) => cue.assetId === 'user_sfx_cap_pop' && cue.licenseStatus === 'needs_review'));
  assert.ok(result.cues.some((cue) => cue.variantBehavior?.high_conversion?.includes('CTA')));
});

test('audio plan beverage demo fixture validates and stays plan-only', () => {
  const fixturePath = path.resolve(process.cwd(), '../../docs/examples/audio-plan-beverage-demo.sample.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    audioTrackPlan: unknown;
    beatSyncMap: unknown;
    soundGaps: unknown[];
    audioGenerationJobs: unknown[];
    disclaimer: string;
  };

  const plan = AudioTrackPlanSchema.parse(fixture.audioTrackPlan);
  BeatSyncMapSchema.parse(fixture.beatSyncMap);
  z.array(SoundGapSchema).parse(fixture.soundGaps);
  z.array(AudioGenerationJobCardSchema).parse(fixture.audioGenerationJobs);

  assert.equal(plan.ownership, 'audio_plan_only_not_generated');
  assert.equal(plan.hasRenderableAudio, false);
  assert.ok(fixture.disclaimer.includes('No real audio generated'));
});
