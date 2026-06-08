import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TransitionRecipeSchema } from '@viral-struct/shared';
import type { MotifContext, TimelineItem } from '@viral-struct/shared';
import { generateTransitionRecipes } from './transitionRecipeGenerator';
import { selectTransitionPreset } from './transitionPresetSelector';

const timeline: TimelineItem[] = [
  {
    id: 'tl_hook',
    start: 0,
    end: 3,
    segmentRole: 'hook',
    sourceSegmentId: 'segment_hook',
    slotId: 'slot_hook',
    script: '热浪里，第一口冰爽先冲出来。',
    subtitles: ['热浪里，冰爽先到'],
    visualAction: 'sun glare breaks into a product reveal',
    packaging: { captionStyle: 'bold', cardType: 'title_card', transition: 'quick_cut', motion: 'push_in' }
  },
  {
    id: 'tl_ingredient',
    start: 3,
    end: 6,
    segmentRole: 'usage',
    sourceSegmentId: 'segment_ingredient',
    slotId: 'slot_ingredient',
    script: '冰块、柠檬和茶感一起聚拢。',
    subtitles: ['冰块 柠檬 茶感'],
    visualAction: 'ingredients cascade toward the bottle',
    packaging: { captionStyle: 'clean', transition: 'fade', motion: 'pan' }
  },
  {
    id: 'tl_product',
    start: 6,
    end: 9,
    segmentRole: 'selling_point',
    sourceSegmentId: 'segment_product',
    slotId: 'slot_product',
    assetId: 'asset_product_closeup',
    script: '冰红茶瓶身冷凝，清爽卖点提前出现。',
    subtitles: ['清爽卖点提前出现'],
    visualAction: 'product closeup with condensation',
    packaging: { captionStyle: 'clean', cardType: 'selling_point_card', transition: 'fade', motion: 'push_in' }
  },
  {
    id: 'tl_proof',
    start: 9,
    end: 13,
    segmentRole: 'proof',
    sourceSegmentId: 'segment_proof',
    slotId: 'slot_proof',
    script: '开盖、倒入杯中，冷感细节形成证明。',
    subtitles: ['开盖 倒入 冷感证明'],
    visualAction: 'cap pop and pour detail',
    packaging: { captionStyle: 'clean', transition: 'push', motion: 'pan' }
  },
  {
    id: 'tl_cta',
    start: 13,
    end: 16,
    segmentRole: 'cta',
    sourceSegmentId: 'segment_cta',
    slotId: 'slot_cta',
    assetId: 'asset_cta_packshot',
    script: '现在就来一瓶，给夏天降温。',
    subtitles: ['现在就来一瓶'],
    visualAction: 'clean end frame with CTA lock-up',
    packaging: { captionStyle: 'bold', cardType: 'cta_card', transition: 'quick_cut', motion: 'static' }
  }
];

const motifContext: MotifContext = {
  motifAnnotationId: 'motif_kinetic_assembly',
  motifType: 'kinetic_assembly_reveal',
  motionTokens: [
    'dynamic_entry',
    'component_cascade',
    'chaos_to_order',
    'assembly_completion',
    'interaction_activation',
    'spectacle_burst',
    'cta_reveal'
  ],
  missingMotionTokens: ['spectacle_burst'],
  sanitizedIntent: 'Dynamic ingredient assembly, interaction activation, spectacle burst, CTA reveal.',
  targetMotifHints: ['ice cubes', 'lemon slices', 'tea droplets', 'cold mist', 'CTA lock-up'],
  confidence: 0.86,
  evidence: ['source structure uses chaos-to-order assembly without copying source objects']
};

test('generateTransitionRecipes produces motif-aware beverage transition recipes without source-specific target prompts', () => {
    const recipes = generateTransitionRecipes({
      timeline,
      motifContext,
      targetCategory: 'beverage',
      productBrief: {
        productName: '康师傅冰红茶',
        sellingPoints: ['冰爽解渴', '柠檬茶感', '夏日场景'],
        cta: '现在就来一瓶'
      },
      variant: 'high_click'
    });

  assert.ok(recipes.length >= 5);
  assertRecipeNames(recipes, [
    'Heatwave Shatter',
    'Ice Cube Rain Wipe',
    'Lemon Slice Match Cut',
    'Tea Swirl Morph',
    'Condensation Wipe',
    'Cap Pop Transition',
    'Chaos-to-CTA Transition'
  ]);
  assertIncludesAll(
    recipes.map((recipe) => recipe.transitionFunction),
    ['chaos_to_order', 'ingredient_to_product', 'product_to_cta']
  );

  for (const recipe of recipes) {
    assert.ok(recipe.beforeShot);
    assert.ok(recipe.transitionAction);
    assert.ok(recipe.afterShot);
    assert.ok(recipe.emotionShift);
    assert.ok(recipe.narrativeFunction);
    assert.ok(recipe.requiredAssets.length > 0);
    assert.ok(recipe.missingAssetFallback.description.length > 0);
    assert.equal(recipe.ownership, 'transition_plan_only_not_rendered');
    assert.equal(recipe.targetCategory, 'beverage');
  }

  const promptText = recipes.map((recipe) => `${recipe.storyboardPrompt} ${recipe.videoPrompt}`).join('\n').toLowerCase();
  assert.doesNotMatch(promptText, /keyboard|laptop|rocket|hardware|macbook|apple/);
});

test('transition preset selector falls back to generic category preset when no category preset exists', () => {
  const selection = selectTransitionPreset({ targetCategory: 'beauty' });

  assert.equal(selection.fallbackUsed, true);
  assert.equal(selection.preset.targetCategory, 'generic');

  const recipes = generateTransitionRecipes({
    timeline,
    targetCategory: 'beauty',
    productBrief: { productName: 'Generic product' },
    variant: 'premium'
  });

  assert.ok(recipes.length > 0);
  assert.equal(recipes.every((recipe) => recipe.targetCategory === 'generic'), true);
});

test('beverage demo fixture stays aligned with the shared TransitionRecipe schema', () => {
  const fixturePath = resolve(process.cwd(), '../../docs/examples/transition-recipes-beverage-demo.sample.json');
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as unknown;

  const parsed = z.array(TransitionRecipeSchema).parse(fixture);
  assertRecipeNames(parsed, [
    'Heatwave Shatter',
    'Ice Cube Rain Wipe',
    'Lemon Slice Match Cut',
    'Tea Swirl Morph',
    'Condensation Wipe',
    'Cap Pop Transition',
    'Chaos-to-CTA Transition'
  ]);
});

function assertRecipeNames(recipes: Array<{ name: string }>, names: string[]): void {
  assertIncludesAll(
    recipes.map((recipe) => recipe.name),
    names
  );
}

function assertIncludesAll(actual: string[], expected: string[]): void {
  for (const item of expected) {
    assert.ok(actual.includes(item), `Expected ${JSON.stringify(actual)} to include ${item}`);
  }
}
