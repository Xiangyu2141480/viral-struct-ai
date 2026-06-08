import assert from 'node:assert/strict';
import test from 'node:test';
import type { ShotSlotNode } from '@viral-struct/shared';
import { mineRuleGaps, parseRuleProposals, buildRuleProposalPrompt } from './motifRuleMiner';

function slot(partial: Partial<ShotSlotNode> & { id: string }): ShotSlotNode {
  return {
    segmentId: 'seg_x',
    role: 'usage_demo',
    requiredAsset: { type: 'video', subject: 'product', camera: 'medium', motion: 'static' },
    fallbackStrategies: [],
    importance: 3,
    ...partial
  } as ShotSlotNode;
}

test('mineRuleGaps flags a motion slot the rules do not tokenize as uncovered', () => {
  const slots = [
    slot({
      id: 'slot_uncovered',
      requiredAsset: { type: 'video', subject: '液体', camera: 'medium', motion: 'hand_operation' },
      intent: {
        purpose: '液体在杯中打着旋涡缓缓汇聚',
        energyLevel: 'medium',
        motionPattern: 'liquid swirling vortex',
        compositionPrincipal: 'centered',
        durationMs: [1000, 2000]
      }
    })
  ];
  const gaps = mineRuleGaps(slots);
  const record = gaps.find((g) => g.slotId === 'slot_uncovered');
  assert.ok(record, 'expected the swirl slot to be harvested');
  assert.equal(record?.gapKind, 'uncovered');
  assert.equal(record?.firedTokens.length, 0);
});

test('mineRuleGaps does not flag plain static slots with no motion description', () => {
  const slots = [
    slot({
      id: 'slot_static',
      requiredAsset: { type: 'image', subject: 'logo', camera: 'closeup', motion: 'static' }
    })
  ];
  const gaps = mineRuleGaps(slots);
  assert.equal(gaps.some((g) => g.slotId === 'slot_static'), false);
});

test('parseRuleProposals accepts clean abstract proposals', () => {
  const raw = JSON.stringify({
    proposals: [
      { token: 'liquid_swirl', canonicalPhrase: 'liquid swirl', patterns: ['swirl', '旋涡', '打旋'], mapsToMotif: 'ingredient_transformation' }
    ]
  });
  const result = parseRuleProposals(raw);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0].token, 'liquid_swirl');
  assert.equal(result.rejected.length, 0);
});

test('parseRuleProposals rejects a proposal that leaks a source-specific term', () => {
  const raw = JSON.stringify({
    proposals: [
      { token: 'keyboard_assembly', canonicalPhrase: 'keyboard assembly', patterns: ['keyboard', '键盘'] }
    ]
  });
  const result = parseRuleProposals(raw);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /leakage/i);
});

test('buildRuleProposalPrompt lists fired tokens and source text per gap', () => {
  const prompt = buildRuleProposalPrompt([
    { slotId: 's1', sourceText: '液体打着旋涡', firedTokens: [], gapKind: 'uncovered', note: 'n' }
  ]);
  assert.match(prompt, /uncovered/);
  assert.match(prompt, /液体打着旋涡/);
  assert.match(prompt, /fired=\[none\]/);
});
