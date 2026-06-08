import { z } from 'zod';
import type { MotifType } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from '../llmProvider';
import { SOURCE_SPECIFIC_TERMS, containsSourceSpecificTerm } from './motionGrammarSanitizer';

/**
 * Target-category preset = the "what does this motion become in THIS product
 * category" half of motif transfer (decision D2). It only needs the target
 * category (+ optionally the real available assets to ground it), so it is
 * generated once at asset-parse time and threaded into the runtime mapper.
 *
 * Primary path is LLM-generated + asset-grounded; a deterministic multi-category
 * preset is the fallback (no key / LLM failure / leakage). With a key both paths
 * produce equivalent presets; without one the deterministic preset keeps the
 * pipeline working and reproducible.
 */
export interface CategoryPreset {
  category: string;
  objects: string[];
  actions: string[];
  sensoryKeywords: string[];
  bannedSourceTerms: string[];
  /** Per-motif preferred equivalents; falls back to defaultEquivalents. */
  motifEquivalents: Partial<Record<MotifType, string[]>>;
  defaultEquivalents: string[];
  requiredAssets: string[];
  fallbackAssets: string[];
  source: 'deterministic_preset' | 'llm_generated';
}

interface CategoryPresetSeed {
  objects: string[];
  actions: string[];
  sensoryKeywords: string[];
  motifEquivalents: Partial<Record<MotifType, string[]>>;
  defaultEquivalents: string[];
}

// Deterministic multi-category seeds (the no-key fallback). Add a category here
// to support it offline; the LLM path can enrich any category at runtime.
const CATEGORY_PRESET_SEEDS: Record<string, CategoryPresetSeed> = {
  beverage: {
    objects: ['beverage bottle', 'ice cubes', 'lemon slices', 'tea droplets', 'cold mist', 'clear cup'],
    actions: ['ice drop', 'cap opening', 'pour to cup', 'bottle rotation', 'cold mist burst'],
    sensoryKeywords: ['冰爽', '冷凝水', '解渴', '清爽', '茶香'],
    motifEquivalents: {
      kinetic_assembly_reveal: ['ice cubes', 'lemon slices', 'tea droplets', 'cold mist', 'cap opening', 'pour to cup', 'CTA lock-up'],
      surreal_assembly: ['ice cubes', 'lemon slices', 'tea droplets', 'converging cold tableau'],
      ingredient_transformation: ['ice cubes', 'lemon slices', 'tea droplets', 'cold mist', 'pour stream'],
      kinetic_product_reveal: ['bottle rotation', 'condensation highlight', 'clean product hold'],
      lineup_lockup: ['bottle lineup', 'lateral sweep', 'CTA lock-up'],
      impact_activation: ['ice drop impact', 'cold mist activation'],
      dynamic_entry: ['bottle entry', 'ice drop-in', 'push-in'],
      benefit_card_motion: ['benefit card drop', 'CTA lock-up']
    },
    defaultEquivalents: ['cap opening', 'pour to cup', 'cold detail', 'CTA lock-up']
  },
  beauty: {
    objects: ['product bottle', 'cream texture', 'water droplets', 'soft fabric', 'petals'],
    actions: ['swatch', 'texture spread', 'pump press', 'rotation reveal'],
    sensoryKeywords: ['水润', '柔滑', '光泽', '清透'],
    motifEquivalents: {
      ingredient_transformation: ['cream texture', 'water droplets', 'glossy swatch'],
      kinetic_product_reveal: ['bottle rotation', 'glossy highlight', 'clean product hold'],
      dynamic_entry: ['product entry', 'petal drop-in', 'push-in']
    },
    defaultEquivalents: ['texture swatch', 'product rotation', 'clean CTA hold']
  },
  food: {
    objects: ['product pack', 'ingredients', 'steam', 'sauce drizzle', 'plate'],
    actions: ['ingredient drop', 'pour drizzle', 'bite reveal', 'rotation'],
    sensoryKeywords: ['酥脆', '浓郁', '热气', '诱人'],
    motifEquivalents: {
      ingredient_transformation: ['ingredients', 'sauce drizzle', 'steam'],
      dynamic_entry: ['ingredient drop-in', 'push-in']
    },
    defaultEquivalents: ['ingredient reveal', 'product rotation', 'clean CTA hold']
  },
  generic: {
    objects: ['product', 'category-native props', 'clean background'],
    actions: ['product entry', 'rotation reveal', 'clean hold'],
    sensoryKeywords: ['clean', 'fresh', 'premium'],
    motifEquivalents: {},
    defaultEquivalents: ['category-native action', 'product-safe reveal', 'clean CTA lock-up']
  }
};

export function normalizeCategory(value: string): string {
  const lower = value.trim().toLowerCase();
  if (['beverage', 'drink', 'ready_to_drink_beverage', 'iced_tea', 'tea', '饮料', '冰红茶'].includes(lower)) return 'beverage';
  if (['beauty', 'skincare', 'cosmetics', '美妆', '护肤'].includes(lower)) return 'beauty';
  if (['food', 'snack', 'snacks', '食品', '零食'].includes(lower)) return 'food';
  return CATEGORY_PRESET_SEEDS[lower] ? lower : 'generic';
}

export interface BuildPresetInput {
  category: string;
  availableAssets?: string[];
}

export function buildDeterministicPreset(input: BuildPresetInput): CategoryPreset {
  const category = normalizeCategory(input.category);
  const seed = CATEGORY_PRESET_SEEDS[category] ?? CATEGORY_PRESET_SEEDS.generic;
  const grounding = groundAssets(input.availableAssets);
  return {
    category,
    objects: seed.objects,
    actions: seed.actions,
    sensoryKeywords: seed.sensoryKeywords,
    bannedSourceTerms: SOURCE_SPECIFIC_TERMS,
    motifEquivalents: seed.motifEquivalents,
    defaultEquivalents: seed.defaultEquivalents,
    requiredAssets: grounding.required,
    fallbackAssets: grounding.fallback,
    source: 'deterministic_preset'
  };
}

// ---------------------------------------------------------------------------
// LLM path (decision D2 primary) + deterministic fallback.
// ---------------------------------------------------------------------------

type Client = ReturnType<typeof createOpenAICompatibleClient>;

export interface GenerateCategoryPresetOptions extends BuildPresetInput {
  clientFactory?: () => Client;
  model?: string;
}

const LlmPresetSchema = z.object({
  objects: z.array(z.string()).min(2),
  actions: z.array(z.string()).min(1),
  sensoryKeywords: z.array(z.string()),
  defaultEquivalents: z.array(z.string()).min(1),
  motifEquivalents: z.record(z.string(), z.array(z.string())).optional()
});

const PRESET_SYSTEM_PROMPT = [
  'You translate abstract viral motion grammar into a target product category.',
  'Output JSON only. Use only category-native objects/actions.',
  'NEVER include source-specific terms: keyboard, laptop, touchpad, rocket, hardware, MacBook, Apple, 键盘, 笔记本, 触控板, 火箭, 硬件功能.',
  'Do not invent price, promotion, medical benefit, or other brands.'
].join(' ');

export async function generateCategoryPresetLLM(opts: GenerateCategoryPresetOptions): Promise<CategoryPreset> {
  const category = normalizeCategory(opts.category);
  const client = (opts.clientFactory ?? createOpenAICompatibleClient)();
  const modelId = opts.model ?? process.env.LLM_MODEL;
  if (!modelId) {
    throw new Error('LLM_MODEL is required for generateCategoryPresetLLM.');
  }

  const assetsLine = (opts.availableAssets ?? []).length
    ? `Ground equivalents in these available assets where possible: ${(opts.availableAssets ?? []).join(', ')}.`
    : 'No real assets available yet; suggest category-native equivalents.';

  const response = await client.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: PRESET_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `Target product category: ${category}.`,
          assetsLine,
          'Return JSON with: objects[], actions[], sensoryKeywords[], defaultEquivalents[], motifEquivalents{}.'
        ].join(' ')
      }
    ],
    temperature: 0.4,
    response_format: { type: 'json_object' }
  });

  const raw = response.choices[0]?.message?.content ?? '';
  const parsed = LlmPresetSchema.parse(JSON.parse(raw));

  // Leakage gate: any source-specific term anywhere → reject (caller falls back).
  const surface = [
    ...parsed.objects,
    ...parsed.actions,
    ...parsed.sensoryKeywords,
    ...parsed.defaultEquivalents,
    ...Object.values(parsed.motifEquivalents ?? {}).flat()
  ].join(' ');
  if (containsSourceSpecificTerm(surface)) {
    throw new Error('LLM category preset leaked a source-specific term; rejecting.');
  }

  const grounding = groundAssets(opts.availableAssets);
  return {
    category,
    objects: parsed.objects,
    actions: parsed.actions,
    sensoryKeywords: parsed.sensoryKeywords,
    bannedSourceTerms: SOURCE_SPECIFIC_TERMS,
    motifEquivalents: (parsed.motifEquivalents ?? {}) as Partial<Record<MotifType, string[]>>,
    defaultEquivalents: parsed.defaultEquivalents,
    requiredAssets: grounding.required,
    fallbackAssets: grounding.fallback,
    source: 'llm_generated'
  };
}

export interface CategoryPresetResult {
  preset: CategoryPreset;
  source: 'llm_generated' | 'deterministic_preset';
  warning?: string;
}

/**
 * D2 entry point: LLM-generated + asset-grounded preset when a key is present;
 * deterministic multi-category preset otherwise (no key / failure / leakage).
 */
export async function generateCategoryPreset(opts: GenerateCategoryPresetOptions): Promise<CategoryPresetResult> {
  try {
    const preset = await generateCategoryPresetLLM(opts);
    return { preset, source: 'llm_generated' };
  } catch (err) {
    return {
      preset: buildDeterministicPreset(opts),
      source: 'deterministic_preset',
      warning: `Category preset fell back to deterministic seed: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}

function groundAssets(availableAssets?: string[]): { required: string[]; fallback: string[] } {
  const assets = availableAssets ?? [];
  return {
    required: assets.length ? assets.slice(0, 6) : ['product packshot', 'category-native action clip', 'clean CTA end frame'],
    fallback: ['product still image', 'text-safe CTA card']
  };
}
