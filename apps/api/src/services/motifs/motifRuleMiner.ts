import { z } from 'zod';
import type { MotionToken, ShotSlotNode } from '@viral-struct/shared';
import { collectSlotText } from './viralMotifExtractor';
import { sanitizeMotionGrammarText, containsSourceSpecificTerm } from './motionGrammarSanitizer';
import { classifyMotif } from './motifTaxonomy';

/**
 * D1 offline rule-table expansion (decision D1 / 做法C).
 *
 * The runtime sanitizer is a deterministic text→MotionToken rule table. This
 * module is the *offline* side: it harvests the slot text that the current rule
 * table fails to handle — straight from real `structure_graph.json` output of
 * the two scans, so the corpus matches the exact vocabulary fine_scan emits —
 * and shapes it for an LLM to draft new token rules. The LLM never runs at
 * runtime; its output is a review artifact a human merges into the rule table.
 *
 * Two gap kinds are surfaced:
 *  - `uncovered`: the slot describes motion but the rules extracted zero tokens.
 *  - `novel_combination`: tokens fired but no motif definition cleared threshold.
 */
export interface RuleGapRecord {
  slotId: string;
  segmentId?: string;
  sourceText: string;
  firedTokens: MotionToken[];
  gapKind: 'uncovered' | 'novel_combination';
  suggestedSlug?: string;
  note: string;
}

function hasMotionDescription(slot: ShotSlotNode): boolean {
  const motion = slot.requiredAsset?.motion;
  if (motion && motion !== 'static' && motion !== 'unknown') return true;
  if (slot.intent?.motionPattern && slot.intent.motionPattern.trim().length > 0) return true;
  // fine_scan sometimes phrases the motion inside acceptance examples rather than
  // a structured field — inspect those too, but never the id/role boilerplate.
  return Boolean(slot.acceptanceCriteria?.anyOf?.some((c) => c.motionType || c.examples?.length));
}

/** Harvest the slots the current rule table does not yet handle. */
export function mineRuleGaps(slots: ShotSlotNode[]): RuleGapRecord[] {
  const records: RuleGapRecord[] = [];

  for (const slot of slots) {
    const sourceText = collectSlotText(slot);
    if (!sourceText.trim()) continue;

    const firedTokens = sanitizeMotionGrammarText(sourceText).motionTokens;
    const classification = classifyMotif(firedTokens);

    if (firedTokens.length === 0) {
      if (!hasMotionDescription(slot)) continue;
      records.push({
        slotId: slot.id,
        segmentId: slot.segmentId,
        sourceText,
        firedTokens,
        gapKind: 'uncovered',
        note: 'Slot describes motion but no token rule fired. Candidate for a new TOKEN_RULES entry.'
      });
      continue;
    }

    if (classification.isNovel && classification.candidate) {
      records.push({
        slotId: slot.id,
        segmentId: slot.segmentId,
        sourceText,
        firedTokens,
        gapKind: 'novel_combination',
        suggestedSlug: classification.candidate.suggestedSlug,
        note: classification.candidate.note
      });
    }
  }

  return records;
}

// ---------------------------------------------------------------------------
// LLM proposal drafting (offline only) — schema, prompt, leakage-gated parsing.
// ---------------------------------------------------------------------------

export interface RuleProposal {
  /** snake_case token slug, e.g. `liquid_swirl`. */
  token: string;
  /** Human-readable canonical phrase used in sanitizer evidence. */
  canonicalPhrase: string;
  /** Regex source strings (EN + 中文), compiled by the reviewer when merging. */
  patterns: string[];
  /** The harvested text this rule is meant to catch (traceability). */
  exampleMatchedText?: string;
  /** Optional existing motif this token should feed into. */
  mapsToMotif?: string;
}

export interface RuleProposalResult {
  accepted: RuleProposal[];
  rejected: Array<{ proposal: RuleProposal; reason: string }>;
}

const RuleProposalSchema = z.object({
  token: z.string().min(2).regex(/^[a-z][a-z0-9_]+$/, 'token must be snake_case'),
  canonicalPhrase: z.string().min(2),
  patterns: z.array(z.string().min(1)).min(1),
  exampleMatchedText: z.string().optional(),
  mapsToMotif: z.string().optional()
});

const RuleProposalsSchema = z.object({
  proposals: z.array(RuleProposalSchema)
});

export const RULE_MINER_SYSTEM_PROMPT = [
  'You expand a deterministic motion-grammar rule table for short-video structure transfer.',
  'You are given motion descriptions from real scan output that the current rules failed to tokenize.',
  'Propose new ABSTRACT, category-agnostic motion tokens (snake_case) + EN and 中文 regex patterns that would catch them.',
  'Tokens describe HOW things move (cascade, swirl, snap), never WHAT product or brand.',
  'NEVER include source-specific terms: keyboard, laptop, touchpad, rocket, hardware, MacBook, Apple, 键盘, 笔记本, 触控板, 火箭, 硬件功能.',
  'Output JSON only: { "proposals": [ { token, canonicalPhrase, patterns[], exampleMatchedText, mapsToMotif } ] }.'
].join(' ');

/** Build the user prompt body from harvested gaps. */
export function buildRuleProposalPrompt(records: RuleGapRecord[]): string {
  const lines = records.map((record, index) =>
    `${index + 1}. [${record.gapKind}] fired=[${record.firedTokens.join(', ') || 'none'}] :: ${record.sourceText}`
  );
  return [
    'Motion descriptions the current rule table did not fully handle:',
    ...lines,
    '',
    'Return abstract token rules (EN + 中文 patterns) that would tokenize the motion in these descriptions.'
  ].join('\n');
}

/**
 * Validate raw LLM JSON into proposals, then leakage-gate each one. A proposal
 * whose token / phrase / patterns name a source-specific term is rejected, never
 * silently merged — the offline path obeys the same leakage guard as runtime.
 */
export function parseRuleProposals(raw: string, sourceBannedTerms: readonly string[] = []): RuleProposalResult {
  const parsed = RuleProposalsSchema.parse(JSON.parse(raw));
  const accepted: RuleProposal[] = [];
  const rejected: RuleProposalResult['rejected'] = [];

  for (const proposal of parsed.proposals) {
    const surface = [proposal.token, proposal.canonicalPhrase, ...proposal.patterns].join(' ');
    if (containsSourceSpecificTerm(surface, sourceBannedTerms)) {
      rejected.push({ proposal, reason: 'Proposal names a source-specific term; rejected by leakage guard.' });
      continue;
    }
    accepted.push(proposal);
  }

  return { accepted, rejected };
}
