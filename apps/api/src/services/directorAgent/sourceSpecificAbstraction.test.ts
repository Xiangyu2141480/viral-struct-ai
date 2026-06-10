import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ShotSlotNode, ViralMotifAnnotation } from '@viral-struct/shared';
import { buildSourceAbstraction, inferSourceSpecificTransferSubtype, sourceSpecificProfile } from './sourceSpecificAbstraction';
import { EARPHONE_VOCAB_FIXTURE } from './vocabularyFixture';

/* eslint-disable @typescript-eslint/no-explicit-any */

function makeSlot(subject: string, motion?: string, role: ShotSlotNode['role'] = 'product_closeup'): ShotSlotNode {
  return {
    id: 'slot_test',
    segmentId: 'seg_1',
    role,
    requiredAsset: {
      type: 'video',
      subject,
      motion: motion as any
    },
    fallbackStrategies: []
  };
}

function makeMotif(motifType: ViralMotifAnnotation['motifType'], targetCategory = 'earphone'): ViralMotifAnnotation {
  return {
    id: 'motif_test',
    motifType,
    motionTokens: [],
    sanitizedIntent: 'test intent',
    transferVariables: [],
    bannedSourceTerms: [],
    targetCategoryMapping: {
      targetCategory,
      mappingConfidence: 0.9,
      allowedTargetValues: [],
      targetValue: targetCategory,
      notes: undefined
    },
    evidence: [],
    confidence: 0.9
  };
}

// ---- subtype inference ----

test('inferSourceSpecificTransferSubtype: opening_transform for hero entry slot', () => {
  const slot = makeSlot('MacBook opening screen color transform reveal');
  const subtype = inferSourceSpecificTransferSubtype(slot);
  assert.equal(subtype, 'opening_transform');
});

test('inferSourceSpecificTransferSubtype: kinetic_assembly_reveal when motif says so', () => {
  const slot = makeSlot('product assembly parts');
  const motif = makeMotif('kinetic_assembly_reveal');
  const subtype = inferSourceSpecificTransferSubtype(slot, motif);
  assert.equal(subtype, 'kinetic_assembly_reveal');
});

test('inferSourceSpecificTransferSubtype: cta_lockup for cta_visual role', () => {
  const slot = makeSlot('brand logo lockup', undefined, 'cta_visual');
  const subtype = inferSourceSpecificTransferSubtype(slot);
  assert.equal(subtype, 'cta_lockup');
});

test('inferSourceSpecificTransferSubtype: interface_detail for port/interface slot', () => {
  const slot = makeSlot('side port camera lens module detail');
  const subtype = inferSourceSpecificTransferSubtype(slot);
  assert.equal(subtype, 'interface_detail');
});

test('inferSourceSpecificTransferSubtype: device_handoff for cross-device slot', () => {
  const slot = makeSlot('cross-device handoff airdrop iphone map seamless');
  const subtype = inferSourceSpecificTransferSubtype(slot);
  assert.equal(subtype, 'device_handoff');
});

test('inferSourceSpecificTransferSubtype: ui_sequence for multi-window slot', () => {
  const slot = makeSlot('multi-window ui application browser editing');
  const subtype = inferSourceSpecificTransferSubtype(slot);
  assert.equal(subtype, 'ui_sequence');
});

test('inferSourceSpecificTransferSubtype: assembly_detail for parts assembly slot', () => {
  const slot = makeSlot('assembly component grille chip parts converge');
  const subtype = inferSourceSpecificTransferSubtype(slot);
  assert.equal(subtype, 'assembly_detail');
});

test('inferSourceSpecificTransferSubtype: generic_source_specific as fallback', () => {
  const slot = makeSlot('some generic product shot');
  const subtype = inferSourceSpecificTransferSubtype(slot);
  assert.equal(subtype, 'generic_source_specific');
});

// ---- sourceSpecificProfile: structural fields only ----

test('sourceSpecificProfile returns sourcePattern and abstractGrammar (no beverage fields)', () => {
  const profile = sourceSpecificProfile('opening_transform');
  assert.ok(profile.sourcePattern.length > 0);
  assert.ok(profile.abstractGrammar.length > 0);
  // Only 2 structural keys — no targetEquivalentLabel / targetEquivalentActions / rationale
  assert.deepEqual(Object.keys(profile).sort(), ['abstractGrammar', 'sourcePattern']);
});

test('sourceSpecificProfile(kinetic_assembly_reveal) returns correct abstractGrammar', () => {
  const profile = sourceSpecificProfile('kinetic_assembly_reveal');
  assert.match(profile.abstractGrammar, /cascade/);
});

// ---- buildSourceAbstraction: returns undefined when not source-specific ----

test('buildSourceAbstraction returns undefined for a generic slot without source-specific terms', () => {
  const slot = makeSlot('产品特写镜头');
  const result = buildSourceAbstraction({ slot, vocab: EARPHONE_VOCAB_FIXTURE });
  assert.equal(result, undefined);
});

// ---- buildSourceAbstraction: reads label/actions from injected vocab ----

test('buildSourceAbstraction: source-specific slot reads label/actions from injected vocab (not beverage)', () => {
  const slot = makeSlot('MacBook opening screen color transform reveal');
  const motif = makeMotif('dynamic_entry');
  const abstraction = buildSourceAbstraction({ slot, motif, targetCategory: 'generic', vocab: EARPHONE_VOCAB_FIXTURE });
  assert.ok(abstraction, 'should produce an abstraction');
  assert.equal(abstraction!.sourceSpecific, true);
  assert.ok(abstraction!.subtype.length > 0);
  // label and actions come from the injected vocab
  assert.deepEqual(abstraction!.targetEquivalentActions, EARPHONE_VOCAB_FIXTURE.bySubtype[abstraction!.subtype]!.actions);
  assert.equal(abstraction!.targetEquivalentLabel, EARPHONE_VOCAB_FIXTURE.bySubtype[abstraction!.subtype]!.label);
  // no beverage terms in actions
  assert.doesNotMatch(abstraction!.targetEquivalentActions.join(' '), /冰块|柠檬|瓶身|红茶|倒茶/);
});

test('buildSourceAbstraction: kinetic_assembly_reveal motif reads vocab actions (not beverage)', () => {
  const slot = makeSlot('product assembly parts');
  const motif = makeMotif('kinetic_assembly_reveal');
  const abstraction = buildSourceAbstraction({ slot, motif, targetCategory: 'generic', vocab: EARPHONE_VOCAB_FIXTURE });
  assert.ok(abstraction);
  assert.equal(abstraction!.subtype, 'kinetic_assembly_reveal');
  assert.deepEqual(abstraction!.targetEquivalentActions, EARPHONE_VOCAB_FIXTURE.bySubtype['kinetic_assembly_reveal']!.actions);
  assert.doesNotMatch(abstraction!.targetEquivalentActions.join(' '), /冰块|柠檬|瓶身|红茶|倒茶/);
});

test('buildSourceAbstraction: rationale contains vocab product name and subtype', () => {
  const slot = makeSlot('side port camera lens module detail');
  const motif = makeMotif('dynamic_entry');
  const abstraction = buildSourceAbstraction({ slot, motif, vocab: EARPHONE_VOCAB_FIXTURE });
  assert.ok(abstraction);
  assert.match(abstraction!.rationale, /interface_detail/);
  assert.match(abstraction!.rationale, /无线蓝牙耳机/);
});

test('buildSourceAbstraction: structural fields come from PROFILES (not vocab)', () => {
  const slot = makeSlot('MacBook opening screen color transform reveal');
  const motif = makeMotif('dynamic_entry');
  const abstraction = buildSourceAbstraction({ slot, motif, vocab: EARPHONE_VOCAB_FIXTURE });
  assert.ok(abstraction);
  const profile = sourceSpecificProfile(abstraction!.subtype);
  assert.equal(abstraction!.sourcePattern, profile.sourcePattern);
  assert.equal(abstraction!.abstractGrammar, profile.abstractGrammar);
});

test('buildSourceAbstraction: targetCategory falls back to motif targetCategory when not provided', () => {
  const slot = makeSlot('side port camera lens module detail');
  const motif = makeMotif('dynamic_entry', 'earphone');
  const abstraction = buildSourceAbstraction({ slot, motif, vocab: EARPHONE_VOCAB_FIXTURE });
  assert.ok(abstraction);
  assert.match(abstraction!.rationale, /earphone/);
});
