import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import cors from 'cors';
import express from 'express';
import { videosRouter } from './routes/videos';
import { structureRouter } from './routes/structure';
import { assetsRouter } from './routes/assets';
import { slotsRouter } from './routes/slots';
import { gapsRouter } from './routes/gaps';
import { timelineRouter } from './routes/timeline';
import { qualityRouter } from './routes/quality';
import { demoRouter } from './routes/demo';
import { renderRouter } from './routes/render';
import { getCoverDir, getDemoAssetDir, getFrameDir, getRenderDir, getUploadDir } from './services/videoPaths';

const app = express();
const port = Number(process.env.API_PORT ?? 4000);
const uploadDir = getUploadDir();
const frameDir = getFrameDir();
const coverDir = getCoverDir();
const demoAssetDir = getDemoAssetDir();
const renderDir = getRenderDir();
const allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000,http://localhost:3001')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

mkdirSync(uploadDir, { recursive: true });
mkdirSync(frameDir, { recursive: true });
mkdirSync(coverDir, { recursive: true });
mkdirSync(demoAssetDir, { recursive: true });
mkdirSync(renderDir, { recursive: true });

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS`));
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use('/media/frames', express.static(frameDir));
app.use('/media/covers', express.static(coverDir));
app.use('/media/demo-assets', express.static(demoAssetDir));
app.use('/media/renders', express.static(renderDir));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'viral-struct-api' });
});

app.use('/api/videos', videosRouter);
app.use('/api/structure', structureRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/slots', slotsRouter);
app.use('/api/gaps', gapsRouter);
app.use('/api/timeline', timelineRouter);
app.use('/api/quality', qualityRouter);
app.use('/api/demo', demoRouter);
app.use('/api/render', renderRouter);

app.listen(port, () => {
  console.log(`ViralStruct API listening on http://localhost:${port}`);
});
