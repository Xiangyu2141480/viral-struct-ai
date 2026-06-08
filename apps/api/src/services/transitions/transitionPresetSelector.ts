import { resolveCategoryPreset, type CategoryPresetResolution } from '../presets/categoryPresetRegistry';

export interface TransitionPresetSelectionInput {
  targetCategory?: string;
}

export function selectTransitionPreset(input: TransitionPresetSelectionInput): CategoryPresetResolution {
  return resolveCategoryPreset(input.targetCategory);
}
