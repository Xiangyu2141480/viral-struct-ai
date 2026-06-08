import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  AudioTrackPlanSchema,
  TransitionAudioPlanBundleSchema,
  TransitionRecipeSchema
} from '@viral-struct/shared';

function readExample(name: string): unknown {
  const samplePath = path.resolve(process.cwd(), '../../docs/examples', name);
  return JSON.parse(readFileSync(samplePath, 'utf8'));
}

test('transition recipe sample validates as category-agnostic plan-only contract', () => {
  const sample = TransitionRecipeSchema.parse(readExample('transition-recipe.sample.json'));
  const serialized = JSON.stringify(sample).toLowerCase();

  assert.equal(sample.ownership, 'transition_plan_only_not_rendered');
  assert.equal(sample.targetCategory, 'beverage');
  assert.equal(sample.implementationMode, 'storyboard_image');
  assert.equal(serialized.includes('visual motif transfer score'), false);
  assert.equal(serialized.includes('real ctr'), false);
});

test('audio plan sample validates as plan-only contract without renderable audio claim', () => {
  const sample = AudioTrackPlanSchema.parse(readExample('audio-plan.sample.json'));

  assert.equal(sample.ownership, 'audio_plan_only_not_generated');
  assert.equal(sample.mode, 'plan_only');
  assert.equal(sample.hasRenderableAudio, false);
  assert.ok(sample.cues.some((cue) => cue.cueType === 'music_bed'));
  assert.ok(sample.cues.some((cue) => cue.cueType === 'transition_sound'));
});

test('transition audio bundle sample validates and keeps ice tea as a preset boundary', () => {
  const sample = TransitionAudioPlanBundleSchema.parse(readExample('transition-audio-plan-bundle.sample.json'));
  const serialized = JSON.stringify(sample).toLowerCase();

  assert.equal(sample.protocolVersion, 'transition-audio-plan-v1');
  assert.equal(sample.ownership, 'transition_audio_plan_only_not_rendered');
  assert.ok(sample.categoryPresets.some((preset) => preset.targetCategory === 'generic'));
  assert.ok(sample.categoryPresets.some((preset) => preset.targetCategory === 'beverage'));
  assert.ok(sample.audioGenerationJobs.every((job) => job.ownership === 'external_audio_job_card_only'));
  assert.equal(serialized.includes('real user data'), false);
  assert.equal(serialized.includes('visual motif transfer score'), false);
});

test('transition audio demo summary exposes judge-facing evidence cards without render claims', () => {
  const sample = readExample('transition-audio-demo-summary.sample.json') as {
    demoCase: { targetCategory: string; demoProduct: string };
    evidenceCards: Array<{ title: string; boundary: string }>;
    boundaries: string[];
  };
  const cardTitles = sample.evidenceCards.map((card) => card.title);
  const serialized = JSON.stringify(sample).toLowerCase();

  assert.equal(sample.demoCase.targetCategory, 'beverage');
  assert.equal(sample.demoCase.demoProduct, 'kangshifu_iced_tea');
  assert.deepEqual(cardTitles, [
    'Transition Plan',
    'Sonic Plan',
    'Missing Transition Assets',
    'Audio Warnings'
  ]);
  assert.ok(sample.evidenceCards.every((card) => /plan only|job card only|no real external generation/i.test(card.boundary)));
  assert.equal(serialized.includes('real ctr'), false);
  assert.equal(serialized.includes('estimatedctrlift'), false);
  assert.equal(serialized.includes('+18%'), false);
  assert.equal(serialized.includes('visual motif transfer score'), false);
});
