import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeterministicPreset,
  generateCategoryPreset,
  normalizeCategory
} from './categoryPresetProvider';
import { mapTargetCategoryMotif } from './targetCategoryMotifMapper';
import { MACBOOK_SOURCE_BANNED_TERMS } from '../directorAgent/vocabularyFixture';

function fakeClient(content: string) {
  return {
    chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } }
  } as unknown as ReturnType<typeof import('../llmProvider').createOpenAICompatibleClient>;
}

test('buildDeterministicPreset maps a beverage alias to the beverage seed', () => {
  const preset = buildDeterministicPreset({ category: '冰红茶' });
  assert.equal(preset.category, 'beverage');
  assert.equal(preset.source, 'deterministic_preset');
  assert.equal(preset.objects.includes('ice cubes'), true);
  assert.equal(preset.motifEquivalents.kinetic_assembly_reveal?.includes('pour to cup'), true);
});

test('unknown category falls back to the generic seed', () => {
  assert.equal(normalizeCategory('spaceship'), 'generic');
  const preset = buildDeterministicPreset({ category: 'spaceship' });
  assert.equal(preset.category, 'generic');
  assert.ok(preset.defaultEquivalents.length > 0);
});

test('preset is grounded in the real available assets', () => {
  const preset = buildDeterministicPreset({ category: 'beverage', availableAssets: ['plain_005_pour_to_cup.mp4', 'plain_003_open_cap.mp4'] });
  assert.equal(preset.requiredAssets.includes('plain_005_pour_to_cup.mp4'), true);
  assert.equal(preset.requiredAssets.includes('plain_003_open_cap.mp4'), true);
});

test('generateCategoryPreset uses the LLM result when the client succeeds', async () => {
  const content = JSON.stringify({
    objects: ['ice cubes', 'lemon slices'],
    actions: ['pour to cup'],
    sensoryKeywords: ['冰爽'],
    defaultEquivalents: ['pour to cup'],
    motifEquivalents: { kinetic_assembly_reveal: ['ice cube rain', 'pour reveal'] }
  });
  const result = await generateCategoryPreset({ category: 'beverage', model: 'test-model', clientFactory: () => fakeClient(content) });
  assert.equal(result.source, 'llm_generated');
  assert.equal(result.preset.objects.includes('ice cubes'), true);
  assert.equal(result.preset.motifEquivalents.kinetic_assembly_reveal?.includes('ice cube rain'), true);
});

test('generateCategoryPreset falls back when the LLM result leaks a source term', async () => {
  const content = JSON.stringify({
    objects: ['keyboard fragments', 'ice cubes'],
    actions: ['pour'],
    sensoryKeywords: [],
    defaultEquivalents: ['pour to cup']
  });
  const result = await generateCategoryPreset({ category: 'beverage', model: 'test-model', clientFactory: () => fakeClient(content), sourceBannedTerms: MACBOOK_SOURCE_BANNED_TERMS });
  assert.equal(result.source, 'deterministic_preset');
  assert.match(result.warning ?? '', /leak/i);
  // and the deterministic fallback is clean
  assert.equal(result.preset.objects.includes('keyboard fragments'), false);
});

test('generateCategoryPreset falls back when the LLM client is unavailable (no key)', async () => {
  const result = await generateCategoryPreset({
    category: 'beverage',
    model: 'test-model',
    clientFactory: () => { throw new Error('LLM_API_KEY and LLM_BASE_URL are required.'); }
  });
  assert.equal(result.source, 'deterministic_preset');
  assert.equal(result.preset.objects.includes('ice cubes'), true);
});

test('mapTargetCategoryMotif uses an injected preset when provided', () => {
  const preset = buildDeterministicPreset({ category: 'beverage' });
  const mapping = mapTargetCategoryMotif({ motifType: 'lineup_lockup', targetCategory: 'beverage', preset });
  assert.deepEqual(mapping.preferredEquivalents, preset.motifEquivalents.lineup_lockup);
  assert.equal(mapping.rationale.includes('deterministic_preset'), true);
});

test('mapTargetCategoryMotif without a preset keeps the built-in deterministic behaviour', () => {
  const mapping = mapTargetCategoryMotif({ motifType: 'kinetic_assembly_reveal', targetCategory: 'beverage' });
  assert.equal(mapping.preferredEquivalents.includes('ice cubes'), true);
  assert.equal(mapping.preferredEquivalents.includes('pour to cup'), true);
});
