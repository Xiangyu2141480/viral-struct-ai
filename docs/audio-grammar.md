# Audio Grammar

Audio Grammar makes sound part of structure transfer instead of treating it as a generic background track.

The current layer is plan-only. It does not call TTS, music generation, SFX generation, audio mixing, or MP4 export.

## Purpose

The audio plan answers:

```text
Which sound cue supports this structure beat?
Where should it sync?
What asset is needed?
What happens if no reviewed audio exists?
```

It can describe:

- music bed
- foley
- impact hits
- whoosh and transition sounds
- silence dips
- logo or CTA stings
- beat sync
- variant-specific audio behavior

## Service

`apps/api/src/services/audio/audioPlanGenerator.ts` produces:

- `AudioTrackPlan`
- `AudioCue[]`
- `BeatSyncMap`
- `SoundGap[]`
- `AudioGenerationJobCard[]`

Inputs:

- `TimelineItem[]`
- `TransitionRecipe[]`
- target category
- product brief
- variant (`high_click`, `high_conversion`, `premium`)
- optional available audio assets
- optional duration

## Preset Mechanism

The generator uses `CategoryPresetRegistry`.

- `beverage_refresh_demo` contains beverage-specific sonic cues.
- unsupported or future categories fall back to `generic_default`.
- core audio services do not hardcode a specific product.

## Variant Behavior

- `high_click`: stronger front-loaded hit / impact in the first 3 seconds.
- `high_conversion`: clearer CTA and logo-sting cue behavior.
- `premium`: restrained transients, more silence, less busy cue density.

## Fallback Boundary

If no real audio assets are provided:

- `mode = plan_only`
- `hasRenderableAudio = false`
- warnings explain that no audio is mixed into MP4
- `AudioGenerationJobCard[]` can be generated as external handoff plans

If audio assets are provided:

- cues may reference `assetId`, `source`, and `licenseStatus`
- the service still does not assume those assets are mixed into MP4
- assets with `needs_review` remain visible for safety/license review

## Beverage Demo Fixture

The beverage demo fixture is:

```text
docs/examples/audio-plan-beverage-demo.sample.json
```

It includes cue concepts such as heat ambience, silence dip, ice cube rain hits, ice impact, cap pop, fizz / cold mist burst, tea splash, lemon slice whoosh, condensation wipe, CTA pop, and logo sting.

These are demo preset cues, not a universal system rule.

## Judge-Facing Evidence

The minimal evidence layer should show Sonic Grammar as reviewable cards:

- `Sonic Plan`: what cue sequence supports the structure.
- `Audio Warnings`: whether reviewed audio assets exist and whether audio is renderable.
- `AudioGenerationJobCard`: optional external handoff, never a claim that audio was generated.
- `BeatSyncMap`: offline beat/cue alignment for renderer or Video Agent handoff.

For the ice tea demo, sonic grammar supports the same structure transfer as visual and transition grammar:

| Structure moment | Sonic cue |
|---|---|
| hot opening / tension | heat ambience, silence dip |
| refresh impact | ice cube rain hits, ice impact |
| activation | cap pop, fizz / cold mist burst |
| usage proof | tea splash, lemon slice whoosh |
| CTA / brand memory | CTA pop, two-note logo sting |

All of this remains plan-only until reviewed audio assets or a real audio-generation adapter are connected.

The combined demo summary fixture is:

```text
docs/examples/transition-audio-demo-summary.sample.json
```
