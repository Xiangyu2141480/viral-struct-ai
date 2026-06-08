/**
 * D1 offline rule-table expansion CLI (decision D1 / 做法C).
 *
 * Reads real `structure_graph.json` files (the output of rough_scan → fine_scan →
 * extract_structure_graph), harvests the slot text the current deterministic rule
 * table fails to handle, and — when an LLM key is present — asks the model to draft
 * new abstract token rules. The drafts are leakage-gated and written to a review
 * artifact; a human审 then manually merges them into `motionGrammarSanitizer`'s
 * TOKEN_RULES / `motifTaxonomy`'s MOTIF_DEFINITIONS. Runtime stays pure rules.
 *
 * Usage:
 *   npx tsx scripts/llm_expand_motif_rules.ts [graph.json ...] [--out path] [--dry-run]
 *
 * With no graph args it scans the seed_assets/analysis graphs. `--dry-run` (or a
 * missing LLM key) writes the harvested gap report without LLM proposals.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ShotSlotNode } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from '../apps/api/src/services/llmProvider';
import {
  mineRuleGaps,
  buildRuleProposalPrompt,
  parseRuleProposals,
  RULE_MINER_SYSTEM_PROMPT,
  type RuleGapRecord,
  type RuleProposalResult
} from '../apps/api/src/services/motifs/motifRuleMiner';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_GRAPHS = [
  'seed_assets/analysis/macbook_neo/structure_graph.json',
  'seed_assets/analysis/chocolate_mud_pie/structure_graph.json'
];

interface Cli {
  graphs: string[];
  out: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Cli {
  const graphs: string[] = [];
  let out = 'tmp/motif-rule-proposals.json';
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--out') out = argv[++i] ?? out;
    else graphs.push(arg);
  }
  return { graphs: graphs.length ? graphs : DEFAULT_GRAPHS, out, dryRun };
}

function loadSlots(graphRelPath: string): ShotSlotNode[] {
  const abs = path.resolve(repoRoot, graphRelPath);
  if (!existsSync(abs)) {
    console.warn(`  ! skipped (not found): ${graphRelPath}`);
    return [];
  }
  const graph = JSON.parse(readFileSync(abs, 'utf-8')) as { shotSlots?: ShotSlotNode[] };
  return graph.shotSlots ?? [];
}

async function draftProposals(records: RuleGapRecord[]): Promise<RuleProposalResult | { skipped: string }> {
  if (records.length === 0) return { skipped: 'no gaps to draft' };
  let client: ReturnType<typeof createOpenAICompatibleClient>;
  try {
    client = createOpenAICompatibleClient();
  } catch (err) {
    return { skipped: `LLM unavailable: ${err instanceof Error ? err.message : String(err)}` };
  }
  const model = process.env.LLM_MODEL;
  if (!model) return { skipped: 'LLM_MODEL not set' };

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: RULE_MINER_SYSTEM_PROMPT },
      { role: 'user', content: buildRuleProposalPrompt(records) }
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' }
  });
  const raw = response.choices[0]?.message?.content ?? '{"proposals":[]}';
  return parseRuleProposals(raw);
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  console.log(`D1 rule miner — graphs: ${cli.graphs.join(', ')}`);

  const allSlots = cli.graphs.flatMap(loadSlots);
  const gaps = mineRuleGaps(allSlots);
  console.log(`  slots scanned: ${allSlots.length}`);
  console.log(`  rule gaps found: ${gaps.length} (uncovered=${gaps.filter((g) => g.gapKind === 'uncovered').length}, novel=${gaps.filter((g) => g.gapKind === 'novel_combination').length})`);

  const proposals = cli.dryRun ? { skipped: 'dry-run' } : await draftProposals(gaps);
  if ('accepted' in proposals) {
    console.log(`  LLM proposals: accepted=${proposals.accepted.length}, rejected(leakage)=${proposals.rejected.length}`);
  } else {
    console.log(`  LLM proposals skipped: ${proposals.skipped}`);
  }

  const artifact = {
    generatedAt: new Date().toISOString(),
    graphs: cli.graphs,
    slotsScanned: allSlots.length,
    gaps,
    proposals,
    reviewNote: 'Human审 required. Merge accepted proposals into motionGrammarSanitizer TOKEN_RULES (+ motifTaxonomy MOTIF_DEFINITIONS). Runtime stays pure rules.'
  };

  const outAbs = path.resolve(repoRoot, cli.out);
  mkdirSync(path.dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, JSON.stringify(artifact, null, 2), 'utf-8');
  console.log(`  wrote review artifact → ${cli.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
