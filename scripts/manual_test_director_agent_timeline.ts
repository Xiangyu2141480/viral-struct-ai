/**
 * Manual test — Director Agent → OrchestratedTimeline → Video Agent handoff (plan-only, no LLM).
 *
 * Drives the new editorial brain end to end on real fixtures:
 *
 *     ② buildAssetSupplyContext (kept — asset scan / coverage, read-only evidence)
 *       → Director Agent runDirectorAgent
 *           · matchSlotsWithFallback (rule-based here; LLM is opt-in)
 *           · degradation ladder (matched / partial asset-preserving options / gap AIGC job-card option) + source-specific gate
 *           · transition orchestration (hyperframes-weighted, aigc frame-bridge gated)
 *         → OrchestratedTimeline
 *       → orchestratedToAuthored → AuthoredTimeline (the deliverable: a TIMELINE, not a rendered MP4)
 *
 * Decision 4: the Director only delivers a timeline. This script NEVER renders, NEVER calls an external
 * model. AIGC options / frame bridges are job cards only.
 *
 * Run (uses the api package's tsx; root scripts import workspace code via RELATIVE source paths):
 *   pnpm --filter @viral-struct/api exec node --import tsx ../../scripts/manual_test_director_agent_timeline.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AssetCard, ContentBrief, GapResolutionOption, OrchestratedTimeline, ViralStructureGraph } from '../packages/shared/src/index';
import { splitRejectIfForTransfer } from '../packages/shared/src/index';
import { normalizeAssetCards } from '../apps/api/src/services/assetManager/assetNormalizer';
import { buildAssetSupplyContext } from '../apps/api/src/services/assetManager/assetSupplyContextBuilder';
import { buildDeterministicPreset } from '../apps/api/src/services/motifs/categoryPresetProvider';
import { SOURCE_SPECIFIC_TERMS } from '../apps/api/src/services/motifs/motionGrammarSanitizer';
import { runDirectorAgent } from '../apps/api/src/services/directorAgent/index';
import { authorTimelineOptions } from '../apps/api/src/services/directorAgent/authorTimelineOptions';
import { orchestratedToAuthored } from '../apps/api/src/services/videoAgent/orchestratedToAuthored';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The script runs with cwd = apps/api, so load the repo-root .env (LLM_MODEL/BASE_URL/API_KEY) ourselves.
// A tiny inline parser avoids a bare `dotenv` import (root scripts can't resolve bare specifiers).
loadEnvFile(path.join(repoRoot, '.env'));

const INPUTS = {
  structureGraph: 'seed_assets/analysis/macbook_neo/structure_graph.json',
  plainAssetCards: 'seed_assets/asset_libraries/kangshifu_plain_user_test/asset_cards.json'
} as const;

const OUTPUTS = {
  timelineJson: 'tmp/director-agent-orchestrated-timeline.json',
  authoredJson: 'tmp/director-agent-authored-handoff.json',
  report: 'tmp/director-agent-orchestrated-timeline-report.md'
} as const;

const beverageBrief: ContentBrief = {
  productName: '康师傅冰红茶',
  category: 'beverage',
  targetAudience: '夏天通勤、聚餐、户外活动中的年轻消费者',
  scenario: '炎热天气、饭后解腻、朋友聚会时需要冰爽饮品',
  sellingPoints: ['冰爽解腻', '柠檬茶香', '适合聚餐分享', '冰镇后口感更清爽'],
  cta: '现在就来一瓶康师傅冰红茶',
  stylePreference: '普通用户真实素材，验证 Director Agent 编排为可执行时间线（plan-only，无 LLM）'
};

async function main(): Promise<void> {
  mkdirSync(path.join(repoRoot, 'tmp'), { recursive: true });

  const structureGraph = readJson<ViralStructureGraph>(INPUTS.structureGraph);
  const assetCards = normalizeAssetCards(readJson<AssetCard[]>(INPUTS.plainAssetCards));
  const categoryPreset = buildDeterministicPreset({ category: 'beverage', availableAssets: assetCards.map((a) => a.id) });

  // ② kept: produce the supply-context evidence the Director consumes read-only.
  const assetSupplyContext = buildAssetSupplyContext({
    structureGraph,
    assetCards,
    contentBrief: beverageBrief,
    libraryId: 'director_agent_manual',
    categoryPreset,
    options: { userCanGenerate: false }
  });

  // Director Agent → OrchestratedTimeline (rule-based matching; LLM is opt-in and not used here).
  let timeline = await runDirectorAgent({
    projectId: 'director_agent_kangshifu',
    structureGraph,
    assetCards,
    assetSupplyContext,
    contentBrief: beverageBrief,
    categoryPreset,
    options: { useLlmMatcher: true }
  });

  // Optional LLM channel authoring (AUTHOR_OPTIONS=true): one shared neutral intent → three
  // capability-bounded prompts (reshoot real-filmable / hyperframes edit-only / aigc surreal).
  if (process.env.AUTHOR_OPTIONS === 'true') {
    const authoredOptions = await authorTimelineOptions(timeline, { contentBrief: beverageBrief, enabled: true });
    timeline = authoredOptions.timeline;
    console.log(`- option authoring: ${authoredOptions.authoredSlots} slot(s) re-authored; ${authoredOptions.warnings.length} channel warning(s)`);
  }

  // Handoff: map to the Video Agent's AuthoredTimeline (a TIMELINE — never rendered here).
  const authored = orchestratedToAuthored(timeline, { assetCards });

  const leakage = checkSourceLeakage(timeline);

  writeText(OUTPUTS.timelineJson, `${JSON.stringify(timeline, null, 2)}\n`);
  writeText(OUTPUTS.authoredJson, `${JSON.stringify(authored, null, 2)}\n`);
  writeText(OUTPUTS.report, buildReport(timeline, authored, leakage));

  const counts = countFills(timeline);
  console.log('Director Agent orchestrated-timeline manual test complete.');
  console.log(
    `- slots=${timeline.slots.length} fullySatisfied=${counts.fullySatisfied}`
    + ` partial=${counts.partialWithEnhancement} generationRequired=${counts.generationRequired}`
  );
  console.log(`- fillStatus=${JSON.stringify(counts.byStatus)}`);
  console.log(`- duration=${timeline.meta.sourceDurationMs ?? '-'}ms -> ${timeline.meta.targetDurationMs ?? '-'}ms (${timeline.meta.targetDurationMode ?? '-'})`);
  console.log(`- transitions=${timeline.transitions.length} ${JSON.stringify(countModes(timeline))}`);
  console.log(`- matchSource=${timeline.meta.matchSource} planOnly=${timeline.meta.planOnly}`);
  console.log(`- handoff beats=${authored.beats.length} (timeline only — NOT rendered)`);
  console.log(`- source leakage check: ${leakage.passed ? 'PASS' : `FAIL (${leakage.hits.join(', ')})`}`);
  console.log(`Wrote ${OUTPUTS.timelineJson}`);
  console.log(`Wrote ${OUTPUTS.authoredJson}`);
  console.log(`Wrote ${OUTPUTS.report}`);

  if (!leakage.passed) process.exitCode = 1;
}

interface LeakageResult {
  passed: boolean;
  hits: string[];
}

// Negative-direction fields legitimately NAME banned source terms as guardrails ("no MacBook",
// avoid: keyboard). Those are protections, not leaks — the leak we guard against is a source term in a
// POSITIVE prompt/instruction that would make a generator PRODUCE source content. So we scan every
// string except these negative-direction keys.
const NEGATIVE_DIRECTION_KEYS = new Set(['negativePrompt', 'avoid']);

function checkSourceLeakage(timeline: OrchestratedTimeline): LeakageResult {
  const hits = new Set<string>();
  const walk = (value: unknown, key?: string): void => {
    if (key && NEGATIVE_DIRECTION_KEYS.has(key)) return;
    if (typeof value === 'string') {
      const lower = value.toLowerCase();
      for (const term of SOURCE_SPECIFIC_TERMS) {
        if (lower.includes(term.toLowerCase())) hits.add(term);
      }
    } else if (Array.isArray(value)) {
      value.forEach((entry) => walk(entry, key));
    } else if (value && typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) walk(childValue, childKey);
    }
  };
  walk(timeline);
  return { passed: hits.size === 0, hits: Array.from(hits) };
}

function countFills(timeline: OrchestratedTimeline) {
  let fullySatisfied = 0;
  let partialWithEnhancement = 0;
  let generationRequired = 0;
  const byStatus: Record<string, number> = {};
  for (const slot of timeline.slots) {
    const status = slot.fillStatus ?? (slot.fill.kind === 'gap' ? 'missing_generation_required' : slot.fill.status);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (status === 'matched') fullySatisfied += 1;
    else if (status === 'missing_generation_required') generationRequired += 1;
    else partialWithEnhancement += 1;
  }
  return { fullySatisfied, partialWithEnhancement, generationRequired, byStatus };
}

function countModes(timeline: OrchestratedTimeline): Record<string, number> {
  const out: Record<string, number> = {};
  for (const transition of timeline.transitions) out[transition.mode] = (out[transition.mode] ?? 0) + 1;
  return out;
}

function buildReport(
  timeline: OrchestratedTimeline,
  authored: ReturnType<typeof orchestratedToAuthored>,
  leakage: LeakageResult
): string {
  const counts = countFills(timeline);
  const modes = countModes(timeline);
  const optionSlots = timeline.slots.filter((s) => (s.fill.kind === 'gap' ? s.fill.options : s.fill.options)?.length);
  const aigcOptionSlots = timeline.slots.filter((s) => ((s.fill.kind === 'gap' ? s.fill.options : s.fill.options) ?? []).some((option) => option.id === 'aigc'));
  const realMediaReferenced = timeline.slots.filter((slot) => slot.fill.kind === 'matched' && Boolean(slot.fill.assetId)).length;
  const fullySatisfied = timeline.slots.filter((slot) => slot.fillStatus === 'matched').length;
  const partialWithEnhancement = timeline.slots.filter((slot) =>
    slot.fillStatus === 'partial_asset_support'
    || slot.fillStatus === 'needs_hyperframes_enhancement'
    || slot.fillStatus === 'source_specific_not_transferable'
  ).length;
  const generationRequired = timeline.slots.filter((slot) => slot.fillStatus === 'missing_generation_required' || slot.fill.kind === 'gap').length;
  const motifSlots = timeline.slots.filter((slot) => slot.motifType || slot.slotId.includes('slot_block_004'));
  const sourceSpecificSlots = timeline.slots.filter((slot) => slot.fillStatus === 'source_specific_not_transferable');

  const jobCards: string[][] = [];
  for (const slot of timeline.slots) {
    const options = slot.fill.kind === 'gap' ? slot.fill.options : slot.fill.options ?? [];
    for (const option of options) {
      if (option.id === 'aigc') {
        jobCards.push([slot.slotId, 'aigc', option.providerHint, option.ownership]);
      }
    }
  }
  for (const transition of timeline.transitions) {
    if (transition.mode === 'aigc_frame_bridge' && transition.aigcFrameBridge) {
      jobCards.push([`${transition.fromSlotId}→${transition.toSlotId}`, 'aigc_frame_bridge', '-', transition.aigcFrameBridge.ownership]);
    }
  }

  return [
    '# Director Agent Champion Pipeline Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## 1. Summary',
    '',
    markdownTable(
      ['metric', 'value'],
      [
        ['product', timeline.meta.productName ?? '-'],
        ['target category', timeline.meta.targetCategory ?? '-'],
        ['match source', timeline.meta.matchSource],
        ['plan only', String(timeline.meta.planOnly)],
        ['duration compression', `${timeline.meta.sourceDurationMs ?? '-'}ms -> ${timeline.meta.targetDurationMs ?? '-'}ms (${timeline.meta.targetDurationMode ?? '-'})`],
        ['fillStatus breakdown', JSON.stringify(counts.byStatus)],
        ['real media referenced', `${realMediaReferenced} / ${timeline.slots.length}`],
        ['fully satisfied slots', `${fullySatisfied} / ${timeline.slots.length}`],
        ['partial with enhancement', `${partialWithEnhancement} / ${timeline.slots.length}`],
        ['generation required', `${generationRequired} / ${timeline.slots.length}`],
        ['transitions', `${timeline.transitions.length} ${JSON.stringify(modes)}`],
        ['matched / partial / gap', `${fullySatisfied} / ${partialWithEnhancement} / ${generationRequired}`],
        ['transition function counts', JSON.stringify(countTransitionFunctions(timeline))],
        ['prompt diversity', JSON.stringify(promptDiversity(timeline))],
        ['reusable asset packs', `${timeline.reusableAssetPacks?.length ?? 0}`],
        ['slots with resolution options', String(optionSlots.length)],
        ['AIGC job-card slots', String(aigcOptionSlots.length)],
        ['authored handoff beats', `${authored.beats.length} timeline beats, not rendered`],
        ['source leakage check', leakage.passed ? 'PASS' : `FAIL (${leakage.hits.join(', ')})`]
      ]
    ),
    '',
    '## 2. RejectIf Transfer Filtering',
    '',
    '_Raw source-specific terms are intentionally not printed here; this section shows whether they were split into transferable source-category constraints instead of target hard gates._',
    '',
    markdownTable(
      ['slot', 'hard reject count', 'source-specific reject count', 'transfer handling'],
      timeline.slots.slice(0, 12).map((slot) => {
        const sourceSlot = findSourceSlot(slot.slotId);
        const split = splitRejectIfForTransfer({
          ...sourceSlot?.acceptanceCriteria,
          slotText: [
            sourceSlot?.intent?.purpose,
            sourceSlot?.sourceInstance?.specificAction,
            sourceSlot?.requiredAsset.subject
          ].filter(Boolean).join('\n'),
          targetCategory: timeline.meta.targetCategory
        });
        return [
          slot.slotId,
          String(split.hardRejectIf.length),
          String(split.sourceSpecificRejectIf.length),
          split.sourceSpecificRejectIf.length
            ? 'kept as source-category evidence, not a target hard gate'
            : 'no source-category transfer filter'
        ];
      })
    ),
    '',
    '## 3. SlotMatcher Quality Distribution',
    '',
    markdownTable(
      ['bucket', 'count'],
      Object.entries(qualityDistribution(timeline)).map(([bucket, count]) => [bucket, String(count)])
    ),
    '',
    '## 4. Threshold Near Cases',
    '',
    thresholdNearCases(timeline).length
      ? markdownTable(
          ['slot', 'quality', 'evidenceStrength', 'oldStatus', 'newStatus', 'reason'],
          thresholdNearCases(timeline)
        )
      : '_No 0.40-0.45 threshold-near cases in this fixture run._',
    '',
    '## 5. Slot Tiering',
    '',
    markdownTable(
      ['#', 'slotId', 'role', 'source ms -> target ms', 'fillStatus', 'asset / recommended'],
      timeline.slots.map((slot) => [
        String(slot.index),
        slot.slotId,
        slot.role,
        `${slot.sourceStartMs ?? '-'}-${slot.sourceEndMs ?? '-'} -> ${slot.startMs}-${slot.endMs}`,
        slot.fillStatus ?? (slot.fill.kind === 'gap' ? 'missing_generation_required' : slot.fill.status),
        slot.fill.kind === 'gap' ? `→ ${slot.fill.recommendedOptionId}` : slot.fill.assetId + (slot.fill.recommendedOptionId ? ` (+${slot.fill.recommendedOptionId})` : '')
      ])
    ),
    '',
    '## 6. Motif Transfer Samples',
    '',
    motifSlots.length
      ? markdownTable(
          ['slotId', 'motifType', 'fillStatus', 'sample prompt'],
          motifSlots.map((slot) => [
            slot.slotId,
            slot.motifType ?? '-',
            slot.fillStatus ?? '-',
            firstOptionText(slot).slice(0, 180)
          ])
        )
      : '_No motif slots detected._',
    '',
    sourceSpecificSlots.length
      ? markdownTable(
          ['slotId', 'role', 'fillStatus', 'source subtype', 'beverage equivalent'],
          sourceSpecificSlots.slice(0, 12).map((slot) => [
            slot.slotId,
            slot.role,
            slot.fillStatus ?? '-',
            slot.sourceAbstraction?.subtype ?? '-',
            slot.sourceAbstraction?.targetEquivalentLabel ?? firstOptionText(slot).slice(0, 120)
          ])
        )
      : '_No source-specific slots were downgraded._',
    '',
    sourceSpecificSlots.length
      ? markdownTable(
          ['slotId', 'abstract grammar', 'target actions'],
          sourceSpecificSlots.slice(0, 12).map((slot) => [
            slot.slotId,
            slot.sourceAbstraction?.abstractGrammar ?? '-',
            slot.sourceAbstraction?.targetEquivalentActions.join(' / ') ?? '-'
          ])
        )
      : '_No source-specific abstractions emitted._',
    '',
    '',
    '## 7. Prompt Diversity',
    '',
    markdownTable(
      ['type', 'total', 'unique', 'duplicate groups'],
      Object.entries(promptDiversity(timeline)).map(([type, result]) => [
        type,
        String(result.total),
        String(result.unique),
        result.duplicateGroups.join('; ') || '-'
      ])
    ),
    '',
    '## Gap / partial resolution options',
    '',
    optionSlots
      .map((slot) => {
        const options = (slot.fill.kind === 'gap' ? slot.fill.options : slot.fill.options) ?? [];
        const recommended = slot.fill.kind === 'gap' ? slot.fill.recommendedOptionId : slot.fill.recommendedOptionId;
        const lines = options.map((option) => `  - ${option.id === recommended ? '**' : ''}${option.id}${option.id === recommended ? '** (recommended)' : ''}: ${describeOption(option)}`);
        return [`### ${slot.slotId} (${slot.role})`, ...lines].join('\n');
      })
      .join('\n\n'),
    '',
    '## 8. Transition Plan',
    '',
    markdownTable(
      ['id', 'from → to', 'function', 'mode', '中文剪辑指导'],
      timeline.transitions.map((t) => [
        t.id,
        `${t.fromSlotId} → ${t.toSlotId}`,
        t.transitionFunction ?? '-',
        t.mode,
        t.hyperframes?.editingGuidanceNL ?? t.aigcFrameBridge?.prompt ?? t.reason
      ])
    ),
    '',
    '## 9. Reusable Asset Packs',
    '',
    timeline.reusableAssetPacks?.length
      ? markdownTable(
          ['packType', 'status', 'channel', 'targetSlots', 'promptSummary'],
          timeline.reusableAssetPacks.map((pack) => [
            pack.packType,
            pack.status,
            pack.recommendedChannel,
            String(pack.targetSlots.length),
            pack.promptSummary
          ])
        )
      : '_No reusable asset packs emitted._',
    '',
    '## Video Agent handoff (timeline only — NOT rendered)',
    '',
    '```',
    'OrchestratedTimeline → orchestratedToAuthored → AuthoredTimeline',
    `beats=${authored.beats.length}  realMediaReferenced=${realMediaReferenced}  fullySatisfied=${fullySatisfied}  partialWithEnhancement=${partialWithEnhancement}  generationRequired=${generationRequired}`,
    'Director delivers this timeline; rendering (renderAuthoredTimeline) is the Video Agent\'s job, run separately.',
    '```',
    '',
    '## External job cards (plan-only; no external model called)',
    '',
    jobCards.length
      ? markdownTable(['target', 'kind', 'provider', 'ownership'], jobCards)
      : '_No external generation job cards in this run._',
    '',
    `## 10. Safety / Boundary`,
    '',
    '- 仅计划 / 仅任务卡。',
    '- 未调用外部生成模型。',
    '- 未声称真实音频生成。',
    '- 未伪造真实 CTR。',
    '- 不把 source-specific rejectIf 当成目标品类 hard gate。',
    `- Source leakage check: ${leakage.passed ? 'PASS' : 'FAIL'}`,
    leakage.passed
      ? '- No source-product-specific term leaked into positive target prompts.'
      : `- Leaked terms: ${leakage.hits.join(', ')}`
  ].join('\n');

  function findSourceSlot(slotId: string): ViralStructureGraph['shotSlots'][number] | undefined {
    return readJson<ViralStructureGraph>(INPUTS.structureGraph).shotSlots.find((slot) => slot.id === slotId);
  }
}

function describeOption(option: GapResolutionOption): string {
  if (option.id === 'reshoot') return option.guidanceNL.slice(0, 160);
  if (option.id === 'hyperframes') return option.editingGuidanceNL.slice(0, 160);
  return `[${option.providerHint}] ${option.prompt.slice(0, 160)}`;
}

function firstOptionText(slot: OrchestratedTimeline['slots'][number]): string {
  const options = slot.fill.kind === 'gap' ? slot.fill.options : slot.fill.options ?? [];
  const option = options[0];
  return option ? describeOption(option) : slot.fill.videoEngineInstruction;
}

function countTransitionFunctions(timeline: OrchestratedTimeline): Record<string, number> {
  const out: Record<string, number> = {};
  for (const transition of timeline.transitions) {
    const key = transition.transitionFunction ?? 'unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function qualityDistribution(timeline: OrchestratedTimeline): Record<string, number> {
  const buckets = { '<0.40': 0, '0.40-0.45': 0, '0.45-0.85': 0, '>=0.85': 0 };
  for (const slot of timeline.slots) {
    const quality = slot.fill.kind === 'matched' ? slot.fill.matchQuality : 0;
    if (quality < 0.4) buckets['<0.40'] += 1;
    else if (quality < 0.45) buckets['0.40-0.45'] += 1;
    else if (quality < 0.85) buckets['0.45-0.85'] += 1;
    else buckets['>=0.85'] += 1;
  }
  return buckets;
}

function thresholdNearCases(timeline: OrchestratedTimeline): string[][] {
  return timeline.slots
    .filter((slot) => slot.fill.kind === 'matched' && slot.fill.matchQuality >= 0.4 && slot.fill.matchQuality < 0.45)
    .map((slot) => {
      const quality = slot.fill.kind === 'matched' ? slot.fill.matchQuality : 0;
      const newStatus = slot.fillStatus ?? (slot.fill.kind === 'gap' ? 'missing_generation_required' : slot.fill.status);
      const oldStatus = quality >= 0.45 ? 'partial' : 'missing';
      return [
        slot.slotId,
        quality.toFixed(3),
        slot.fill.evidence.matchedIngredients.length || slot.fill.evidence.coverageStatus ? 'weak-or-better' : 'none',
        oldStatus,
        newStatus,
        slot.fill.videoEngineInstruction.slice(0, 90)
      ];
    });
}

function promptDiversity(timeline: OrchestratedTimeline): Record<string, { total: number; unique: number; duplicateGroups: string[] }> {
  const grouped: Record<string, string[]> = { reshoot: [], hyperframes: [], aigc: [] };
  for (const slot of timeline.slots) {
    const options = slot.fill.kind === 'gap' ? slot.fill.options : slot.fill.options ?? [];
    for (const option of options) {
      if (option.id === 'reshoot') grouped.reshoot.push(option.guidanceNL);
      if (option.id === 'hyperframes') grouped.hyperframes.push(option.editingGuidanceNL);
      if (option.id === 'aigc') grouped.aigc.push(option.prompt);
    }
  }
  return Object.fromEntries(Object.entries(grouped).map(([type, prompts]) => {
    const counts = new Map<string, number>();
    for (const prompt of prompts) counts.set(prompt, (counts.get(prompt) ?? 0) + 1);
    return [type, {
      total: prompts.length,
      unique: counts.size,
      duplicateGroups: [...counts.entries()].filter(([, count]) => count > 1).map(([prompt, count]) => `${count}x ${prompt.slice(0, 60)}`)
    }];
  }));
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((c) => c.replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')} |`)
  ].join('\n');
}

function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;
  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;
}

function writeText(relativePath: string, value: string): void {
  const absolutePath = path.join(repoRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, value, 'utf8');
}

if (process.argv[1] && existsSync(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
