import { Router } from 'express';
import multer from 'multer';
import type { AssetCard } from '@viral-struct/shared';
import { analyzeAssetsWithFallbackResult } from '../services/assetAnalyzer';
import { loadAssetLibrary } from '../services/assetLibraryLoader';
import { getUploadDir } from '../services/videoPaths';

const upload = multer({ dest: getUploadDir() });
export const assetsRouter = Router();

assetsRouter.get('/libraries/:libraryId', async (req, res) => {
  try {
    const assetCards = await loadAssetLibrary(req.params.libraryId);
    res.json({
      assetCards,
      source: 'asset_library',
      libraryId: req.params.libraryId
    });
  } catch (error) {
    res.status(400).json({
      error: `Asset library could not be loaded: ${errorMessage(error)}`
    });
  }
});

assetsRouter.post('/analyze', upload.array('assets'), async (req, res) => {
  const files = (req.files ?? []) as Express.Multer.File[];
  const result = await analyzeAssetsWithFallbackResult({ files, textBrief: req.body?.textBrief });
  res.json({
    assetCards: result.assetCards,
    source: uploadAnalysisSource(result.assetCards),
    vlmStatus: result.vlmStatus,
    warnings: result.warnings
  });
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uploadAnalysisSource(cards: AssetCard[]): 'upload_analysis_llm' | 'upload_analysis_fallback' | 'upload_analysis_manual' | 'upload_analysis_deterministic' {
  if (cards.some((card) => card.analysisSource === 'mock_filename_rules')) {
    return 'upload_analysis_fallback';
  }
  if (cards.some((card) => card.analysisSource === 'llm_multimodal')) {
    return 'upload_analysis_llm';
  }
  if (cards.some((card) => card.analysisSource === 'deterministic')) {
    return 'upload_analysis_deterministic';
  }
  return 'upload_analysis_manual';
}
