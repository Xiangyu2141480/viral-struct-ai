import type {
  AudioCue,
  AudioCueType,
  AudioGenerationJobCard,
  AudioTrackPlan,
  BeatSyncMap,
  ContentBrief,
  SoundGap,
  TargetCategory,
  TimelineItem,
  TransitionRecipe
} from '@viral-struct/shared';
import { selectTransitionPreset } from '../transitions/transitionPresetSelector';
import { buildBeatSyncMap } from './beatSyncPlanner';
import { mapSonicMotifs, type AudioVariant } from './sonicMotifMapper';

export interface AvailableAudioAsset {
  id: string;
  kind: 'bgm' | 'sfx' | 'foley' | 'source_audio' | 'logo_sting';
  cueTypes?: AudioCueType[];
  label: string;
  source: 'licensed_library' | 'user_upload' | 'source_audio' | 'unknown';
  licenseStatus: 'cleared' | 'needs_review' | 'unknown';
  durationSec?: number;
  url?: string;
}

export interface GenerateAudioPlanInput {
  timeline: TimelineItem[];
  transitionRecipes: TransitionRecipe[];
  targetCategory?: string;
  productBrief?: Partial<ContentBrief> & Record<string, unknown>;
  variant?: AudioVariant;
  availableAudioAssets?: AvailableAudioAsset[];
  durationSec?: number;
}

export interface AudioPlanGenerationResult {
  audioTrackPlan: AudioTrackPlan;
  cues: AudioCue[];
  beatSyncMap: BeatSyncMap;
  soundGaps: SoundGap[];
  audioGenerationJobs: AudioGenerationJobCard[];
  warnings: string[];
}

export function generateAudioPlan(input: GenerateAudioPlanInput): AudioPlanGenerationResult {
  const variant = input.variant ?? 'high_click';
  const durationSec = normalizeDuration(input.durationSec, input.timeline);
  const presetSelection = selectTransitionPreset({ targetCategory: input.targetCategory });
  const preset = presetSelection.preset;
  const targetCategory = preset.targetCategory;
  const motifResult = mapSonicMotifs({
    preset,
    timeline: input.timeline,
    transitionRecipes: input.transitionRecipes,
    targetCategory,
    variant,
    durationSec
  });

  const cues = attachAvailableAssets(motifResult.sonicMotifs[0]?.cueSequence ?? [], input.availableAudioAssets ?? []);
  const beatSyncMap = buildBeatSyncMap({ cues, durationSec, variant });
  const soundGaps = buildSoundGaps(cues, input.availableAudioAssets ?? []);
  const audioGenerationJobs = buildAudioGenerationJobs(cues, input.productBrief);
  const mode = chooseTrackMode(input.availableAudioAssets ?? []);
  const warnings = buildWarnings(presetSelection.warnings, input.availableAudioAssets ?? [], mode);

  const audioTrackPlan: AudioTrackPlan = {
    id: `audio_plan_${preset.presetId}_${variant}`,
    mode,
    hasRenderableAudio: false,
    targetCategory,
    sonicMotifs: motifResult.sonicMotifs,
    cues,
    beatSyncMap,
    soundGaps,
    warnings,
    ownership: 'audio_plan_only_not_generated'
  };

  return {
    audioTrackPlan,
    cues,
    beatSyncMap,
    soundGaps,
    audioGenerationJobs,
    warnings
  };
}

function normalizeDuration(durationSec: number | undefined, timeline: TimelineItem[]): number {
  if (typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0) {
    return Number(durationSec.toFixed(2));
  }
  const maxEnd = timeline.reduce((max, item) => Math.max(max, item.end), 0);
  return maxEnd > 0 ? Number(maxEnd.toFixed(2)) : 15;
}

function attachAvailableAssets(cues: AudioCue[], availableAudioAssets: AvailableAudioAsset[]): AudioCue[] {
  return cues.map((cue) => {
    const asset = findAssetForCue(cue, availableAudioAssets);
    if (!asset) {
      return cue;
    }

    return {
      ...cue,
      assetId: asset.id,
      source: asset.source,
      licenseStatus: asset.licenseStatus,
      assetRequirement: `${cue.assetRequirement ?? 'audio asset'}; matched asset: ${asset.label}`
    };
  });
}

function findAssetForCue(cue: AudioCue, assets: AvailableAudioAsset[]): AvailableAudioAsset | undefined {
  return assets.find((asset) => asset.cueTypes?.includes(cue.cueType))
    ?? assets.find((asset) => asset.kind === 'bgm' && cue.cueType === 'music_bed')
    ?? assets.find((asset) => asset.kind === 'logo_sting' && cue.cueType === 'logo_sting')
    ?? assets.find((asset) => (asset.kind === 'sfx' || asset.kind === 'foley') && cue.cueType !== 'music_bed' && cue.cueType !== 'silence');
}

function buildSoundGaps(cues: AudioCue[], availableAudioAssets: AvailableAudioAsset[]): SoundGap[] {
  const missingCueTypes = new Set(cues.filter((cue) => cue.cueType !== 'silence' && !cue.assetId).map((cue) => cue.cueType));
  const gaps: SoundGap[] = [];

  if (missingCueTypes.has('music_bed') || !availableAudioAssets.some((asset) => asset.kind === 'bgm')) {
    gaps.push({
      id: 'sound_gap_music_bed',
      gapType: 'missing_music_bed',
      affectedCueIds: cues.filter((cue) => cue.cueType === 'music_bed' || cue.narrativeFunction === 'hook').map((cue) => cue.id),
      severity: 'medium',
      reason: 'No licensed or user-provided music bed is attached.',
      fallback: 'Keep audio as plan-only or use silent demo playback.'
    });
  }

  if (['foley', 'impact', 'whoosh', 'transition_sound'].some((cueType) => missingCueTypes.has(cueType as AudioCueType))) {
    gaps.push({
      id: 'sound_gap_sfx',
      gapType: 'missing_foley',
      affectedCueIds: cues.filter((cue) => ['foley', 'impact', 'whoosh', 'transition_sound'].includes(cue.cueType) && !cue.assetId).map((cue) => cue.id),
      severity: 'medium',
      reason: 'Some planned SFX cues have no reviewed audio asset.',
      fallback: 'Use visible cue labels or external audio job cards.'
    });
  }

  if (missingCueTypes.has('logo_sting') || missingCueTypes.has('cta_sound')) {
    gaps.push({
      id: 'sound_gap_cta',
      gapType: missingCueTypes.has('logo_sting') ? 'missing_logo_sting' : 'missing_cta_sound',
      affectedCueIds: cues.filter((cue) => ['logo_sting', 'cta_sound'].includes(cue.cueType) && !cue.assetId).map((cue) => cue.id),
      severity: 'low',
      reason: 'CTA or brand-memory cue is planned but not backed by reviewed audio.',
      fallback: 'Hold final CTA frame silently or request user-uploaded sound.'
    });
  }

  return gaps;
}

function buildAudioGenerationJobs(cues: AudioCue[], productBrief: GenerateAudioPlanInput['productBrief']): AudioGenerationJobCard[] {
  return cues
    .filter((cue) => cue.cueType !== 'silence' && !cue.assetId)
    .map((cue, index) => ({
      id: `audio_job_${index + 1}_${cue.id.replace(/^audio_cue_/, '')}`,
      cueIds: [cue.id],
      providerHint: providerForCue(cue),
      prompt: `${cue.soundDescription}. Product context: ${getProductName(productBrief)}. Plan-only external audio job card; do not use copyrighted music.`,
      negativePrompt: 'copyrighted music, celebrity voice, real brand jingle imitation, unlicensed sample',
      expectedDuration: cue.duration,
      status: 'planned',
      safetyNotes: [
        'External audio generation is not called by this service.',
        'Use licensed, reviewed, or user-uploaded audio before final rendering.'
      ],
      ownership: 'external_audio_job_card_only'
    }));
}

function providerForCue(cue: AudioCue): AudioGenerationJobCard['providerHint'] {
  if (cue.cueType === 'music_bed') {
    return 'musicgen';
  }
  if (cue.cueType === 'logo_sting' || cue.cueType === 'cta_sound') {
    return 'manual_sfx';
  }
  return 'stable_audio';
}

function chooseTrackMode(assets: AvailableAudioAsset[]): AudioTrackPlan['mode'] {
  const hasBgm = assets.some((asset) => asset.kind === 'bgm');
  const hasSfx = assets.some((asset) => asset.kind === 'sfx' || asset.kind === 'foley' || asset.kind === 'logo_sting');
  if (hasBgm && hasSfx) {
    return 'bgm_with_sfx';
  }
  if (hasBgm) {
    return 'bgm_only';
  }
  if (hasSfx) {
    return 'sfx_only';
  }
  return 'plan_only';
}

function buildWarnings(presetWarnings: string[], assets: AvailableAudioAsset[], mode: AudioTrackPlan['mode']): string[] {
  const warnings = [
    ...presetWarnings,
    'Audio plan is not mixed into MP4; renderer/export integration is out of scope for this layer.'
  ];
  if (assets.length === 0) {
    warnings.unshift('No renderable audio assets were provided; generated cues are plan-only and hasRenderableAudio=false.');
  } else {
    warnings.push(`Available audio assets are referenced in ${mode} mode, but they are not mixed into MP4 by this service.`);
    if (assets.some((asset) => asset.licenseStatus !== 'cleared')) {
      warnings.push('Some audio assets need license or safety review before final use.');
    }
  }
  return warnings;
}

function getProductName(productBrief: GenerateAudioPlanInput['productBrief']): string {
  return typeof productBrief?.productName === 'string' && productBrief.productName.trim().length > 0
    ? productBrief.productName.trim()
    : 'target product';
}
