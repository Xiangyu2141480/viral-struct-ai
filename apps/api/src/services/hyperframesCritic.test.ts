import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCritique } from './hyperframesCritic';

test('parseCritique: valid JSON', () => {
  const r = parseCritique('{"score":0.9,"verdict":"ship","issues":[],"fixes":["punchier hook"]}');
  assert.equal(r.verdict, 'ship');
  assert.equal(r.score, 0.9);
  assert.deepEqual(r.fixes, ['punchier hook']);
});

test('parseCritique: strips ```json fences and surrounding prose', () => {
  const fenced = '```json\n{"score":0.4,"verdict":"revise","issues":["caption overflows"],"fixes":["shrink text"]}\n```';
  assert.equal(parseCritique(fenced).verdict, 'revise');
  const noisy = 'Sure, here is my review:\n{"score":0.8,"verdict":"ship","issues":[],"fixes":[]}\nHope it helps!';
  assert.equal(parseCritique(noisy).score, 0.8);
});

test('parseCritique: clamps score to [0,1]', () => {
  assert.equal(parseCritique('{"score":1.7,"verdict":"ship"}').score, 1);
  assert.equal(parseCritique('{"score":-0.5,"verdict":"revise"}').score, 0);
});

test('parseCritique: derives verdict from score when missing', () => {
  assert.equal(parseCritique('{"score":0.5,"issues":[],"fixes":[]}').verdict, 'revise');
  assert.equal(parseCritique('{"score":0.85,"issues":[],"fixes":[]}').verdict, 'ship');
});

test('parseCritique: unusable output falls back to "ship" (never blocks the render)', () => {
  const r = parseCritique('the model said something without json');
  assert.equal(r.verdict, 'ship');
  assert.equal(r.score, 1);
  assert.deepEqual(r.issues, []);
});

test('parseCritique: coerces non-string issues/fixes entries', () => {
  const r = parseCritique('{"score":0.3,"verdict":"revise","issues":[1,"x"],"fixes":["a"]}');
  assert.deepEqual(r.issues, ['1', 'x']);
});
