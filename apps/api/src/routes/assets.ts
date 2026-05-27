import { Router } from 'express';
import multer from 'multer';
import { analyzeAssetsMock } from '../services/assetAnalyzer';
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
  const cards = await analyzeAssetsMock(files, req.body?.textBrief);
  res.json({ assetCards: cards, source: 'upload_analysis' });
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
