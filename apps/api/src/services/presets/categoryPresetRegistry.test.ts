import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  getCategoryPreset,
  listCategoryPresets,
  resolveCategoryPreset
} from './categoryPresetRegistry';

test('category preset registry exposes generic and beverage presets', () => {
  const presets = listCategoryPresets();

  assert.ok(presets.some((preset) => preset.presetId === 'generic_default'));
  assert.ok(presets.some((preset) => preset.presetId === 'beverage_refresh_demo'));
});

test('beverage preset keeps Kangshifu iced tea as a demo mapping, not a core category', () => {
  const beverage = getCategoryPreset('beverage');

  assert.equal(beverage?.targetCategory, 'beverage');
  assert.equal(beverage?.demoProduct, 'kangshifu_iced_tea');
  assert.equal(beverage?.presetId, 'beverage_refresh_demo');
  assert.equal(beverage?.objectMappings.object_rain?.targetObjects.includes('ice cubes'), true);
  assert.equal(beverage?.objectMappings.object_rain?.targetObjects.includes('lemon slices'), true);
  assert.equal(beverage?.objectMappings.activation?.targetObjects.includes('cap pop'), true);
  assert.equal(beverage?.sonicPreset.motifMappings.object_rain?.includes('rapid light hits'), true);
  assert.equal(beverage?.sonicPreset.motifMappings.cta_reveal?.includes('two-note logo sting'), true);
});

test('unknown and future categories fall back to generic without changing the requested category', () => {
  const beauty = resolveCategoryPreset('beauty');
  const unknown = resolveCategoryPreset('sports_equipment');

  assert.equal(beauty.requestedCategory, 'beauty');
  assert.equal(beauty.preset.presetId, 'generic_default');
  assert.equal(beauty.fallbackUsed, true);
  assert.equal(beauty.fallbackPolicy.mode, 'generic');

  assert.equal(unknown.requestedCategory, 'sports_equipment');
  assert.equal(unknown.preset.targetCategory, 'generic');
  assert.ok(unknown.warnings.some((warning) => warning.includes('generic')));
});

test('core registry does not hardcode the ice tea demo product', () => {
  const registryPath = path.resolve(process.cwd(), 'src/services/presets/categoryPresetRegistry.ts');
  const source = readFileSync(registryPath, 'utf8').toLowerCase();

  assert.equal(source.includes('kangshifu'), false);
  assert.equal(source.includes('冰红茶'), false);
});

test('beverage preset sample JSON mirrors registry fields', () => {
  const samplePath = path.resolve(process.cwd(), '../../docs/examples/category-preset-beverage.sample.json');
  const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
  const beverage = getCategoryPreset('beverage');

  assert.equal(sample.targetCategory, beverage?.targetCategory);
  assert.equal(sample.demoProduct, beverage?.demoProduct);
  assert.equal(sample.presetId, beverage?.presetId);
  assert.deepEqual(sample.objectMappings.object_rain.targetObjects, beverage?.objectMappings.object_rain?.targetObjects);
});
