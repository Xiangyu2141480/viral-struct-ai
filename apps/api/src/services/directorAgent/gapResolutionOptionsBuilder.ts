import type {
  AigcGenerationBrief,
  AigcOption,
  AssetSupplyContext,
  ContentBrief,
  ContextualSlotCoverage,
  GapResolutionOption,
  GapResolutionOptionId,
  HyperframesFallbackBrief,
  HyperframesOption,
  ManualShootBrief,
  MissingMaterialBrief,
  ReshootOption,
  ShotSlotNode
} from '@viral-struct/shared';
import { DEFAULT_ASPECT_RATIO, SAFE_NEGATIVE_PROMPT } from './constants';

/**
 * P2 (§6) — every partial/gap slot gets exactly three resolution options: reshoot / hyperframes / aigc.
 *
 * Reuse: the Asset Manager already produces a per-slot MissingMaterialBrief carrying a manualShootBrief,
 * an aigcGenerationBrief (leak-safe), a hyperframesBrief (card inputs) and channelEligibility. We map
 * those into the three OrchestratedTimeline options and synthesize the one piece ② does not provide —
 * the natural-language `editingGuidanceNL` the Video Agent needs to execute a hyperframes edit. When no
 * brief exists (the rare gate-blocked-but-covered slot), we synthesize compact, leak-safe options.
 *
 * Recommendation follows the degradation ladder (§6.4, decision: 方案二):
 *   - partial → recommend `hyperframes` (a usable asset already exists; edit it — cheapest + IP-safe);
 *   - gap     → recommend `aigc` (nothing to edit; generate), falling back to `hyperframes` when AIGC is
 *               not eligible (card treatment is always executable). `reshoot` is always offered, never auto.
 */
export interface BuildGapResolutionOptionsArgs {
  slot: ShotSlotNode;
  tier: 'partial' | 'gap';
  coverage?: ContextualSlotCoverage;
  missingBrief?: MissingMaterialBrief;
  assetSupplyContext?: AssetSupplyContext;
  contentBrief: ContentBrief;
  referenceAssetIds: string[];
}

export interface GapResolutionOptionsResult {
  options: GapResolutionOption[];
  recommendedOptionId: GapResolutionOptionId;
}

export function buildGapResolutionOptions(args: BuildGapResolutionOptionsArgs): GapResolutionOptionsResult {
  const brief =
    args.missingBrief
    ?? args.assetSupplyContext?.missingMaterialBriefs?.find((entry) => entry.affectedSlotId === args.slot.id);

  const reshoot = buildReshootOption(args, brief?.manualShootBrief);
  const hyperframes = buildHyperframesOption(args, brief?.hyperframesBrief);
  const aigc = buildAigcOption(args, brief?.aigcGenerationBrief);

  return {
    options: [reshoot, hyperframes, aigc],
    recommendedOptionId: recommend(args, brief, aigc)
  };
}

// --- recommendation ---------------------------------------------------------

function recommend(
  args: BuildGapResolutionOptionsArgs,
  brief: MissingMaterialBrief | undefined,
  aigc: AigcOption
): GapResolutionOptionId {
  if (args.tier === 'partial') {
    return 'hyperframes';
  }
  return isAigcEligible(brief, aigc) ? 'aigc' : 'hyperframes';
}

function isAigcEligible(brief: MissingMaterialBrief | undefined, aigc: AigcOption): boolean {
  const channel = brief?.channelEligibility?.find((entry) => entry.channel === 'aigc_video_prompt');
  if (channel) {
    return channel.eligible;
  }
  // No eligibility signal: AIGC is only meaningful with a product reference to anchor generation.
  return aigc.referenceAssetIds.length > 0;
}

// --- reshoot ----------------------------------------------------------------

function buildReshootOption(args: BuildGapResolutionOptionsArgs, manual?: ManualShootBrief): ReshootOption {
  const productName = args.contentBrief.productName;
  if (manual) {
    return {
      id: 'reshoot',
      title: manual.title,
      // Positive guidance only. The `avoid` list (which legitimately names banned source terms as
      // guardrails) stays in the `avoid` field so it never reads as a positive instruction.
      guidanceNL: [
        manual.objective,
        manual.shotDescription,
        manual.mustCapture.length ? `Must capture: ${manual.mustCapture.join(', ')}.` : undefined
      ]
        .filter(Boolean)
        .join(' '),
      framing: manual.framing,
      durationSec: positive(manual.durationSec, 3),
      mustCapture: manual.mustCapture,
      avoid: manual.avoid
    };
  }

  const roleLabel = humanRole(args.slot.role);
  return {
    id: 'reshoot',
    title: `补拍${roleLabel}素材`,
    guidanceNL:
      `Shoot a vertical 3-second clip for ${productName} that satisfies the ${roleLabel} intent; `
      + 'keep the product label readable and the background clean. '
      + `Must capture: product visible, clear ${roleLabel} action. `
      + 'Avoid: other visible brands, celebrity likeness, price or medical claims.',
    framing: 'vertical shot with the product and the slot action both visible',
    durationSec: 3,
    mustCapture: ['product visible', `clear ${roleLabel} action`],
    avoid: ['other visible brands', 'celebrity or public-person likeness', 'unverified price or medical claims']
  };
}

// --- hyperframes (the one piece ② does not supply: editingGuidanceNL) -------

function buildHyperframesOption(args: BuildGapResolutionOptionsArgs, hyper?: HyperframesFallbackBrief): HyperframesOption {
  const productName = args.contentBrief.productName;
  const roleLabel = humanRole(args.slot.role);
  const referencedAssetIds = uniqueNonEmpty(hyper?.inputAssets?.length ? hyper.inputAssets : args.referenceAssetIds);
  const visualElements = (hyper?.visualElements?.length ? hyper.visualElements : [productName]).slice(0, 4);
  const animationHints = hyper?.animationHints?.length ? hyper.animationHints : ['simple reveal', 'short copy'];

  const editingGuidanceNL = [
    `Use ${productName} as the center layer.`,
    hyper?.copyIntent ?? `Bridge the ${roleLabel} slot with a clear card animation.`,
    `Animate ${visualElements.join(', ')} with ${animationHints.join(', ')}.`,
    referencedAssetIds.length ? `Reference existing assets: ${referencedAssetIds.join(', ')}.` : undefined,
    'Keep the original product label visible. Do not introduce unauthorized brands, price promises, or health claims.'
  ]
    .filter(Boolean)
    .join(' ');

  const copy = buildCopy(args);

  return {
    id: 'hyperframes',
    title: hyper?.title ?? `${roleLabel} card`,
    editingGuidanceNL,
    cardType: hyper?.cardType ?? 'timeline_bridge_card',
    ...(copy ? { copy } : {}),
    referencedAssetIds,
    durationMs: positive(Math.round((hyper?.durationSec ?? 3) * 1000), 3000)
  };
}

function buildCopy(args: BuildGapResolutionOptionsArgs): HyperframesOption['copy'] | undefined {
  const headline = args.contentBrief.sellingPoints[0];
  const cta = isCtaRole(args.slot.role) ? args.contentBrief.cta : undefined;
  const copy: NonNullable<HyperframesOption['copy']> = {};
  if (headline) copy.headline = headline;
  if (cta) copy.cta = cta;
  return Object.keys(copy).length > 0 ? copy : undefined;
}

// --- aigc (leak-safe; job-card only) ----------------------------------------

function buildAigcOption(args: BuildGapResolutionOptionsArgs, aigc?: AigcGenerationBrief): AigcOption {
  if (aigc) {
    return {
      id: 'aigc',
      prompt: aigc.prompt,
      negativePrompt: aigc.negativePrompt,
      referenceAssetIds: aigc.referenceAssetIds,
      aspectRatio: aigc.aspectRatio,
      expectedDurationSec: positive(aigc.expectedDurationSec, 3),
      providerHint: aigc.providerHint,
      ownership: 'external_generation_job_card_only'
    };
  }

  // No brief: synthesize a leak-safe prompt from product + role only (never the raw source intent).
  const productName = args.contentBrief.productName;
  const roleLabel = humanRole(args.slot.role);
  return {
    id: 'aigc',
    prompt:
      'Prompt brief only, not rendered output. '
      + `Create a 9:16 ordinary smartphone-style ${roleLabel} shot for ${productName}. `
      + 'Do not invent price, promotion, medical benefit, celebrity endorsement, or extra brands.',
    negativePrompt: SAFE_NEGATIVE_PROMPT,
    referenceAssetIds: uniqueNonEmpty(args.referenceAssetIds),
    aspectRatio: DEFAULT_ASPECT_RATIO,
    expectedDurationSec: 3,
    providerHint: 'generic',
    ownership: 'external_generation_job_card_only'
  };
}

// --- helpers ----------------------------------------------------------------

function humanRole(role: string): string {
  return role.replace(/_/g, ' ');
}

function isCtaRole(role: string): boolean {
  return role === 'cta' || role === 'cta_visual';
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function uniqueNonEmpty(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => Boolean(id))));
}
