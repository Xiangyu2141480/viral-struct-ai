import { Router } from 'express';
import { ViralStructureGraphSchema } from '@viral-struct/shared';
import { extractStructureGraphWithDebug, extractStructureMock } from '../services/structureExtractor';

export const structureRouter = Router();

structureRouter.post('/extract', async (req, res) => {
  try {
    const result = await extractStructureGraphWithDebug(req.body?.videoAnalysis);
    res.json({
      structureGraph: ViralStructureGraphSchema.parse(result.structureGraph),
      debug: result.debug
    });
  } catch (error) {
    console.warn('Structure extraction failed; returning mock fallback graph.', error);

    try {
      const fallbackGraph = await extractStructureMock();
      const parsedFallback = ViralStructureGraphSchema.parse(fallbackGraph);
      res.json({
        structureGraph: parsedFallback,
        debug: {
          fallbackUsed: true,
          segmentCount: parsedFallback.segments.length,
          evidenceCount: parsedFallback.creativeIngredients.reduce((total, ingredient) => total + ingredient.evidence.length, 0),
          warnings: [`Structure extraction route failed: ${errorMessage(error)}`]
        }
      });
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
