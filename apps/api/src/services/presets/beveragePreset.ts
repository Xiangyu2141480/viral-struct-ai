import type { CategoryPreset } from './genericPreset';

export const beveragePreset: CategoryPreset = {
  presetId: 'beverage_refresh_demo',
  targetCategory: 'beverage',
  demoProduct: 'kangshifu_iced_tea',
  displayName: 'Beverage refresh demo preset',
  objectMappings: {
    object_rain: {
      sourcePattern: 'Falling or cascading source objects create a high-energy entry.',
      targetObjects: ['ice cubes', 'lemon slices', 'tea droplets', 'brand color chips'],
      transitionFunctions: ['heat_to_refresh', 'ingredient_to_product', 'chaos_to_order'],
      visualPromptHints: [
        'Use Ice Cube Rain, Lemon Cascade, or Tea Storm as beverage-native motion.',
        'Keep product and label readable after the cascade resolves.'
      ],
      bannedSourceTerms: ['keyboard', 'laptop', 'rocket', 'hardware UI'],
      notes: ['Ice tea is a demo product inside beverage, not a core service dependency.']
    },
    chaos_to_order: {
      sourcePattern: 'Chaotic source elements assemble into a clean product state.',
      targetObjects: ['ingredients converge into product scene'],
      transitionFunctions: ['chaos_to_order', 'ingredient_to_product'],
      visualPromptHints: ['Ingredients should converge into a bottle, cup, or product lock-up scene.'],
      bannedSourceTerms: ['device assembly', 'keyboard fragments'],
      notes: ['Preserve assembly logic while replacing object semantics.']
    },
    activation: {
      sourcePattern: 'Interaction activates the reveal or opens the next purchase/CTA state.',
      targetObjects: ['cap pop', 'pour', 'bottle touch'],
      transitionFunctions: ['product_to_cta', 'usage_to_benefit'],
      visualPromptHints: ['Map activation to cap opening, pour-to-cup, or tactile bottle touch.'],
      bannedSourceTerms: ['touchpad', 'screen UI', 'source device button'],
      notes: ['Supports open_cap and pour moments without hardcoding a single action.']
    },
    spectacle_burst: {
      sourcePattern: 'A peak burst turns attention into emotional payoff.',
      targetObjects: ['cold mist', 'splash', 'fizz'],
      transitionFunctions: ['heat_to_refresh', 'texture_shift'],
      visualPromptHints: ['Heatwave Break can become cold mist, splash, or fizz burst.'],
      bannedSourceTerms: ['rocket explosion', 'confetti from source scene'],
      notes: ['Use category-native refresh signals.']
    },
    cta_reveal: {
      sourcePattern: 'Final reveal becomes a purchase or action frame.',
      targetObjects: ['product end card', 'CTA lock-up'],
      transitionFunctions: ['product_to_cta', 'proof_to_cta'],
      visualPromptHints: ['End on a stable product frame with safe space for CTA copy.'],
      bannedSourceTerms: ['source checkout UI', 'source logo'],
      notes: ['Final frame is a handoff target for renderer or HyperFrames.']
    }
  },
  recipeTemplates: [
    {
      id: 'beverage_heatwave_shatter',
      name: 'Heatwave Shatter',
      mappingKey: 'spectacle_burst',
      transitionFunction: 'heat_to_refresh',
      transitionAction: 'Break a hot, tense hook frame into a cold refresh texture burst.',
      emotionShift: 'from heat pressure to instant refresh',
      narrativeFunction: 'problem_to_solution',
      preferredImplementationModes: {
        withAssets: 'cut_only',
        missingAssets: 'storyboard_image'
      }
    },
    {
      id: 'beverage_ice_cube_rain_wipe',
      name: 'Ice Cube Rain Wipe',
      mappingKey: 'object_rain',
      transitionFunction: 'ingredient_to_product',
      transitionAction: 'Use falling category-native refresh objects as a wipe into product focus.',
      emotionShift: 'from scattered impact to focused product desire',
      narrativeFunction: 'ingredient_to_product',
      preferredImplementationModes: {
        withAssets: 'cut_only',
        missingAssets: 'external_video_generation'
      }
    },
    {
      id: 'beverage_lemon_slice_match_cut',
      name: 'Lemon Slice Match Cut',
      mappingKey: 'object_rain',
      transitionFunction: 'ingredient_to_product',
      transitionAction: 'Match a round ingredient motion into a readable product or cup frame.',
      emotionShift: 'from ingredient cue to flavor clarity',
      narrativeFunction: 'ingredient_to_product',
      preferredImplementationModes: {
        withAssets: 'cut_only',
        missingAssets: 'storyboard_image'
      }
    },
    {
      id: 'beverage_tea_swirl_morph',
      name: 'Tea Swirl Morph',
      mappingKey: 'chaos_to_order',
      transitionFunction: 'chaos_to_order',
      transitionAction: 'Let swirling refresh textures converge into a clean product scene.',
      emotionShift: 'from kinetic chaos to organized product clarity',
      narrativeFunction: 'chaos_to_order',
      preferredImplementationModes: {
        withAssets: 'remotion',
        missingAssets: 'storyboard_image'
      }
    },
    {
      id: 'beverage_condensation_wipe',
      name: 'Condensation Wipe',
      mappingKey: 'spectacle_burst',
      transitionFunction: 'texture_shift',
      transitionAction: 'Use a cold texture wipe to move from proof detail into benefit memory.',
      emotionShift: 'from visual proof to sensory freshness',
      narrativeFunction: 'usage_to_benefit',
      preferredImplementationModes: {
        withAssets: 'cut_only',
        missingAssets: 'hyperframes'
      }
    },
    {
      id: 'beverage_cap_pop_transition',
      name: 'Cap Pop Transition',
      mappingKey: 'activation',
      transitionFunction: 'usage_to_benefit',
      transitionAction: 'Use a product interaction beat to activate the next benefit frame.',
      emotionShift: 'from passive viewing to tactile refresh',
      narrativeFunction: 'usage_to_benefit',
      preferredImplementationModes: {
        withAssets: 'cut_only',
        missingAssets: 'storyboard_image'
      }
    },
    {
      id: 'beverage_chaos_to_cta_transition',
      name: 'Chaos-to-CTA Transition',
      mappingKey: 'cta_reveal',
      transitionFunction: 'product_to_cta',
      transitionAction: 'Resolve the high-energy assembly into a clean end frame and CTA lock-up.',
      emotionShift: 'from excitement to purchase-ready clarity',
      narrativeFunction: 'product_to_cta',
      preferredImplementationModes: {
        withAssets: 'cut_only',
        missingAssets: 'hyperframes'
      }
    }
  ],
  transitionFunctions: ['heat_to_refresh', 'ingredient_to_product', 'chaos_to_order', 'product_to_cta', 'usage_to_benefit'],
  sonicPreset: {
    id: 'sonic_beverage_refresh_demo',
    targetCategory: 'beverage',
    motifMappings: {
      object_rain: ['rapid light hits', 'ice ticks'],
      chaos_to_order: ['rising fizz', 'clean resolve'],
      activation: ['cap pop', 'click'],
      spectacle_burst: ['fizz burst', 'shimmer'],
      cta_reveal: ['two-note logo sting']
    },
    cueDefaults: [
      {
        cueType: 'music_bed',
        narrativeFunction: 'hook',
        soundDescription: 'bright summer music bed under the full structure',
        emotionalEffect: 'keeps energy coherent across hook, proof and CTA',
        duration: 16,
        fallback: 'Silent render with visible beat and caption structure.'
      },
      {
        cueType: 'ambient',
        narrativeFunction: 'hook',
        soundDescription: 'heat ambience under the opening hook',
        emotionalEffect: 'sets up heat pressure before refresh',
        duration: 1.2,
        fallback: 'Silent hook with visual heat cue.'
      },
      {
        cueType: 'silence',
        narrativeFunction: 'transition',
        soundDescription: 'silence dip before the first refresh hit',
        emotionalEffect: 'creates a tiny anticipation gap',
        duration: 0.25,
        fallback: 'Visual beat marker only.'
      },
      {
        cueType: 'transition_sound',
        narrativeFunction: 'transition',
        soundDescription: 'ice cube rain hits across the wipe',
        emotionalEffect: 'turns falling objects into rhythmic attention',
        duration: 1,
        fallback: 'Captioned transition cue.'
      },
      {
        cueType: 'impact',
        narrativeFunction: 'hook',
        soundDescription: 'ice impact on the main beat',
        emotionalEffect: 'makes the first refresh moment feel physical',
        duration: 0.35,
        fallback: 'Hard visual cut.'
      },
      {
        cueType: 'foley',
        narrativeFunction: 'product_reveal',
        soundDescription: 'cap pop as activation foley',
        emotionalEffect: 'adds tactile product proof',
        duration: 0.4,
        fallback: 'Use visible cap action without sound.'
      },
      {
        cueType: 'impact',
        narrativeFunction: 'product_reveal',
        soundDescription: 'fizz / cold mist burst on the reveal',
        emotionalEffect: 'turns the product reveal into a freshness payoff',
        duration: 0.6,
        fallback: 'Use cold mist visual only.'
      },
      {
        cueType: 'foley',
        narrativeFunction: 'usage_demo',
        soundDescription: 'tea splash during pour-to-cup proof',
        emotionalEffect: 'supports usage evidence',
        duration: 0.8,
        fallback: 'Show pour frame without audio.'
      },
      {
        cueType: 'whoosh',
        narrativeFunction: 'transition',
        soundDescription: 'lemon slice whoosh for match cut',
        emotionalEffect: 'makes flavor cue feel fast and clean',
        duration: 0.45,
        fallback: 'Use visual match cut only.'
      },
      {
        cueType: 'transition_sound',
        narrativeFunction: 'transition',
        soundDescription: 'condensation wipe with soft shimmer',
        emotionalEffect: 'signals cold texture and premium freshness',
        duration: 0.5,
        fallback: 'Use condensation card/visual only.'
      },
      {
        cueType: 'cta_sound',
        narrativeFunction: 'cta',
        soundDescription: 'CTA pop before final copy',
        emotionalEffect: 'pushes the viewer toward action',
        duration: 0.35,
        fallback: 'Hold CTA card silently.'
      },
      {
        cueType: 'logo_sting',
        narrativeFunction: 'brand_memory',
        soundDescription: 'logo sting with clean two-note resolve',
        emotionalEffect: 'supports brand memory without claiming final audio',
        duration: 0.65,
        fallback: 'Silent final lock-up.'
      }
    ],
    warnings: ['Beverage sonic cues are plan-only. Use licensed or reviewed audio before final render.']
  },
  fallbackPolicy: {
    mode: 'exact',
    reason: 'Dedicated beverage preset is available.',
    safeDefaults: ['product packshot', 'cap or pour action', 'copy card', 'silent fallback'],
    unsupportedCategories: []
  },
  notes: ['Demo product mapping is scoped to beverage_refresh_demo and should not be imported into core logic.']
};
