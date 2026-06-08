import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { TransitionMotionGrammarHandoffSchema } from '@viral-struct/shared';

test('transition handoff sample validates and stays evidence-only', () => {
  const samplePath = path.resolve(process.cwd(), '../../docs/examples/transition-handoff-kinetic-assembly.sample.json');
  const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
  const parsed = TransitionMotionGrammarHandoffSchema.parse(sample);
  const serialized = JSON.stringify(parsed).toLowerCase();

  assert.equal(parsed.protocolVersion, 'transition-handoff-v1');
  assert.equal(parsed.patternId, 'kinetic_assembly');
  assert.ok(parsed.transitionNeeds.some((need) => need.grammarId === 'dynamic_entry'));
  assert.ok(parsed.transitionNeeds.some((need) => need.targetEquivalent === 'ice_cube_drop'));
  assert.ok(parsed.transitionNeeds.some((need) => need.targetEquivalent === 'open_cap'));
  assert.ok(parsed.transitionNeeds.some((need) => need.targetEquivalent === 'pour_to_cup'));
  assert.ok(parsed.transitionNeeds.some((need) => need.targetEquivalent === 'clean_cta_end_frame'));
  assert.ok(parsed.downstreamHandoff.some((brief) => brief.owner === 'hyperframes'));
  assert.ok(parsed.downstreamHandoff.some((brief) => brief.owner === 'aigc'));
  assert.equal(serialized.includes('visual motif transfer score'), false);
  assert.equal(serialized.includes('copy apple'), false);
  assert.equal(serialized.includes('copy keyboard'), false);
});
