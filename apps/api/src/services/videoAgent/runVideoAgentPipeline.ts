import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AssetCard,
  AuthoredTimeline,
  Boundary,
  ContentBrief,
  MaterialGap,
  SlotMatch,
  TimelineItem,
  ViralStructureGraph
} from '@viral-struct/shared';
import {
  authorTimeline,
  planGapFills,
  type EditConstraints,
  type GapFillPlan,
  type VideoEditContext
} from '@viral-struct/video-agent';
import { AuthoredFfmpegExecutor, type RenderResult } from '@viral-struct/render-executor';
import { matchSlots } from '../slotMatcher';
import { authoredTimelineToTimelineItems } from './authoredTimelineAdapter';

// apps/api/src/services/videoAgent → repo root (../../../../..).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');

export interface RunVideoAgentPipelineInput {
  structureGraph: ViralStructureGraph;
  assetCards: AssetCard[];
  contentBrief: ContentBrief;
  boundaries?: Boundary[];
  /** Slots the user has confirmed they cannot provide real footage for (routes real-proof gaps honestly). */
  userUnprovidableSlotIds?: string[];
  /** Pre-computed slot matches/gaps (e.g. from the LLM-fallback matcher). Falls back to deterministic matchSlots. */
  match?: { matches: SlotMatch[]; gaps: MaterialGap[] };
}

export interface RunVideoAgentPipelineResult {
  authoredTimeline: AuthoredTimeline;
  /** ③ authored beats projected onto the flat ①-era shape for transition/audio/quality consumers. */
  timelineItems: TimelineItem[];
  matches: SlotMatch[];
  materialGaps: MaterialGap[];
  gapFills: GapFillPlan[];
  authorSource: 'llm' | 'mock';
}

/**
 * The ③ video-agent pipeline as a single reusable service. It replaces ①'s middle
 * (gapRepairPlanner → timelineGenerator → renderService) with the proven seam:
 *
 *   matchSlots → VideoEditContext → planGapFills → authorTimeline (mock author, no LLM) → AuthoredTimeline
 *
 * The shared slot matcher is KEPT (it produces the slotMatches/materialGaps ③ needs). Rendering is a separate
 * step ({@link renderAuthoredTimeline}) so callers that only need the authored plan never touch ffmpeg.
 */
export async function runVideoAgentPipeline(input: RunVideoAgentPipelineInput): Promise<RunVideoAgentPipelineResult> {
  const match = input.match ?? matchSlots(input.structureGraph, input.assetCards, input.boundaries);

  const constraints: EditConstraints = {
    aspectRatio: (input.structureGraph.meta?.aspectRatio as EditConstraints['aspectRatio']) ?? '9:16',
    allowAigc: true,
    allowHumanGeneration: false,
    allowedClaimSources: input.contentBrief.sellingPoints,
    forbiddenClaims: []
  };

  const context: VideoEditContext = {
    projectId: `videoagent_${Date.now()}`,
    structureGraph: input.structureGraph,
    contentBrief: input.contentBrief,
    assetCards: input.assetCards,
    slotMatches: match.matches,
    materialGaps: match.gaps,
    userUnprovidableSlotIds: input.userUnprovidableSlotIds,
    constraints
  };

  const gapFills = planGapFills(context);
  const authored = await authorTimeline(context);

  return {
    authoredTimeline: authored.timeline,
    timelineItems: authoredTimelineToTimelineItems(authored.timeline),
    matches: match.matches,
    materialGaps: match.gaps,
    gapFills,
    authorSource: authored.source
  };
}

export interface RenderAuthoredTimelineInput {
  timeline: AuthoredTimeline;
  outputPath: string;
  /** Base dir for resolving relative media paths. Defaults to the repo root. */
  baseDir?: string;
}

/**
 * Render an AuthoredTimeline to a real MP4 via ③'s AuthoredFfmpegExecutor. Each media layer's path is resolved
 * to absolute and pruned when the source file is absent, so missing media degrades to the executor's honest
 * colour/substitute card instead of failing the render.
 */
export async function renderAuthoredTimeline(input: RenderAuthoredTimelineInput): Promise<RenderResult> {
  const baseDir = input.baseDir ?? repoRoot;
  const resolved = resolveAuthoredMedia(input.timeline, baseDir);
  const executor = new AuthoredFfmpegExecutor({ outputPath: input.outputPath });
  return executor.render(resolved);
}

function resolveAuthoredMedia(timeline: AuthoredTimeline, baseDir: string): AuthoredTimeline {
  const beats = timeline.beats.map((beat) => {
    const mediaLayers = beat.mediaLayers
      .map((layer) => {
        const rp = layer.media.resolvedPath;
        if (!rp) return layer;
        const abs = path.isAbsolute(rp) ? rp : path.join(baseDir, rp);
        if (!existsSync(abs)) return null; // prune → beat renders as colour/substitute card
        return { ...layer, media: { ...layer.media, resolvedPath: abs } };
      })
      .filter((layer): layer is NonNullable<typeof layer> => layer !== null);
    return { ...beat, mediaLayers };
  });
  return { ...timeline, beats };
}
