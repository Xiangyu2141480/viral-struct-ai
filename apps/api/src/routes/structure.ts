import { Router } from 'express';
import type { VideoAnalysis } from '@viral-struct/shared';
import { ViralStructureGraphSchema } from '@viral-struct/shared';
import { extractStructureGraph, extractStructureMock } from '../services/structureExtractor';

export const structureRouter = Router();

structureRouter.post('/extract', async (req, res) => {
  try {
    const graph = await extractStructureGraph(req.body?.videoAnalysis as VideoAnalysis | undefined);
    res.json({ structureGraph: ViralStructureGraphSchema.parse(graph) });
  } catch (error) {
    console.warn('Structure extraction failed; returning mock fallback graph.', error);

    try {
      const fallbackGraph = await extractStructureMock();
      res.json({ structureGraph: ViralStructureGraphSchema.parse(fallbackGraph) });
    } catch (fallbackError) {
      res.status(500).json({
        error: 'Structure extraction failed and fallback graph was invalid.',
        detail: errorMessage(fallbackError)
      });
    }
  }
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
