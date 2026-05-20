import { Router } from 'express';
import multer from 'multer';
import { analyzeVideoMock } from '../services/videoAnalyzer';

const upload = multer({ dest: process.env.UPLOAD_DIR ?? './uploads' });
export const videosRouter = Router();

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
  const analysis = await analyzeVideoMock(id, req.body?.manualTranscript);
  res.json(analysis);
});
