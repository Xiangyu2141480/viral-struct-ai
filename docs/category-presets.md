# Category Preset Registry

## Purpose

The Category Preset Registry maps generic viral motion grammar, transition grammar, and sonic grammar into target-category-native equivalents.

It exists so future transition recipe generators and audio plan generators can depend on a category preset instead of hardcoding a demo product.

## Current Presets

| presetId | targetCategory | role |
|---|---|---|
| `generic_default` | `generic` | Safe fallback when no dedicated category preset exists. |
| `beverage_refresh_demo` | `beverage` | Beverage mapping with `kangshifu_iced_tea` as a demo product only. |

Supported future categories are reserved but currently fall back to `generic` unless a dedicated preset is added:

- `beauty`
- `food`
- `electronics`
- `fashion`
- `home_goods`

## Preset Fields

Each preset contains:

- `presetId`
- `targetCategory`
- `demoProduct` when the preset includes a checked demo case
- `objectMappings`
- `recipeTemplates`
- `transitionFunctions`
- `sonicPreset`
- `fallbackPolicy`
- `notes`

Object mappings explain how source motif tokens are translated into category-native objects:

- `object_rain`
- `chaos_to_order`
- `activation`
- `spectacle_burst`
- `cta_reveal`

Sonic mappings explain how the same motif should sound:

- `object_rain`
- `activation`
- `spectacle_burst`
- `cta_reveal`

Recipe templates are the category-owned transition names and action patterns consumed by `TransitionRecipeGenerator`. Core services read them from the selected preset instead of hardcoding a demo product.

## Beverage Demo Boundary

`kangshifu_iced_tea` is only a demo product under the beverage preset:

```txt
targetCategory = beverage
demoProduct = kangshifu_iced_tea
presetId = beverage_refresh_demo
```

Examples such as Ice Cube Rain, Lemon Cascade, Tea Storm, and Heatwave Break are beverage preset mappings. They must not be copied into core registry logic, renderer logic, or future category generators.

## Generic Fallback

Use `resolveCategoryPreset(targetCategory)`:

- If an exact preset exists, it returns that preset.
- If no exact preset exists, it returns `generic_default`.
- The response preserves `requestedCategory` and sets `fallbackUsed=true`.
- Future categories such as `beauty` or `electronics` are intentionally allowed and currently fall back to generic until their own preset file is added.

## How To Add A New Category

1. Create a new file in `apps/api/src/services/presets`, for example `beautyPreset.ts`.
2. Export a `CategoryPreset`.
3. Keep demo product names inside that preset only.
4. Add the preset to the `PRESETS` array in `categoryPresetRegistry.ts`.
5. Add tests for:
   - exact preset resolution
   - generic fallback remains unchanged
   - core registry does not contain demo-product names
6. Add a small docs example under `docs/examples`.

## Implementation Boundary

This registry does not:

- call external models
- generate images, audio, or videos
- modify UI
- render transitions or sound
- claim real CTR, conversion, or user behavior

It is a planning and handoff layer for downstream transition, audio, Video Agent, HyperFrames, AIGC, and renderer work.
