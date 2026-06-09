# Transition Grammar

Transition Grammar describes how one generated shot should move into the next:

```text
Before shot -> transition action -> after shot
```

It is not a decorative effect layer. In this project, transition planning is part of structure transfer: the system preserves the source video's transferable motion grammar, maps it to a target category, and records what assets or fallback briefs are needed before any renderer or external generation tool can execute it.

## Contract

`TransitionRecipe` is the primary handoff object. It is category-agnostic and plan-only.

Key fields:

- `beforeShot` / `afterShot`: readable descriptors of the adjacent timeline items.
- `transitionAction`: what motion or object bridge should happen between those shots.
- `emotionShift`: why the transition helps the viewer feel the intended change.
- `narrativeFunction`: the story function, such as `problem_to_solution`, `ingredient_to_product`, `proof_to_cta`, or `product_to_cta`.
- `motionGrammar`: transferable motion tokens and continuity rules.
- `requiredAssets`: target-category-native assets or ingredients needed to execute the recipe.
- `missingAssetFallback`: handoff if required footage or objects are absent.
- `implementationMode`: a proposed mode such as `cut_only`, `remotion`, `hyperframes`, `storyboard_image`, or `external_video_generation`.
- `ownership`: always `transition_plan_only_not_rendered`.

## Generator

`apps/api/src/services/transitions/transitionRecipeGenerator.ts` turns a timeline and optional motif context into `TransitionRecipe[]`.

Inputs:

- `TimelineItem[]`
- optional `MotifContext`
- optional `AssetSupplyContext`
- `targetCategory`
- product brief
- variant (`high_click`, `high_conversion`, `premium`)

The generator uses `CategoryPresetRegistry`. It does not hardcode a specific product in core logic. If a category-specific preset does not exist, it falls back to the generic preset.

## Beverage Demo Preset

The beverage preset includes an ice-tea demo mapping for evaluation and recording. This is scoped to `beverage_refresh_demo`; it is not a system-wide assumption.

Demo recipe names:

- Heatwave Shatter
- Ice Cube Rain Wipe
- Lemon Slice Match Cut
- Tea Swirl Morph
- Condensation Wipe
- Cap Pop Transition
- Chaos-to-CTA Transition

The sample fixture lives at:

```text
docs/examples/transition-recipes-beverage-demo.sample.json
```

## Judge-Facing Evidence

The minimal UI evidence layer should show transition planning as cards, not as a claim of rendered effects:

- `转场计划`: explains the planned recipe between adjacent beats.
- `缺失转场素材`: lists target-category-native objects or footage needed to execute the recipe.
- `Category Mapping`: explains how a source motion pattern maps to a new category.
- `Boundary`: always label this as `plan only` or `job card only`.

For the ice tea demo, the kinetic assembly logic is sanitized into beverage-native equivalents:

| Source motion logic | Beverage demo equivalent |
|---|---|
| object rain / component cascade | ice cube rain, lemon cascade, tea droplets |
| activation beat | cap pop, bottle touch, pour-to-cup proof |
| spectacle burst | cold mist, splash, fizz |
| clean CTA reveal | product end card and CTA lock-up |

This is how the project shows transition grammar without copying source-specific objects.

## Safety Boundary

Transition recipes do not call external video generation services, image APIs, or renderers. `external_video_generation` is only a future-adapter/job-card mode.

Do not claim these recipes are rendered output. They are a handoff layer for Video Agent, GapRepair, HyperFrames, Remotion, manual shooting, or an external generation adapter after review.

The prompt text should use target-category-native objects and avoid recreating source-specific product scenes.

The demo summary fixture is:

```text
docs/examples/transition-audio-demo-summary.sample.json
```
