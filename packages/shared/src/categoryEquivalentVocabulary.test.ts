import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CategoryEquivalentVocabularySchema, VOCAB_SUBTYPES, VOCAB_ROLES } from './categoryEquivalentVocabulary';

function fullVocab() {
  const sub = { label: 'L', actions: ['a', 'b'] };
  const role = { label: 'L', reshootShot: 's', mustCapture: ['m'], animationHints: ['h'], aigcScene: 'sc' };
  return {
    product: '无线蓝牙耳机',
    bySubtype: Object.fromEntries(VOCAB_SUBTYPES.map((k) => [k, sub])),
    byRole: Object.fromEntries(VOCAB_ROLES.map((k) => [k, role])),
    tokenActions: { component_cascade: '单元归位' },
    connective: { afterUseResult: '戴上后的安静感', productHero: '耳机 hero 定格' }
  };
}

test('CategoryEquivalentVocabularySchema accepts a complete vocabulary', () => {
  const parsed = CategoryEquivalentVocabularySchema.parse(fullVocab());
  assert.equal(parsed.product, '无线蓝牙耳机');
  assert.equal(parsed.bySubtype.opening_transform!.actions.length, 2);
});

test('a subtype equivalent with <2 actions is rejected (forces concrete vocabulary)', () => {
  const bad = fullVocab();
  bad.bySubtype.opening_transform = { label: 'L', actions: ['only-one'] };
  assert.throws(() => CategoryEquivalentVocabularySchema.parse(bad));
});
