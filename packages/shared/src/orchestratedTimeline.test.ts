import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  OrchestratedTimelineSchema,
  type OrchestratedTimeline
} from './orchestratedTimeline';

const here = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(here, '../../../docs/examples/orchestrated-timeline.sample.json');

function loadSample(): unknown {
  return JSON.parse(readFileSync(samplePath, 'utf8'));
}

test('the sample orchestrated-timeline JSON validates against the schema', () => {
  const parsed = OrchestratedTimelineSchema.parse(loadSample());
  assert.equal(parsed.schemaVersion, 'orchestrated-v1');
  assert.equal(parsed.meta.planOnly, true);
  assert.equal(parsed.slots.length, 3);
  // transitions === slots.length - 1
  assert.equal(parsed.transitions.length, parsed.slots.length - 1);
});

test('matched / partial / gap fills discriminate correctly', () => {
  const tl = OrchestratedTimelineSchema.parse(loadSample());

  const matched = tl.slots[0].fill;
  assert.equal(matched.kind, 'matched');
  if (matched.kind === 'matched') {
    assert.equal(matched.status, 'matched');
    assert.equal(matched.options, undefined);
  }

  const partial = tl.slots[1].fill;
  assert.equal(partial.kind, 'matched');
  if (partial.kind === 'matched') {
    assert.equal(partial.status, 'partial');
    // partial carries asset-preserving options + a hyperframes recommendation; AIGC is reserved for true gaps.
    assert.deepEqual(partial.options?.map((option) => option.id).sort(), ['hyperframes', 'reshoot']);
    assert.equal(partial.recommendedOptionId, 'hyperframes');
  }

  const gap = tl.slots[2].fill;
  assert.equal(gap.kind, 'gap');
  if (gap.kind === 'gap') {
    assert.equal(gap.options.length, 3);
    assert.equal(gap.recommendedOptionId, 'aigc');
  }
});

test('partial slots do not offer AIGC, while true gaps can offer the AIGC job card', () => {
  const tl = OrchestratedTimelineSchema.parse(loadSample());
  for (const slot of tl.slots) {
    const options = slot.fill.kind === 'gap' ? slot.fill.options : slot.fill.options;
    if (!options) continue;
    const ids = options.map((o) => o.id).sort();
    if (slot.fill.kind === 'gap') {
      assert.deepEqual(ids, ['aigc', 'hyperframes', 'reshoot']);
    } else {
      assert.deepEqual(ids, ['hyperframes', 'reshoot']);
    }
  }
});

test('aigc options are job-card-only', () => {
  const tl = OrchestratedTimelineSchema.parse(loadSample());
  for (const slot of tl.slots) {
    const options = slot.fill.kind === 'gap' ? slot.fill.options : slot.fill.options;
    const aigc = options?.find((o) => o.id === 'aigc');
    if (aigc && aigc.id === 'aigc') {
      assert.equal(aigc.ownership, 'external_generation_job_card_only');
    }
  }
});

test('planOnly must be the literal true', () => {
  const sample = loadSample() as { meta: { planOnly: unknown } };
  sample.meta.planOnly = false;
  assert.throws(() => OrchestratedTimelineSchema.parse(sample));
});

test('transitions length must equal slots.length - 1', () => {
  const sample = loadSample() as OrchestratedTimeline;
  sample.transitions = sample.transitions.slice(0, 1);
  assert.throws(() => OrchestratedTimelineSchema.parse(sample));
});

test('a slot endMs must be greater than startMs', () => {
  const sample = loadSample() as OrchestratedTimeline;
  sample.slots[0].endMs = sample.slots[0].startMs;
  assert.throws(() => OrchestratedTimelineSchema.parse(sample));
});
