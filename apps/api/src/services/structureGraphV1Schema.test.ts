import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ViralStructureGraphSchema } from '@viral-struct/shared';
import { getAnalysisDir } from './videoPaths';

test('ViralStructureGraphSchema accepts v0 artifact without intent/sourceInstance/acceptanceCriteria', async () => {
  const artifactPath = path.join(getAnalysisDir(), 'macbook_neo', 'structure_graph.json');
  const raw = await readFile(artifactPath, 'utf-8');
  const parsed = ViralStructureGraphSchema.parse(JSON.parse(raw));
  assert.equal(typeof parsed.structureSummary, 'string');
  assert.ok(Array.isArray(parsed.shotSlots) && parsed.shotSlots.length > 0);
  for (const slot of parsed.shotSlots) {
    assert.equal(slot.intent, undefined);
    assert.equal(slot.sourceInstance, undefined);
    assert.equal(slot.acceptanceCriteria, undefined);
  }
});

test('ViralStructureGraphSchema accepts v1 slot with intent + sourceInstance + acceptanceCriteria', () => {
  const minimal = {
    schemaVersion: 'v1' as const,
    meta: { duration: 60, aspectRatio: '9:16' as const, videoType: 'ecommerce' as const, style: 'high_click' as const },
    structureSummary: 'test',
    segments: [{ id: 'seg_1', role: 'hook' as const, start: 0, end: 5, duration: 5, purpose: 'p', transferRule: 'r', importance: 5 as const }],
    shotSlots: [{
      id: 'slot_1',
      segmentId: 'seg_1',
      role: 'opening_attention' as const,
      requiredAsset: { type: 'image' as const, subject: 'product' },
      fallbackStrategies: ['text_card' as const],
      intent: {
        purpose: '1.5s 内制造高强度视觉冲击',
        energyLevel: 'high' as const,
        motionPattern: 'centripetal_impact_or_dynamic_entry',
        compositionPrincipal: 'single_subject_center_with_dynamic_negative_space',
        durationMs: [800, 2000] as [number, number],
        soundDesignHint: 'transient_attack_aligned_with_visual_peak'
      },
      sourceInstance: {
        productInSource: 'MacBook 银色机身',
        specificAction: '双手左右托举旋转',
        colorSignature: 'silver_yellow_gradient'
      },
      acceptanceCriteria: {
        anyOf: [
          { motionType: 'fluid_dynamics', examples: ['液体飞溅', '颗粒爆炸'] },
          { motionType: 'object_kinetic', examples: ['物体高速入画'] }
        ],
        rejectIf: ['低动感纯静物图']
      }
    }],
    rhythm: { avgShotDuration: 3, cutFrequency: 'high' as const, pattern: 'fast' },
    packaging: { captionDensity: 'high' as const, captionPosition: 'bottom_center' as const, titleStyle: 'bold', cardTypes: [], transitions: [], coverStyle: 'product' },
    creativeIngredients: [],
    edges: []
  };
  const parsed = ViralStructureGraphSchema.parse(minimal);
  assert.equal(parsed.schemaVersion, 'v1');
  const slot = parsed.shotSlots[0];
  assert.equal(slot.intent?.energyLevel, 'high');
  assert.deepEqual(slot.intent?.durationMs, [800, 2000]);
  assert.equal(slot.sourceInstance?.productInSource, 'MacBook 银色机身');
  assert.equal(slot.acceptanceCriteria?.anyOf.length, 2);
  assert.equal(slot.acceptanceCriteria?.anyOf[0].motionType, 'fluid_dynamics');
});

test('ViralStructureGraphSchema rejects intent missing required fields', () => {
  const broken = {
    schemaVersion: 'v1',
    meta: { duration: 60, aspectRatio: '9:16', videoType: 'ecommerce', style: 'high_click' },
    structureSummary: 'test',
    segments: [],
    shotSlots: [{
      id: 'slot_1',
      segmentId: 'seg_1',
      role: 'opening_attention',
      requiredAsset: { type: 'image', subject: 'product' },
      fallbackStrategies: ['text_card'],
      intent: { purpose: 'x', energyLevel: 'high' }
    }],
    rhythm: { avgShotDuration: 3, cutFrequency: 'high', pattern: 'fast' },
    packaging: { captionDensity: 'high', captionPosition: 'bottom_center', titleStyle: 'bold', cardTypes: [], transitions: [], coverStyle: 'product' },
    creativeIngredients: [],
    edges: []
  };
  assert.throws(() => ViralStructureGraphSchema.parse(broken));
});
