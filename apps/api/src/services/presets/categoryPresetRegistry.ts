import { beveragePreset } from './beveragePreset';
import { genericPreset, type CategoryFallbackPolicy, type CategoryPreset, type CategoryPresetTarget } from './genericPreset';

const PRESETS: CategoryPreset[] = [genericPreset, beveragePreset];

const SUPPORTED_TARGET_CATEGORIES = new Set([
  'generic',
  'beverage',
  'beauty',
  'food',
  'electronics',
  'fashion',
  'home_goods'
]);

export interface CategoryPresetResolution {
  requestedCategory: string;
  preset: CategoryPreset;
  fallbackUsed: boolean;
  fallbackPolicy: CategoryFallbackPolicy;
  warnings: string[];
}

export function listCategoryPresets(): CategoryPreset[] {
  return PRESETS.map(clonePreset);
}

export function getCategoryPreset(targetCategory: CategoryPresetTarget): CategoryPreset | undefined {
  const normalized = normalizeCategory(targetCategory);
  const preset = PRESETS.find((candidate) => candidate.targetCategory === normalized);
  return preset ? clonePreset(preset) : undefined;
}

export function resolveCategoryPreset(targetCategory: CategoryPresetTarget | undefined): CategoryPresetResolution {
  const requestedCategory = normalizeCategory(targetCategory);
  const exact = getCategoryPreset(requestedCategory);
  if (exact) {
    return {
      requestedCategory,
      preset: exact,
      fallbackUsed: false,
      fallbackPolicy: exact.fallbackPolicy,
      warnings: []
    };
  }

  const generic = getCategoryPreset('generic') ?? genericPreset;
  const isKnownFutureCategory = SUPPORTED_TARGET_CATEGORIES.has(requestedCategory);
  return {
    requestedCategory,
    preset: clonePreset(generic),
    fallbackUsed: true,
    fallbackPolicy: {
      ...generic.fallbackPolicy,
      unsupportedCategories: isKnownFutureCategory ? [requestedCategory] : [...generic.fallbackPolicy.unsupportedCategories, requestedCategory]
    },
    warnings: [
      `No exact category preset for "${requestedCategory}"; using generic preset.`,
      isKnownFutureCategory
        ? `"${requestedCategory}" is reserved for future category-specific mappings.`
        : `"${requestedCategory}" is not in the known target category list.`
    ]
  };
}

function normalizeCategory(value: CategoryPresetTarget | undefined): string {
  const normalized = String(value ?? 'generic').trim().toLowerCase();
  return normalized.length > 0 ? normalized : 'generic';
}

function clonePreset(preset: CategoryPreset): CategoryPreset {
  return JSON.parse(JSON.stringify(preset)) as CategoryPreset;
}

export type { CategoryFallbackPolicy, CategoryObjectMapping, CategoryPreset, CategorySonicPreset } from './genericPreset';
