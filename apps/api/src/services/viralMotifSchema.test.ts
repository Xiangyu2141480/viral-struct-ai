import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  MotifAwareAigcPromptBriefSchema,
  MotifAwareHyperframesBriefSchema,
  ViralMotifAnnotationSchema,
  ViralStructureGraphSchema
} from '@viral-struct/shared';

test('ViralStructureGraphSchema remains compatible when motif annotations are absent', () => {
  const graphPath = join(process.cwd(), '../../seed_assets/analysis/macbook_neo/structure_graph.json');
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'));

  const parsed = ViralStructureGraphSchema.parse(graph);

  assert.equal(parsed.shotSlots.length > 0, true);
});

test('ViralStructureGraphSchema accepts optional motif annotations on graph and shot slots', () => {
  const motif = ViralMotifAnnotationSchema.parse({
    id: 'motif_block_004_kinetic_assembly',
    slotId: 'slot_block_004_asset_001',
    motifType: 'surreal_assembly',
    motionTokens: ['dynamic_entry', 'impact_beat', 'assembly_reveal'],
    sanitizedIntent: 'Create a beverage-native reveal beat using cap, ice, pour, or card motion.',
    transferVariables: [
      {
        name: 'entry_object',
        sourceValue: 'source component',
        targetValue: 'ice cube or bottle cap',
        allowedTargetValues: ['ice cube', 'bottle cap', 'benefit card'],
        notes: 'Use category-native motion, not source object replication.'
      }
    ],
    bannedSourceTerms: ['Apple', 'MacBook', 'keyboard'],
    targetCategoryMapping: {
      targetCategory: 'ready_to_drink_beverage',
      preferredEquivalents: ['ice_cube_drop', 'open_cap', 'pour_to_cup'],
      rejectedEquivalents: ['keyboard_drop', 'device_component_assembly'],
      rationale: 'The transfer target is motion grammar, not source product imagery.'
    },
    evidence: ['fine scan marks this block as nonliteral assembly motion'],
    confidence: 0.82
  });

  const graph = {
    meta: {
      duration: 12,
      aspectRatio: '9:16',
      videoType: 'ecommerce',
      style: 'high_click'
    },
    structureSummary: 'Kinetic opening structure with a nonliteral assembly motif.',
    segments: [
      {
        id: 'segment_001',
        role: 'hook',
        start: 0,
        end: 3,
        duration: 3,
        purpose: 'open with kinetic impact',
        transferRule: 'preserve motion grammar',
        importance: 5
      }
    ],
    shotSlots: [
      {
        id: 'slot_block_004_asset_001',
        segmentId: 'segment_001',
        role: 'usage_demo',
        requiredAsset: {
          type: 'video',
          subject: 'beverage-native action',
          motion: 'fast_cut'
        },
        fallbackStrategies: ['hand_demo'],
        motifAnnotations: [motif]
      }
    ],
    rhythm: {
      avgShotDuration: 1.2,
      cutFrequency: 'high',
      pattern: 'kinetic reveal'
    },
    packaging: {
      captionDensity: 'medium',
      captionPosition: 'bottom_center',
      titleStyle: 'bold hook',
      cardTypes: ['benefit_card'],
      transitions: ['cut'],
      coverStyle: 'product lockup'
    },
    creativeIngredients: [],
    motifAnnotations: [motif],
    edges: []
  };

  const parsed = ViralStructureGraphSchema.parse(graph);

  assert.equal(parsed.motifAnnotations?.[0]?.motifType, 'surreal_assembly');
  assert.equal(parsed.shotSlots[0].motifAnnotations?.[0]?.motionTokens.includes('assembly_reveal'), true);
});

test('motif-aware handoff briefs reject repair-output fields and keep generation boundaries explicit', () => {
  const aigcBrief = MotifAwareAigcPromptBriefSchema.parse({
    id: 'motif_aigc_ice_entry',
    motifAnnotationId: 'motif_block_004_kinetic_assembly',
    targetCategoryMapping: {
      targetCategory: 'ready_to_drink_beverage',
      preferredEquivalents: ['ice_cube_drop'],
      rejectedEquivalents: ['keyboard_drop'],
      rationale: 'Use beverage-native action.'
    },
    prompt: '9:16 iced tea ice cube impact shot, prompt-ready only.',
    negativePrompt: 'no computer, no keyboard, no source product layout',
    sanitizedIntent: 'Generate a category-native motion reference.',
    bannedSourceTerms: ['Apple', 'MacBook', 'keyboard'],
    motionTokens: ['dynamic_entry', 'impact_beat'],
    safetyNotes: ['Do not claim rendered output.'],
    notRenderedOutput: true
  });

  assert.equal(aigcBrief.notRenderedOutput, true);
  assert.equal('visualMotifTransferScore' in aigcBrief, false);

  const invalidHyperframes = MotifAwareHyperframesBriefSchema.safeParse({
    id: 'motif_hyperframes_card',
    motifAnnotationId: 'motif_block_004_kinetic_assembly',
    targetCategoryMapping: {
      targetCategory: 'ready_to_drink_beverage',
      preferredEquivalents: ['hyperframes_benefit_card_drop'],
      rejectedEquivalents: ['device_component_assembly'],
      rationale: 'Use a card drop instead of source object assembly.'
    },
    cardType: 'benefit_card',
    cardMotion: 'card_drop',
    copyIntent: 'ice-cold benefit card',
    sanitizedIntent: 'Drop a benefit card in the assembly beat.',
    bannedSourceTerms: ['Apple', 'MacBook', 'keyboard'],
    motionTokens: ['card_drop'],
    safetyNotes: ['Prompt handoff only.'],
    notRenderedOutput: true,
    fallbackCards: [],
    suggestedRepair: 'text_card'
  });

  assert.equal(invalidHyperframes.success, false);
});
