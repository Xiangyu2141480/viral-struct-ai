import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Boundary, ContentBrief, MaterialGap } from '@viral-struct/shared';
import { planGapRepairs, planGapRepairsLLM, planGapRepairsWithFallback } from './gapRepairPlanner';

const gap: MaterialGap = {
  slotId: 'slot_x',
  role: 'opening_attention',
  type: 'missing_opening_visual',
  severity: 'high',
  reason: '没有找到能支撑该结构槽位的素材。',
  impact: 'segment seg_a affected',
  affectedSegmentId: 'seg_a',
  missingIngredients: []
};

test('planGapRepairs without boundaries produces unannotated explanation', () => {
  const [repair] = planGapRepairs([gap], [], { productName: 'X', targetAudience: 'Y', scenario: 'Z', sellingPoints: ['a'], cta: 'go' });
  assert.equal(repair.strategy, 'text_card');
  assert.ok(!repair.explanation.startsWith('[boundary:'));
});

test('planGapRepairs prepends boundary note when slot segment touches strong boundary', () => {
  const boundaries: Boundary[] = [
    { id: 'b1', from: 'seg_a', to: 'seg_b', transitionType: 'morph', intensity: 'strong' }
  ];
  const [repair] = planGapRepairs(
    [gap],
    [],
    { productName: 'X', targetAudience: 'Y', scenario: 'Z', sellingPoints: ['a'], cta: 'go' },
    boundaries
  );
  assert.equal(repair.strategy, 'text_card');
  assert.ok(
    repair.explanation.startsWith('[boundary:morph/strong]'),
    `expected boundary prefix, got: ${repair.explanation}`
  );
});

test('planGapRepairs does not annotate for weak boundaries', () => {
  const boundaries: Boundary[] = [
    { id: 'b1', from: 'seg_a', to: 'seg_b', transitionType: 'cut', intensity: 'weak' }
  ];
  const [repair] = planGapRepairs(
    [gap],
    [],
    { productName: 'X', targetAudience: 'Y', scenario: 'Z', sellingPoints: ['a'], cta: 'go' },
    boundaries
  );
  assert.ok(!repair.explanation.startsWith('[boundary:'));
});

test('planGapRepairs reads motif context as evidence without changing final strategy', () => {
  const motifGap = {
    ...gap,
    slotId: 'slot_block_004_asset_001',
    role: 'usage_demo',
    type: 'missing_usage_demo',
    motifContext: {
      motifType: 'kinetic_assembly_reveal',
      motionTokens: ['component_cascade', 'chaos_to_order', 'assembly_completion', 'interaction_activation'],
      missingMotionTokens: ['chaos_to_order', 'assembly_completion'],
      sanitizedIntent: 'dynamic assembly, interaction activation, spectacle burst, CTA reveal',
      targetMotifHints: ['ice cubes', 'cold mist', 'CTA lock-up'],
      confidence: 0.82,
      evidence: ['Rule confidence 0.82 from motion token(s).']
    }
  } as MaterialGap;

  const [repair] = planGapRepairs([motifGap], [], brief);

  assert.equal(repair.strategy, 'crop_zoom');
  assert.match(repair.explanation, /\[motif:kinetic_assembly_reveal\]/);
  assert.match(repair.explanation, /chaos_to_order/);
  assert.match(repair.explanation, /ice cubes/);
});

// ---------------------------------------------------------------------------
// LLM gap-spec tests
// ---------------------------------------------------------------------------

interface FakeClient {
  chat: { completions: { create: (req: unknown) => Promise<{ choices: Array<{ message: { content: string } }> }> } };
}

function makeFakeClient(json: string): FakeClient {
  return {
    chat: {
      completions: {
        create: async () => ({ choices: [{ message: { content: json } }] })
      }
    }
  };
}

const brief: ContentBrief = {
  productName: '冰红茶',
  targetAudience: '夏季通勤',
  scenario: '午后高温',
  sellingPoints: ['冰爽', '柠檬茶香'],
  cta: '来一瓶'
};

test('planGapRepairsLLM enriches repairs with three-tier gapSpec', async () => {
  const llmResponse = JSON.stringify({
    slot_x: {
      ideal: '一段 3-4 秒手持横屏视频：手部入画拧瓶盖 → 倒入透明玻璃杯 → 杯内液体特写带冰块滚动。手机 1080p 即可。',
      minimalAcceptable: '2-3 张连拍静图：拧瓶盖瞬间 + 倒水入画 + 杯内液面。',
      alternativeIfNoShoot: '用 asset_1 (splash 图) + 加倒水音效 + 字幕「瞬间冰爽」，ken_burns 推近到瓶口。'
    }
  });
  const repairs = await planGapRepairsLLM({
    gaps: [gap],
    assets: [],
    newContent: brief,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    clientFactory: () => makeFakeClient(llmResponse) as any,
    model: 'fake'
  });
  assert.equal(repairs.length, 1);
  assert.ok(repairs[0].gapSpec?.ideal?.includes('3-4 秒'));
  assert.ok(repairs[0].gapSpec?.alternativeIfNoShoot?.includes('ken_burns'));
});

test('planGapRepairsLLM rejects when LLM omits a slot', async () => {
  const incomplete = JSON.stringify({});
  await assert.rejects(
    planGapRepairsLLM({
      gaps: [gap],
      assets: [],
      newContent: brief,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: () => makeFakeClient(incomplete) as any,
      model: 'fake'
    }),
    /missing slot/
  );
});

test('planGapRepairsLLM rejects when an output field is empty', async () => {
  const empty = JSON.stringify({
    slot_x: { ideal: '', minimalAcceptable: 'x', alternativeIfNoShoot: 'y' }
  });
  await assert.rejects(
    planGapRepairsLLM({
      gaps: [gap],
      assets: [],
      newContent: brief,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: () => makeFakeClient(empty) as any,
      model: 'fake'
    })
  );
});

test('planGapRepairsWithFallback falls back to rule-based when LLM throws', async () => {
  const result = await planGapRepairsWithFallback({
    gaps: [gap],
    assets: [],
    newContent: brief,
    clientFactory: () => { throw new Error('boom'); }
  });
  assert.equal(result.gapSpecSource, 'rule_based');
  assert.equal(result.repairs.length, 1);
  assert.equal(result.repairs[0].gapSpec, undefined);
  assert.ok(result.warning?.includes('boom'));
});

test('planGapRepairsLLM returns empty array for zero gaps without calling LLM', async () => {
  let called = 0;
  const repairs = await planGapRepairsLLM({
    gaps: [],
    assets: [],
    newContent: brief,
    clientFactory: () => { called += 1; throw new Error('should not be invoked'); }
  });
  assert.equal(repairs.length, 0);
  assert.equal(called, 0);
});
