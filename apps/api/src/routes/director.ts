import { Router } from 'express';
import { z } from 'zod';
import {
  AssetCardSchema,
  BoundarySchema,
  ContentBriefSchema,
  ViralStructureGraphSchema
} from '@viral-struct/shared';
import { runDirectorAgent } from '../services/directorAgent';
import { orchestratedToAuthored } from '../services/videoAgent/orchestratedToAuthored';
import { buildDeterministicPreset } from '../services/motifs/categoryPresetProvider';

export const directorRouter = Router();

const OrchestrateRequestSchema = z.object({
  projectId: z.string().optional(),
  structureGraph: ViralStructureGraphSchema,
  assetCards: z.array(AssetCardSchema).default([]),
  contentBrief: ContentBriefSchema,
  boundaries: z.array(BoundarySchema).optional(),
  /** Include the Video Agent handoff (AuthoredTimeline). Default true. Never renders an MP4. */
  includeHandoff: z.boolean().optional(),
  options: z
    .object({
      hyperframesTransitionWeight: z.number().min(0).max(1).optional(),
      useLlmMatcher: z.boolean().optional()
    })
    .optional()
});

/**
 * POST /api/director/orchestrate — run the Director Agent and return its OrchestratedTimeline (and,
 * by default, the Video Agent handoff AuthoredTimeline). PLAN-ONLY: this route never renders an MP4,
 * never calls an external generation model, never produces audio. Its deliverable is a timeline.
 */
directorRouter.post('/orchestrate', async (req, res) => {
  try {
    const body = OrchestrateRequestSchema.parse(req.body ?? {});
    const category = body.contentBrief.category ?? body.contentBrief.productName;
    const categoryPreset = buildDeterministicPreset({
      category,
      availableAssets: body.assetCards.map((card) => card.id)
    });

    const orchestratedTimeline = await runDirectorAgent({
      projectId: body.projectId ?? `director_${Date.now()}`,
      structureGraph: body.structureGraph,
      assetCards: body.assetCards,
      contentBrief: body.contentBrief,
      categoryPreset,
      boundaries: body.boundaries ?? body.structureGraph.boundaries,
      options: {
        hyperframesTransitionWeight: body.options?.hyperframesTransitionWeight,
        useLlmMatcher: body.options?.useLlmMatcher
      }
    });

    const authoredTimeline =
      body.includeHandoff === false
        ? undefined
        : orchestratedToAuthored(orchestratedTimeline, { assetCards: body.assetCards });

    res.json({
      orchestratedTimeline,
      authoredTimeline,
      warnings: orchestratedTimeline.warnings,
      ownership: 'director_agent_plan_only_not_rendered'
    });
  } catch (error) {
    res.status(400).json({
      error: `Director orchestration failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});
