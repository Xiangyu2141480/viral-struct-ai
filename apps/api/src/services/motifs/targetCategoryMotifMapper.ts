import type { MotifType, TargetCategoryMotifMapping } from '@viral-struct/shared';

export interface TargetCategoryMotifMapperInput {
  motifType: MotifType;
  targetCategory: string;
}

const BEVERAGE_EQUIVALENTS = [
  'ice cubes',
  'lemon slices',
  'tea droplets',
  'cold mist',
  'cap opening',
  'pour to cup',
  'CTA lock-up'
];

const SOURCE_SPECIFIC_REJECTIONS = [
  'keyboard fragments',
  'laptop assembly',
  'touchpad interaction',
  'rocket explosion',
  'hardware feature demo',
  'Apple visual identity',
  'MacBook product behavior'
];

export function mapTargetCategoryMotif(input: TargetCategoryMotifMapperInput): TargetCategoryMotifMapping {
  const targetCategory = normalizeTargetCategory(input.targetCategory);

  if (targetCategory === 'beverage' && input.motifType === 'kinetic_assembly_reveal') {
    return {
      targetCategory: 'beverage',
      preferredEquivalents: BEVERAGE_EQUIVALENTS,
      rejectedEquivalents: SOURCE_SPECIFIC_REJECTIONS,
      rationale: 'Map the kinetic assembly reveal into beverage-native coldness, opening, pour, and final CTA lock-up cues.'
    };
  }

  if (targetCategory === 'beverage') {
    return {
      targetCategory: 'beverage',
      preferredEquivalents: ['product closeup', 'cap opening', 'pour to cup', 'CTA lock-up'],
      rejectedEquivalents: SOURCE_SPECIFIC_REJECTIONS,
      rationale: 'Use beverage-native product and usage cues while avoiding source product semantics.'
    };
  }

  return {
    targetCategory,
    preferredEquivalents: ['category-native action', 'product-safe reveal', 'clean CTA lock-up'],
    rejectedEquivalents: SOURCE_SPECIFIC_REJECTIONS,
    rationale: 'Transfer abstract motion grammar only; keep final mapping category-native.'
  };
}

function normalizeTargetCategory(value: string): string {
  const lower = value.trim().toLowerCase();

  if (['beverage', 'drink', 'ready_to_drink_beverage', 'iced_tea', 'tea', '饮料', '冰红茶'].includes(lower)) {
    return 'beverage';
  }

  return lower || 'unknown';
}
