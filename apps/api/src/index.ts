import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { videosRouter } from './routes/videos';
import { structureRouter } from './routes/structure';
import { assetsRouter } from './routes/assets';
import { slotsRouter } from './routes/slots';
import { gapsRouter } from './routes/gaps';
import { timelineRouter } from './routes/timeline';
import { qualityRouter } from './routes/quality';

const app = express();
const port = Number(process.env.API_PORT ?? 4000);

app.use(cors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000' }));
app.use(express.json({ limit: '10mb' }));

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

app.listen(port, () => {
  console.log(`ViralStruct API listening on http://localhost:${port}`);
});
