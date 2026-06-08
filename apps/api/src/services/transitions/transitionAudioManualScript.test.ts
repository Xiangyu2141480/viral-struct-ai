import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildManualTransitionAudioPlanPayloads,
  buildTransitionAudioMarkdownReport
} from '../../../../../scripts/manual_test_transition_audio_plan';

test('manual transition/audio benchmark builds generic and beverage plan-only outputs', async () => {
  const result = await buildManualTransitionAudioPlanPayloads();

  assert.equal(result.generic.targetCategory, 'generic');
  assert.equal(result.beverage.targetCategory, 'beverage');
  assert.ok(result.generic.transitionRecipes.length > 0);
  assert.ok(result.beverage.transitionRecipes.length >= 5);
  assert.ok(result.generic.audio.cues.length > 0);
  assert.ok(result.beverage.audio.cues.length > 0);
  assert.equal(result.generic.audio.audioTrackPlan.hasRenderableAudio, false);
  assert.equal(result.beverage.audio.audioTrackPlan.hasRenderableAudio, false);
  assert.equal(result.generic.rendererHandoff.transitionRecipes.length, result.generic.transitionRecipes.length);
  assert.equal(result.beverage.rendererHandoff.transitionRecipes.length, result.beverage.transitionRecipes.length);
  assert.equal(result.generic.rendererHandoff.audioPlan.id, result.generic.audio.audioTrackPlan.id);
  assert.equal(result.beverage.rendererHandoff.audioCues.length, result.beverage.audio.cues.length);
  assert.ok(result.beverage.rendererHandoff.audioWarnings.length > 0);
  assert.ok(result.generic.warnings.some((warning) => warning.includes('No renderable audio assets')));
  assert.ok(result.beverage.warnings.some((warning) => warning.includes('No renderable audio assets')));

  const markdown = buildTransitionAudioMarkdownReport(result);
  assert.match(markdown, /# Transition & Audio Plan Manual Report/);
  assert.match(markdown, /## 3\. Transition Recipes/);
  assert.match(markdown, /## 4\. Audio Cues/);
  assert.match(markdown, /## 7\. Renderer Handoff/);

  const targetPromptText = [
    ...result.generic.transitionRecipes,
    ...result.beverage.transitionRecipes
  ]
    .map((recipe) => `${recipe.storyboardPrompt} ${recipe.videoPrompt}`)
    .join('\n')
    .toLowerCase();
  assert.doesNotMatch(targetPromptText, /keyboard|laptop|rocket|hardware|macbook|apple/);
});
