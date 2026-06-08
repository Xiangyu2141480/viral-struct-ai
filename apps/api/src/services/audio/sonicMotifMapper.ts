import type {
  AudioCue,
  AudioCueType,
  AudioNarrativeFunction,
  SonicMotif,
  TargetCategory,
  TimelineItem,
  TransitionRecipe
} from '@viral-struct/shared';
import type { CategoryPreset, CategorySonicPreset } from '../presets/genericPreset';

export type AudioVariant = 'high_click' | 'high_conversion' | 'premium';

export interface SonicCueTemplate {
  cueType: AudioCueType;
  narrativeFunction: AudioNarrativeFunction;
  soundDescription: string;
  emotionalEffect: string;
  syncTarget?: string;
  duration?: number;
  fallback: string;
}

export interface MapSonicMotifsInput {
  preset: CategoryPreset;
  timeline: TimelineItem[];
  transitionRecipes: TransitionRecipe[];
  targetCategory: TargetCategory;
  variant: AudioVariant;
  durationSec: number;
}

export interface SonicMotifMappingResult {
  sonicMotifs: SonicMotif[];
  cueTemplates: SonicCueTemplate[];
}

export function mapSonicMotifs(input: MapSonicMotifsInput): SonicMotifMappingResult {
  const cueTemplates = buildCueTemplates(input.preset.sonicPreset);

  const cueSequence = cueTemplates.map((template, index) =>
    buildCueFromTemplate(template, index, input.timeline, input.variant, input.durationSec)
  );

  return {
    sonicMotifs: [
      {
        id: `sonic_motif_${input.preset.presetId}`,
        name: `${input.preset.displayName} sonic motif`,
        targetCategory: input.targetCategory,
        cueSequence,
        brandTone: input.preset.targetCategory === 'beverage' ? 'bright fresh summer energy' : 'safe category-neutral commercial tone',
        usageContext: summarizeUsageContext(input.timeline, input.transitionRecipes),
        warnings: input.preset.sonicPreset.warnings
      }
    ],
    cueTemplates
  };
}

export function buildCueFromTemplate(
  template: SonicCueTemplate,
  index: number,
  timeline: TimelineItem[],
  variant: AudioVariant,
  durationSec: number
): AudioCue {
  const startTime = chooseCueStartTime(template, index, timeline, durationSec);
  const cue: AudioCue = {
    id: `audio_cue_${index + 1}_${slugify(template.soundDescription)}`,
    cueType: template.cueType,
    narrativeFunction: template.narrativeFunction,
    startTime,
    duration: template.duration ?? 0.5,
    syncTarget: template.syncTarget ?? chooseSyncTarget(template.narrativeFunction, timeline),
    soundDescription: applyVariantDescription(template.soundDescription, variant, startTime),
    emotionalEffect: template.emotionalEffect,
    generationPrompt: `Plan-only ${template.soundDescription}. Do not use copyrighted music or claim generated audio.`,
    assetRequirement: describeAssetRequirement(template),
    source: 'planned',
    licenseStatus: 'unknown',
    fallback: template.fallback,
    variantBehavior: {
      high_click: startTime < 3 ? 'stronger hit / impact in the first 3 seconds' : 'keep cue short and rhythm-forward',
      high_conversion: template.narrativeFunction === 'cta' || template.narrativeFunction === 'brand_memory'
        ? 'CTA cue should be more explicit and action-oriented'
        : 'support proof and product clarity',
      premium: 'more restrained, with softer transient and more whitespace'
    }
  };
  return cue;
}

function buildCueTemplates(sonicPreset: CategorySonicPreset): SonicCueTemplate[] {
  return sonicPreset.cueDefaults.map((cueDefault) => ({
    cueType: cueDefault.cueType,
    narrativeFunction: cueDefault.narrativeFunction,
    soundDescription: cueDefault.soundDescription,
    emotionalEffect: cueDefault.emotionalEffect ?? 'supports structure transfer without category-specific overclaim',
    duration: cueDefault.duration ?? (cueDefault.cueType === 'music_bed' ? 6 : 0.5),
    syncTarget: cueDefault.syncTarget,
    fallback: cueDefault.fallback
  }));
}

function chooseCueStartTime(
  template: SonicCueTemplate,
  index: number,
  timeline: TimelineItem[],
  durationSec: number
): number {
  const cta = timeline.find((item) => item.segmentRole === 'cta');
  const proof = timeline.find((item) => item.segmentRole === 'proof' || item.segmentRole === 'usage');
  if (template.narrativeFunction === 'cta' || template.narrativeFunction === 'brand_memory') {
    return clamp((cta?.start ?? durationSec - 2) + (template.cueType === 'logo_sting' ? 1 : 0), 0, durationSec);
  }
  if (template.narrativeFunction === 'usage_demo' || template.narrativeFunction === 'proof') {
    return clamp(proof?.start ?? durationSec * 0.55, 0, durationSec);
  }
  if (template.narrativeFunction === 'product_reveal') {
    const sellingPoint = timeline.find((item) => item.segmentRole === 'selling_point');
    return clamp(sellingPoint?.start ?? durationSec * 0.35, 0, durationSec);
  }
  if (template.narrativeFunction === 'hook') {
    return index === 0 ? 0 : Math.min(2.6, durationSec);
  }
  return clamp(index * 1.15, 0, durationSec);
}

function chooseSyncTarget(narrativeFunction: AudioNarrativeFunction, timeline: TimelineItem[]): string {
  const preferred = timeline.find((item) => {
    if (narrativeFunction === 'cta' || narrativeFunction === 'brand_memory') {
      return item.segmentRole === 'cta';
    }
    if (narrativeFunction === 'product_reveal') {
      return item.segmentRole === 'selling_point';
    }
    if (narrativeFunction === 'usage_demo' || narrativeFunction === 'proof') {
      return item.segmentRole === 'usage' || item.segmentRole === 'proof';
    }
    return item.segmentRole === 'hook';
  });
  return preferred?.id ?? timeline[0]?.id ?? 'timeline_start';
}

function applyVariantDescription(description: string, variant: AudioVariant, startTime: number): string {
  if (variant === 'high_click' && startTime < 3) {
    return `${description}; stronger front-loaded hit for high-click variant`;
  }
  if (variant === 'high_conversion' && /cta|logo|final/i.test(description)) {
    return `${description}; CTA cue more explicit for high-conversion variant`;
  }
  if (variant === 'premium') {
    return `${description}; restrained transient and more silence for premium variant`;
  }
  return description;
}

function describeAssetRequirement(template: SonicCueTemplate): string {
  if (template.cueType === 'music_bed') {
    return 'licensed or user-provided BGM only';
  }
  if (template.cueType === 'silence') {
    return 'no audio asset required';
  }
  return 'licensed, user-provided, or externally generated SFX after review';
}

function summarizeUsageContext(timeline: TimelineItem[], transitionRecipes: TransitionRecipe[]): string {
  const roles = Array.from(new Set(timeline.map((item) => item.segmentRole))).join(', ');
  const transitions = transitionRecipes.map((recipe) => recipe.name).slice(0, 3).join(', ');
  return `Timeline roles: ${roles || 'unknown'}. Transition cues: ${transitions || 'generic structural cues'}.`;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42) || 'cue';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(value.toFixed(2))));
}
