import type {
  AudioCueType,
  AudioNarrativeFunction,
  TargetCategory,
  TransitionFunction,
  TransitionImplementationMode
} from '@viral-struct/shared';

export type CategoryPresetTarget = TargetCategory | string;

export interface CategoryObjectMapping {
  sourcePattern: string;
  targetObjects: string[];
  transitionFunctions: TransitionFunction[];
  visualPromptHints: string[];
  bannedSourceTerms: string[];
  notes: string[];
}

export interface CategorySonicPreset {
  id: string;
  targetCategory: TargetCategory;
  motifMappings: Record<string, string[]>;
  cueDefaults: Array<{
    cueType: AudioCueType;
    narrativeFunction: AudioNarrativeFunction;
    soundDescription: string;
    emotionalEffect?: string;
    duration?: number;
    syncTarget?: string;
    fallback: string;
  }>;
  warnings: string[];
}

export interface CategoryFallbackPolicy {
  mode: 'exact' | 'generic';
  reason: string;
  safeDefaults: string[];
  unsupportedCategories: string[];
}

export interface CategoryTransitionRecipeTemplate {
  id: string;
  name: string;
  mappingKey: keyof CategoryPreset['objectMappings'] | string;
  transitionFunction: TransitionFunction;
  transitionAction: string;
  emotionShift: string;
  narrativeFunction: TransitionFunction;
  preferredImplementationModes: {
    withAssets: TransitionImplementationMode;
    missingAssets: TransitionImplementationMode;
  };
}

export interface CategoryPreset {
  presetId: string;
  targetCategory: TargetCategory;
  demoProduct?: string;
  displayName: string;
  objectMappings: Record<string, CategoryObjectMapping>;
  recipeTemplates: CategoryTransitionRecipeTemplate[];
  transitionFunctions: TransitionFunction[];
  sonicPreset: CategorySonicPreset;
  fallbackPolicy: CategoryFallbackPolicy;
  notes: string[];
}

export const genericPreset: CategoryPreset = {
  presetId: 'generic_default',
  targetCategory: 'generic',
  displayName: 'Generic structure transfer preset',
  objectMappings: {
    object_rain: {
      sourcePattern: 'Many small elements enter quickly and create a transition beat.',
      targetObjects: ['category-native objects', 'texture particles', 'copy chips', 'abstract motion marks'],
      transitionFunctions: ['chaos_to_order', 'ingredient_to_product', 'scene_to_brand_world'],
      visualPromptHints: [
        'Use target-category-native elements instead of source objects.',
        'Resolve the motion into a readable product or benefit frame.'
      ],
      bannedSourceTerms: ['source brand', 'source product object', 'source UI'],
      notes: ['Fallback mapping for categories without a dedicated preset.']
    },
    chaos_to_order: {
      sourcePattern: 'Disordered elements converge into a clear product or claim.',
      targetObjects: ['organized product scene', 'benefit card', 'clean packshot'],
      transitionFunctions: ['chaos_to_order', 'usage_to_benefit'],
      visualPromptHints: ['Show the target idea becoming clearer across the cut.'],
      bannedSourceTerms: ['source layout', 'source logo'],
      notes: ['Use when the target category has no physical ingredient equivalent.']
    },
    activation: {
      sourcePattern: 'User action triggers a product reveal or state change.',
      targetObjects: ['hand action', 'product interaction', 'UI-safe benefit card'],
      transitionFunctions: ['product_to_cta', 'usage_to_benefit'],
      visualPromptHints: ['Map activation to a target product interaction or card motion.'],
      bannedSourceTerms: ['source device gesture', 'source control UI'],
      notes: ['Keep action generic unless a category preset overrides it.']
    },
    spectacle_burst: {
      sourcePattern: 'A peak visual burst makes the reveal memorable.',
      targetObjects: ['light burst', 'texture burst', 'copy emphasis', 'motion accent'],
      transitionFunctions: ['texture_shift', 'scene_to_brand_world'],
      visualPromptHints: ['Use a safe abstract burst if no product-native effect exists.'],
      bannedSourceTerms: ['source special effect identity'],
      notes: ['Plan-only; does not imply rendered VFX.']
    },
    cta_reveal: {
      sourcePattern: 'Final action resolves into CTA or brand lock-up.',
      targetObjects: ['end card', 'product lock-up', 'CTA copy surface'],
      transitionFunctions: ['product_to_cta', 'proof_to_cta'],
      visualPromptHints: ['Hold on a stable frame with safe copy space.'],
      bannedSourceTerms: ['source CTA UI'],
      notes: ['Useful across all categories.']
    }
  },
  recipeTemplates: [
    {
      id: 'generic_problem_solution_bridge',
      name: 'Problem-to-Solution Bridge',
      mappingKey: 'chaos_to_order',
      transitionFunction: 'problem_to_solution',
      transitionAction: 'Use category-native motion to turn a problem frame into a clear product or benefit frame.',
      emotionShift: 'from unresolved tension to clear relief',
      narrativeFunction: 'problem_to_solution',
      preferredImplementationModes: {
        withAssets: 'cut_only',
        missingAssets: 'storyboard_image'
      }
    },
    {
      id: 'generic_object_bridge',
      name: 'Category Object Bridge',
      mappingKey: 'object_rain',
      transitionFunction: 'ingredient_to_product',
      transitionAction: 'Let safe category-native objects carry the cut into the product scene.',
      emotionShift: 'from scattered attention to product focus',
      narrativeFunction: 'ingredient_to_product',
      preferredImplementationModes: {
        withAssets: 'cut_only',
        missingAssets: 'storyboard_image'
      }
    },
    {
      id: 'generic_cta_lockup',
      name: 'CTA Lock-up Transition',
      mappingKey: 'cta_reveal',
      transitionFunction: 'product_to_cta',
      transitionAction: 'Resolve the final product frame into a stable CTA lock-up.',
      emotionShift: 'from product clarity to action readiness',
      narrativeFunction: 'product_to_cta',
      preferredImplementationModes: {
        withAssets: 'cut_only',
        missingAssets: 'hyperframes'
      }
    }
  ],
  transitionFunctions: ['problem_to_solution', 'usage_to_benefit', 'proof_to_cta', 'product_to_cta', 'chaos_to_order'],
  sonicPreset: {
    id: 'sonic_generic_default',
    targetCategory: 'generic',
    motifMappings: {
      object_rain: ['rapid light hits', 'soft ticks'],
      chaos_to_order: ['rising whoosh', 'clean resolve'],
      activation: ['button click', 'short tactile pop'],
      spectacle_burst: ['impact accent', 'shimmer tail'],
      cta_reveal: ['soft logo sting', 'clean final hit']
    },
    cueDefaults: [
      {
        cueType: 'music_bed',
        narrativeFunction: 'hook',
        soundDescription: 'Neutral commercial bed that supports pacing without claiming final audio.',
        fallback: 'Silent playback with visible beat markers.'
      },
      {
        cueType: 'transition_sound',
        narrativeFunction: 'transition',
        soundDescription: 'Short generic transition accent.',
        fallback: 'Visual-only cut.'
      }
    ],
    warnings: ['Generic audio is plan-only and should be replaced by licensed or reviewed sound assets.']
  },
  fallbackPolicy: {
    mode: 'generic',
    reason: 'No dedicated category preset is available; use safe generic mappings.',
    safeDefaults: ['copy card', 'product lock-up', 'cut-only transition', 'silent or user-uploaded audio'],
    unsupportedCategories: []
  },
  notes: ['Core fallback preset. It must not contain demo-product-specific mappings.']
};
