import { Router } from 'express';
import multer from 'multer';
import {
  analyzeVideoFile,
  getSeedVideoPath,
  getUploadedVideoPath,
  listSeedVideos
} from '../services/videoAnalyzer';
import { getUploadDir } from '../services/videoPaths';

const upload = multer({ dest: getUploadDir() });
export const videosRouter = Router();

videosRouter.get('/seeds', async (_req, res) => {
  try {
    const videos = await listSeedVideos();
    res.json({ videos });
  } catch (error) {
    res.status(500).json({ error: errorMessage(error) });
  }
});

videosRouter.post('/seeds/analyze', async (req, res) => {
  const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
  const manualTranscript = typeof req.body?.manualTranscript === 'string' ? req.body.manualTranscript : undefined;

  if (!filename) {
    res.status(400).json({ error: 'filename is required' });
    return;
  }

  const filePath = await getSeedVideoPath(filename);
  if (!filePath) {
    res.status(400).json({ error: 'seed video is not allowed or does not exist' });
    return;
  }

  const analysis = await analyzeVideoFile({
    videoId: filename,
    filePath,
    manualTranscript
  });
  res.json(analysis);
});

videosRouter.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'video file is required' });
    return;
  }

  res.json({
    videoId: req.file.filename,
    originalName: req.file.originalname,
    path: req.file.path
  });
});

videosRouter.post('/:id/analyze', async (req, res) => {
  const { id } = req.params;
  const filePath = await getUploadedVideoPath(id);

  if (!filePath) {
    res.status(404).json({ error: 'uploaded video was not found' });
    return;
  }

  const manualTranscript = typeof req.body?.manualTranscript === 'string' ? req.body.manualTranscript : undefined;
  const analysis = await analyzeVideoFile({ videoId: id, filePath, manualTranscript });
  res.json(analysis);
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
