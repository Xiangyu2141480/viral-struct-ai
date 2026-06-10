import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AssetCardSchema } from '@viral-struct/shared';
import { analyzeAssetsDeterministic } from './assetManager/deterministicAssetAnalyzer';
import { buildKeyframeOutputPath } from './assetManager/keyframeExtractor';

// 1x1 transparent PNG.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

test('analyzeAssetsDeterministic builds an image AssetAnalysisProfile without external services', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'det-asset-image-'));
  const imagePath = path.join(dir, 'kangshifu-product-shot.png');
  await writeFile(imagePath, TINY_PNG);

  try {
    const cards = await analyzeAssetsDeterministic({
      files: [{ originalname: 'kangshifu-product-shot.png', path: imagePath, size: TINY_PNG.length } as Express.Multer.File]
    });

    assert.equal(cards.length, 1);
    const card = AssetCardSchema.parse(cards[0]);
    assert.equal(card.type, 'image');
    assert.equal(card.analysisSource, 'deterministic');
    assert.equal(card.analysis?.source, 'deterministic');
    assert.equal(card.analysis?.media.width, 1);
    assert.equal(card.analysis?.media.height, 1);
    assert.equal(card.analysis?.media.format, 'png');
    assert.equal(card.analysis?.media.fileSizeBytes, TINY_PNG.length);
    assert.equal(card.analysis?.quality.resolution, 0.1);
    assert.ok(typeof card.analysis?.quality.sharpness === 'number');
    assert.ok(card.analysis?.warnings.length);
    assert.ok(card.suitableSlots.includes('product_closeup'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('analyzeAssetsDeterministic classifies text brief roles for CTA and selling points', async () => {
  const cards = await analyzeAssetsDeterministic({
    files: [],
    textBrief: '标题：夏天就要冰爽解腻。卖点：柠檬茶香，大瓶畅饮。立即下单，今天就来一瓶。'
  });

  assert.equal(cards.length, 1);
  const card = AssetCardSchema.parse(cards[0]);
  assert.equal(card.type, 'text');
  assert.equal(card.analysis?.media.textLength, card.text?.length);
  assert.ok(card.suitableSlots.includes('benefit_visual'));
  assert.ok(card.suitableSlots.includes('cta_visual'));
  assert.ok(card.analysis?.semantic.detectedObjects.includes('cta_copy'));
  assert.ok(card.analysis?.semantic.detectedObjects.includes('selling_point_copy'));
  assert.equal(card.analysis?.fallbackUsed, false);
});

test('analyzeAssetsDeterministic returns a controlled video fallback when ffprobe is unavailable', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'det-asset-video-'));
  const videoPath = path.join(dir, 'usage-demo.mp4');
  await writeFile(videoPath, Buffer.from('not a real mp4'));

  try {
    const cards = await analyzeAssetsDeterministic({
      files: [{ originalname: 'usage-demo.mp4', path: videoPath, size: 14 } as Express.Multer.File],
      ffprobePath: path.join(dir, 'missing-ffprobe.exe'),
      ffmpegPath: path.join(dir, 'missing-ffmpeg.exe'),
      frameDir: path.join(dir, 'frames')
    });

    assert.equal(cards.length, 1);
    const card = AssetCardSchema.parse(cards[0]);
    assert.equal(card.type, 'video');
    assert.equal(card.analysisSource, 'deterministic');
    assert.equal(card.analysis?.fallbackUsed, true);
    assert.equal(card.analysis?.media.keyframes.length, 0);
    assert.ok(card.analysis?.warnings.some((warning) => warning.includes('ffprobe')));
    assert.ok(card.analysis?.warnings.some((warning) => warning.includes('keyframe')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('analyzeAssetsDeterministic expands a long video into segment AssetCards', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'det-asset-long-video-'));
  const videoPath = path.join(dir, 'kangshifu-open-cap-pour-clean-cta.mp4');
  await writeFile(videoPath, Buffer.from('fake mp4 metadata comes from injected probe'));

  try {
    const cards = await analyzeAssetsDeterministic({
      files: [{ originalname: 'kangshifu-open-cap-pour-clean-cta.mp4', path: videoPath, size: 32 } as Express.Multer.File],
      ffprobePath: 'mock:26.2',
      ffmpegPath: path.join(dir, 'missing-ffmpeg.exe'),
      frameDir: path.join(dir, 'frames'),
      visualSegmentation: {
        durationSec: 26.2,
        shouldSlice: true,
        hardCutCount: 3,
        motionChangeCount: 1,
        visualPeakCount: 0,
        boundaryConfidence: 0.84,
        boundaryCandidates: [
          { timeSec: 4.1, source: 'hard_cut', confidence: 0.92, score: 0.9, reason: 'opening to closeup' },
          { timeSec: 9.8, source: 'motion_regime', confidence: 0.8, score: 0.78, reason: 'closeup to usage' },
          { timeSec: 15.7, source: 'hard_cut', confidence: 0.86, score: 0.82, reason: 'usage to benefit' },
          { timeSec: 21.2, source: 'hard_cut', confidence: 0.83, score: 0.79, reason: 'benefit to cta' }
        ],
        warnings: []
      }
    });

    assert.equal(cards.length, 5);
    assert.ok(cards.every((card) => card.type === 'video'));
    assert.ok(cards.every((card) => card.url === videoPath));
    assert.ok(cards.every((card) => card.segmentSource?.parentAssetId === 'asset_001'));
    assert.equal(cards[0].segmentSource?.startSec, 0);
    assert.equal(cards.at(-1)?.segmentSource?.endSec, 26.2);
    assert.ok(cards.some((card) => card.suitableSlots.includes('usage_demo')));
    assert.ok(cards.some((card) => card.suitableSlots.includes('cta_visual')));
    assert.ok(cards.some((card) => card.segmentSource?.actionTags.includes('pour_to_cup')));
    assert.equal(cards[1].segmentSource?.boundaryEvidence?.source, 'hard_cut');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('analyzeAssetsDeterministic keeps short videos as a single segment card', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'det-asset-short-video-'));
  const videoPath = path.join(dir, 'short-product-closeup.mp4');
  await writeFile(videoPath, Buffer.from('fake mp4 metadata comes from injected probe'));

  try {
    const cards = await analyzeAssetsDeterministic({
      files: [{ originalname: 'short-product-closeup.mp4', path: videoPath, size: 32 } as Express.Multer.File],
      ffprobePath: 'mock:5.2',
      ffmpegPath: path.join(dir, 'missing-ffmpeg.exe'),
      frameDir: path.join(dir, 'frames')
    });

    assert.equal(cards.length, 1);
    assert.equal(cards[0].id, 'asset_001_seg_001');
    assert.equal(cards[0].segmentSource?.parentAssetId, 'asset_001');
    assert.equal(cards[0].segmentSource?.startSec, 0);
    assert.equal(cards[0].segmentSource?.endSec, 5.2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('analyzeAssetsDeterministic does not over-infer roles for plain product or hand assets', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'det-asset-roles-'));
  const productPath = path.join(dir, 'table-product-pan.png');
  const handVideoPath = path.join(dir, 'product-hand-pickup.mp4');
  await writeFile(productPath, TINY_PNG);
  await writeFile(handVideoPath, Buffer.from('not a real mp4'));

  try {
    const [productCard, handCard] = await analyzeAssetsDeterministic({
      files: [
        { originalname: 'table-product-pan.png', path: productPath, size: TINY_PNG.length } as Express.Multer.File,
        { originalname: 'product-hand-pickup.mp4', path: handVideoPath, size: 14 } as Express.Multer.File
      ],
      ffprobePath: path.join(dir, 'missing-ffprobe.exe'),
      ffmpegPath: path.join(dir, 'missing-ffmpeg.exe'),
      frameDir: path.join(dir, 'frames')
    });

    assert.ok(productCard.suitableSlots.includes('product_closeup'));
    assert.ok(productCard.suitableSlots.includes('cta_visual'));
    assert.equal(productCard.suitableSlots.includes('usage_demo'), false);
    assert.equal(productCard.suitableSlots.includes('comparison'), false);

    assert.ok(handCard.suitableSlots.includes('usage_demo'));
    assert.ok(handCard.suitableSlots.includes('product_closeup'));
    assert.equal(handCard.suitableSlots.includes('cta_visual'), false);
    assert.equal(handCard.suitableSlots.includes('comparison'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('buildKeyframeOutputPath keeps generated frame paths inside the configured directory', () => {
  const outputDir = path.join(tmpdir(), 'safe-frames');
  const outputPath = buildKeyframeOutputPath(outputDir, '../unsafe asset.mp4', 0);
  const relative = path.relative(outputDir, outputPath);

  assert.equal(path.isAbsolute(relative), false);
  assert.equal(relative.startsWith('..'), false);
  assert.equal(path.basename(outputPath).includes('..'), false);
  assert.match(path.basename(outputPath), /^unsafe-asset-[a-f0-9]{8}_frame_1\.jpg$/);
});
