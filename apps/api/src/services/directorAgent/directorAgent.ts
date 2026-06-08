import type {
  AssetCard,
  AssetSupplyContext,
  Boundary,
  ContentBrief,
  OrchestratedTimeline,
  ViralStructureGraph
} from '@viral-struct/shared';
import type { CategoryPreset } from '../motifs/categoryPresetProvider';
import { createOpenAICompatibleClient } from '../llmProvider';
import { buildOrchestratedTimeline } from './orchestratedTimelineBuilder';

type LlmClient = ReturnType<typeof createOpenAICompatibleClient>;

/**
 * Director Agent — the public entry (§4).
 *
 * Boundary (hard constraints, §12): the Director Agent lives in its own module, never writes into
 * assetManager/, consumes ②'s AssetSupplyContext read-only, and only PLANS — it never renders an MP4,
 * never calls an external generation model, and never produces audio. Its deliverable is a timeline.
 */
export interface RunDirectorAgentInput {
  projectId: string;
  structureGraph: ViralStructureGraph;
  assetCards: AssetCard[];
  /** ②'s product, consumed read-only as evidence. Built internally (coverage only) when omitted. */
  assetSupplyContext?: AssetSupplyContext;
  contentBrief: ContentBrief;
  categoryPreset?: CategoryPreset;
  boundaries?: Boundary[];
  options?: {
    hyperframesTransitionWeight?: number;
    useLlmMatcher?: boolean;
    /** Injected for tests / mock LLM. */
    clientFactory?: () => LlmClient;
    model?: string;
  };
}

export async function runDirectorAgent(input: RunDirectorAgentInput): Promise<OrchestratedTimeline> {
  return buildOrchestratedTimeline({
    projectId: input.projectId,
    structureGraph: input.structureGraph,
    assetCards: input.assetCards,
    assetSupplyContext: input.assetSupplyContext,
    contentBrief: input.contentBrief,
    categoryPreset: input.categoryPreset,
    boundaries: input.boundaries,
    hyperframesTransitionWeight: input.options?.hyperframesTransitionWeight,
    useLlmMatcher: input.options?.useLlmMatcher,
    clientFactory: input.options?.clientFactory,
    model: input.options?.model
  });
}
