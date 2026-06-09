import type {
  AssetCard,
  AuthoredComposition,
  AuthoredSegmentRole,
  AuthoredTimeline,
  BeatEnhancement,
  BeatEnhancementOption,
  BeatTransitionSpec,
  GapResolutionOption,
  MediaLayer,
  MediaSourceKind,
  OrchestratedSlot,
  OrchestratedTimeline,
  OrchestratedTransition
} from '@viral-struct/shared';
import { AuthoredTimelineSchema } from '@viral-struct/shared';

/**
 * P4 (§9, decision 4: A — deliver only a timeline, do not render).
 *
 * Maps the Director Agent's OrchestratedTimeline onto the structured AuthoredTimeline the Video Agent
 * (③) already executes (PR #65). This is the END of the Director's deliverable: a *timeline*, not a
 * rendered product. It never calls a renderer, never produces an MP4, never resolves media by reading
 * files — it only re-shapes the plan. Rendering (and concrete path resolution) is the Video Agent's job,
 * performed separately by `renderAuthoredTimeline`.
 *
 *   - matched / partial slot → a media beat carrying the asset id (+ optional url passthrough);
 *   - gap slot               → a beat with `unresolvedReason` (the renderer paints the honest
 *                              substitute card; the chosen gap option is recorded in the reason);
 *   - transition             → the from-slot beat's `transitionOut`.
 */
export interface OrchestratedToAuthoredOptions {
  /**
   * Optional: lets the mapper set the correct media `type` and pass through `resolvedPath` (asset url).
   * Still timeline-only — paths are a convenience for the Video Agent, not a render step.
   */
  assetCards?: AssetCard[];
}

export function orchestratedToAuthored(
  timeline: OrchestratedTimeline,
  options: OrchestratedToAuthoredOptions = {}
): AuthoredTimeline {
  const assetById = new Map((options.assetCards ?? []).map((asset) => [asset.id, asset]));
  const transitionByFrom = new Map(timeline.transitions.map((transition) => [transition.fromSlotId, transition]));

  const beats: AuthoredComposition[] = timeline.slots.map((slot) =>
    buildBeat(slot, transitionByFrom.get(slot.slotId), assetById)
  );

  const totalDurationMs = timeline.slots.reduce((max, slot) => Math.max(max, slot.endMs), 0);

  const authored: AuthoredTimeline = {
    schemaVersion: '1.0',
    renderProfile: {
      width: timeline.renderProfile.width,
      height: timeline.renderProfile.height,
      fps: timeline.renderProfile.fps,
      format: 'mp4'
    },
    beats,
    meta: {
      totalDurationMs,
      beatCount: beats.length,
      ...(timeline.meta.productName ? { productName: timeline.meta.productName } : {})
    },
    metadata: {
      generatedAt: timeline.meta.generatedAt
    }
  };

  return AuthoredTimelineSchema.parse(authored);
}

function buildBeat(
  slot: OrchestratedSlot,
  transition: OrchestratedTransition | undefined,
  assetById: Map<string, AssetCard>
): AuthoredComposition {
  const authorIntent = buildAuthorIntent(slot);
  const enhancement = buildEnhancement(slot);
  const beat: AuthoredComposition = {
    id: slot.slotId,
    segmentRole: toAuthoredSegmentRole(slot.role),
    startSeconds: slot.startMs / 1000,
    endSeconds: slot.endMs / 1000,
    mediaLayers: [],
    textElements: [],
    ...(transition ? { transitionOut: toTransitionSpec(transition) } : {}),
    ...(authorIntent ? { authorIntent } : {}),
    // Carry the channel briefs (reshoot/hyperframes/aigc) so the Video Agent knows HOW to enhance the beat.
    ...(enhancement ? { enhancement } : {})
  };

  if (slot.fill.kind === 'matched') {
    return { ...beat, mediaLayers: [buildMediaLayer(slot, slot.fill.assetId, assetById.get(slot.fill.assetId))] };
  }

  // gap → honest substitute card; record the recommended resolution option in the reason.
  return {
    ...beat,
    unresolvedReason: `gap: ${slot.fill.missing} (recommended option: ${slot.fill.recommendedOptionId})`
  };
}

/**
 * Re-shape the slot's resolution options into the handoff's enhancement briefs. Present on EVERY beat that
 * carries options — matched/covered beats included (there the channels are alternatives, signalled by
 * `fillStatus: 'matched'`); only a beat with no authored options at all yields `undefined`.
 */
function buildEnhancement(slot: OrchestratedSlot): BeatEnhancement | undefined {
  const options = slot.fill.options;
  if (!options || options.length === 0) return undefined;
  const recommendedId = slot.fill.recommendedOptionId;
  const fillStatus = slot.fillStatus ?? (slot.fill.kind === 'gap' ? 'missing_generation_required' : slot.fill.status);
  return {
    fillStatus,
    ...(recommendedId ? { recommendedChannel: recommendedId } : {}),
    options: options.map((option) => toEnhancementOption(option, option.id === recommendedId))
  };
}

function toEnhancementOption(option: GapResolutionOption, recommended: boolean): BeatEnhancementOption {
  if (option.id === 'reshoot') return { channel: 'reshoot', title: option.title, guidance: option.guidanceNL, recommended };
  if (option.id === 'hyperframes') return { channel: 'hyperframes', title: option.title, guidance: option.editingGuidanceNL, recommended };
  return { channel: 'aigc', guidance: option.prompt, recommended };
}

function buildMediaLayer(slot: OrchestratedSlot, assetId: string, asset: AssetCard | undefined): MediaLayer {
  return {
    id: `${slot.slotId}_layer`,
    media: {
      id: `${slot.slotId}_media`,
      type: mediaType(asset),
      assetId,
      ...(asset?.url ? { resolvedPath: asset.url } : {})
    },
    fit: 'cover',
    zOrder: 0,
    opacity: 1,
    evidence: { tier: 'real', sourceAssetId: assetId }
  };
}

function mediaType(asset: AssetCard | undefined): MediaSourceKind {
  return asset?.type === 'video' ? 'video' : 'image';
}

function toTransitionSpec(transition: OrchestratedTransition): BeatTransitionSpec {
  const kind: BeatTransitionSpec['kind'] = authoredTransitionKind(transition);
  const requested =
    transition.hyperframes?.durationMs ?? transition.aigcFrameBridge?.durationMs ?? (kind === 'cut' ? 0 : 300);
  return { kind, durationMs: Math.min(2000, Math.max(0, Math.round(requested))) };
}

function authoredTransitionKind(transition: OrchestratedTransition): BeatTransitionSpec['kind'] {
  switch (transition.mode) {
    case 'cut':
    case 'match_cut':
    case 'graphic_match':
    case 'eyeline_bridge':
      return 'cut';
    case 'aigc_frame_bridge':
    case 'aigc_job_card':
    case 'particle_bridge':
      return 'fade';
    case 'object_wipe':
    case 'motion_bridge':
    case 'split_edit_j_cut':
    case 'split_edit_l_cut':
    case 'card_animation':
    case 'hyperframes':
    default:
      return 'slide';
  }
}

function buildAuthorIntent(slot: OrchestratedSlot): AuthoredComposition['authorIntent'] | undefined {
  const intent: NonNullable<AuthoredComposition['authorIntent']> = { focusElement: slot.role };
  if (slot.motifType) intent.visualTheme = slot.motifType;
  return intent;
}

const SLOT_ROLE_TO_SEGMENT_ROLE: Record<string, AuthoredSegmentRole> = {
  opening_attention: 'hook',
  product_closeup: 'selling_point',
  usage_demo: 'usage',
  benefit_visual: 'proof',
  comparison: 'comparison',
  testimonial: 'proof',
  cta_visual: 'cta',
  instruction_card: 'explanation',
  example_clip: 'demonstration',
  technique_demo: 'technique_step'
};

function toAuthoredSegmentRole(role: string): AuthoredSegmentRole {
  return SLOT_ROLE_TO_SEGMENT_ROLE[role] ?? 'context';
}
