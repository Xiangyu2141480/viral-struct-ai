import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import type { AssetKeyframe } from '@viral-struct/shared';
import { getFrameDir } from '../videoPaths';

export interface KeyframeExtractionOptions {
  filePath: string;
  assetId: string;
  durationSec?: number;
  frameDir?: string;
  ffmpegPath?: string;
  maxFrames?: number;
}

export interface KeyframeExtractionResult {
  keyframes: AssetKeyframe[];
  warnings: string[];
  fallbackUsed: boolean;
}

export async function extractAssetKeyframes(options: KeyframeExtractionOptions): Promise<KeyframeExtractionResult> {
  const warnings: string[] = [];
  const duration = options.durationSec ?? 0;
  const maxFrames = Math.max(1, Math.min(options.maxFrames ?? 5, 5));
  const outputDir = path.resolve(options.frameDir ?? getFrameDir());

  if (!Number.isFinite(duration) || duration <= 0) {
    return {
      keyframes: [],
      warnings: ['keyframe extraction skipped: video duration is unavailable.'],
      fallbackUsed: true
    };
  }

  let ffmpegPath: string;
  try {
    ffmpegPath = resolveFfmpegPath(options.ffmpegPath);
  } catch (error) {
    return {
      keyframes: [],
      warnings: [`keyframe extraction skipped: ${errorMessage(error)}`],
      fallbackUsed: true
    };
  }

  await mkdir(outputDir, { recursive: true });
  const times = Array.from({ length: maxFrames }, (_value, index) =>
    round(Math.min(Math.max(((index + 1) * duration) / (maxFrames + 1), 0), Math.max(duration - 0.1, 0)))
  );
  const keyframes: AssetKeyframe[] = [];

  for (let index = 0; index < times.length; index++) {
    const outputPath = buildKeyframeOutputPath(outputDir, options.assetId, index);
    try {
      await extractFrame(ffmpegPath, options.filePath, outputPath, times[index]);
      keyframes.push({
        id: `${safeAssetStem(options.assetId)}_frame_${index + 1}`,
        timeSec: times[index],
        url: `/media/frames/${path.basename(outputPath)}`,
        description: `Deterministic asset keyframe ${index + 1}`,
        source: 'sampled_frame'
      });
    } catch (error) {
      warnings.push(`keyframe ${index + 1} extraction failed: ${errorMessage(error)}`);
    }
  }

  return {
    keyframes,
    warnings,
    fallbackUsed: keyframes.length === 0 || warnings.length > 0
  };
}

export function buildKeyframeOutputPath(outputDir: string, assetId: string, index: number): string {
  const resolvedDir = path.resolve(outputDir);
  const filename = `${safeAssetStem(assetId)}_frame_${index + 1}.jpg`;
  const outputPath = path.resolve(resolvedDir, filename);
  const relative = path.relative(resolvedDir, outputPath);
  if (path.isAbsolute(relative) || relative.startsWith('..')) {
    throw new Error('Unsafe keyframe output path.');
  }
  return outputPath;
}

function safeAssetStem(input: string): string {
  const parsed = path.parse(input).name;
  const slug = parsed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const hash = createHash('sha1').update(input).digest('hex').slice(0, 8);
  return `${slug || 'asset'}-${hash}`;
}

function resolveFfmpegPath(configured?: string): string {
  const binary = configured?.trim() || process.env.FFMPEG_PATH?.trim() || ffmpegStatic;
  if (!binary) {
    throw new Error('ffmpeg binary was not found.');
  }
  return binary;
}

function extractFrame(ffmpegPath: string, filePath: string, outputPath: string, timeSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      String(timeSec),
      '-i',
      filePath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      outputPath
    ], { windowsHide: true });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
