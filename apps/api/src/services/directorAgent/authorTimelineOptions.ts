import type { ContentBrief, GapResolutionOption, OrchestratedSlot, OrchestratedTimeline, ProductIntelligence } from '@viral-struct/shared';
import { OrchestratedTimelineSchema } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from '../llmProvider';
import {
  authorChannelBriefs,
  type AuthoredChannelText,
  type AuthoringChannel,
  type SharedChannelIntent
} from './channelBriefAuthor';

/**
 * Post-Director option authoring stage (option-2 design).
 *
 * The Director (buildOrchestratedTimeline) stays plan-only and produces deterministic fallback option
 * text. This optional stage RE-AUTHORS each slot's reshoot/hyperframes/aigc text with the LLM, one
 * shared neutral intent → three capability-bounded prompts (see channelBriefAuthor). Only the natural-
 * language text fields are replaced; all structural fields (durations, aspectRatio, providerHint,
 * ownership, referenced asset ids, ids, recommendation) are preserved, so the result still validates
 * against OrchestratedTimelineSchema. A channel that fails / fails validation keeps its deterministic text.
 */

type Client = ReturnType<typeof createOpenAICompatibleClient>;

export interface AuthorTimelineOptionsConfig {
  contentBrief: ContentBrief;
  /** P1: PI feeds proof types + claim boundaries into each channel's prompt context. */
  productIntelligence?: ProductIntelligence;
  enabled?: boolean;
  clientFactory?: () => Client;
  model?: string;
}

export interface AuthorTimelineOptionsResult {
  timeline: OrchestratedTimeline;
  authoredSlots: number;
  warnings: string[];
}

export async function authorTimelineOptions(
  timeline: OrchestratedTimeline,
  config: AuthorTimelineOptionsConfig
): Promise<AuthorTimelineOptionsResult> {
  const enabled = config.enabled ?? false;
  if (!enabled) {
    return { timeline, authoredSlots: 0, warnings: ['option authoring disabled'] };
  }

  const warnings: string[] = [];
  let authoredSlots = 0;
  const slots: OrchestratedSlot[] = [];

  // Sequential over slots (bounds LLM concurrency); channels within a slot run in parallel.
  for (const slot of timeline.slots) {
    const options = slot.fill.options;
    if (!options || options.length === 0) {
      slots.push(slot);
      continue;
    }
    const channels = options
      .map((option) => option.id)
      .filter((id): id is AuthoringChannel => id === 'reshoot' || id === 'hyperframes' || id === 'aigc');

    const authored = await authorChannelBriefs({
      intent: buildIntent(slot, config.contentBrief, options, config.productIntelligence),
      channels,
      clientFactory: config.clientFactory,
      model: config.model
    });
    warnings.push(...authored.warnings);
    if (authored.reshoot || authored.hyperframes || authored.aigc) authoredSlots += 1;

    const nextOptions = options.map((option) => mergeOption(option, authored));
    slots.push({ ...slot, fill: { ...slot.fill, options: nextOptions } } as OrchestratedSlot);
  }

  const next = OrchestratedTimelineSchema.parse({ ...timeline, slots });
  return { timeline: next, authoredSlots, warnings };
}

function buildIntent(
  slot: OrchestratedSlot,
  contentBrief: ContentBrief,
  options: GapResolutionOption[],
  productIntelligence?: ProductIntelligence
): SharedChannelIntent {
  const reshoot = options.find((o) => o.id === 'reshoot');
  const durationSec = reshoot && reshoot.id === 'reshoot'
    ? reshoot.durationSec
    : Math.max(2, Math.round((slot.endMs - slot.startMs) / 1000));
  const beat = slot.compressionBeat;
  return {
    slotId: slot.slotId,
    role: slot.role,
    productName: contentBrief.productName,
    category: contentBrief.category ?? 'generic',
    sellingPoints: contentBrief.sellingPoints,
    // P1: prefer the compression beat's neutral target-equivalent NL as the abstract intent.
    transferableIntent: beat?.targetEquivalentBeat ?? slot.transferableIntent,
    motionTokens: slot.motionTokens ?? [],
    motifType: slot.motifType,
    fillStatus: slot.fillStatus ?? (slot.fill.kind === 'gap' ? 'missing_generation_required' : slot.fill.status),
    referenceAssetIds: collectReferenceAssetIds(slot, options),
    assetEvidence: collectAssetEvidence(slot),
    durationSec,
    productComplexity: productIntelligence?.complexity,
    proofTypes: productIntelligence?.recommendedProofTypes,
    preservedStructureFunction: beat?.preservedStructureFunction,
    targetEquivalentFamily: beat?.targetEquivalentFamily,
    targetEquivalentBeat: beat?.targetEquivalentBeat,
    forbiddenClaims: productIntelligence?.forbiddenClaims.map((c) => c.rule)
  };
}

function collectReferenceAssetIds(slot: OrchestratedSlot, options: GapResolutionOption[]): string[] {
  const ids = new Set<string>();
  if (slot.fill.kind === 'matched' && slot.fill.assetId) ids.add(slot.fill.assetId);
  for (const option of options) {
    if (option.id === 'hyperframes') option.referencedAssetIds.forEach((id) => ids.add(id));
    if (option.id === 'aigc') option.referenceAssetIds.forEach((id) => ids.add(id));
  }
  return [...ids];
}

function collectAssetEvidence(slot: OrchestratedSlot): string[] {
  const evidence = slot.fill.evidence;
  const matched = slot.fill.kind === 'matched' ? slot.fill.matchedCriteria : [];
  return [...matched, ...evidence.matchedIngredients].filter(Boolean).slice(0, 6);
}

function mergeOption(option: GapResolutionOption, authored: AuthoredChannelText): GapResolutionOption {
  if (option.id === 'reshoot' && authored.reshoot) {
    return {
      ...option,
      title: authored.reshoot.title,
      guidanceNL: authored.reshoot.guidanceNL,
      framing: authored.reshoot.framing,
      mustCapture: authored.reshoot.mustCapture.length ? authored.reshoot.mustCapture : option.mustCapture,
      avoid: authored.reshoot.avoid.length ? authored.reshoot.avoid : option.avoid
    };
  }
  if (option.id === 'hyperframes' && authored.hyperframes) {
    const merged: GapResolutionOption = {
      ...option,
      title: authored.hyperframes.title,
      editingGuidanceNL: authored.hyperframes.editingGuidanceNL
    };
    if (authored.hyperframes.cardType) merged.cardType = authored.hyperframes.cardType;
    if (authored.hyperframes.copy) merged.copy = authored.hyperframes.copy;
    return merged;
  }
  if (option.id === 'aigc' && authored.aigc) {
    return { ...option, prompt: authored.aigc.prompt, negativePrompt: authored.aigc.negativePrompt };
  }
  return option;
}
