import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import ffprobeStatic from 'ffprobe-static';
import type { AssetMediaProfile } from '@viral-struct/shared';

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    duration?: string;
  };
}

export interface MediaProbeResult {
  media: AssetMediaProfile;
  warnings: string[];
  fallbackUsed: boolean;
}

export interface ProbeOptions {
  ffprobePath?: string;
  originalName?: string;
}

export async function probeImage(filePath: string, options: ProbeOptions = {}): Promise<MediaProbeResult> {
  const warnings: string[] = [];
  const fileStat = await safeStat(filePath);
  const format = formatFromPath(options.originalName ?? filePath);

  let width: number | undefined;
  let height: number | undefined;

  try {
    const buffer = await readFile(filePath);
    const dimensions = readImageDimensions(buffer, format);
    width = dimensions.width;
    height = dimensions.height;
  } catch (error) {
    warnings.push(`Image metadata fallback used: ${errorMessage(error)}`);
  }

  return {
    media: {
      kind: 'image',
      sourceUrl: filePath,
      fileSizeBytes: fileStat?.size,
      format,
      width,
      height,
      aspectRatio: width && height ? classifyAspectRatio(width, height) : 'unknown',
      keyframes: []
    },
    warnings,
    fallbackUsed: warnings.length > 0
  };
}

export async function probeVideo(filePath: string, options: ProbeOptions = {}): Promise<MediaProbeResult> {
  const warnings: string[] = [];
  const fileStat = await safeStat(filePath);
  const format = formatFromPath(options.originalName ?? filePath);

  if (options.ffprobePath?.startsWith('mock:')) {
    const duration = Number(options.ffprobePath.slice('mock:'.length));
    return {
      media: {
        kind: 'video',
        sourceUrl: filePath,
        fileSizeBytes: fileStat?.size,
        format,
        durationSec: round(Number.isFinite(duration) && duration > 0 ? duration : 0),
        fps: 30,
        width: 1080,
        height: 1920,
        aspectRatio: '9:16',
        hasAudio: true,
        keyframes: []
      },
      warnings,
      fallbackUsed: false
    };
  }

  try {
    const { stdout } = await runProcess(resolveFfprobePath(options.ffprobePath), [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      filePath
    ]);
    const output = JSON.parse(stdout) as FfprobeOutput;
    const videoStream = output.streams?.find((stream) => stream.codec_type === 'video');
    const audioStream = output.streams?.find((stream) => stream.codec_type === 'audio');
    if (!videoStream?.width || !videoStream.height) {
      throw new Error('No usable video stream found.');
    }

    const duration = Number(output.format?.duration ?? videoStream.duration ?? 0);
    return {
      media: {
        kind: 'video',
        sourceUrl: filePath,
        fileSizeBytes: fileStat?.size,
        format,
        durationSec: round(Number.isFinite(duration) && duration > 0 ? duration : 0),
        fps: round(parseFrameRate(videoStream.avg_frame_rate || videoStream.r_frame_rate)),
        width: videoStream.width,
        height: videoStream.height,
        aspectRatio: classifyAspectRatio(videoStream.width, videoStream.height),
        hasAudio: Boolean(audioStream),
        keyframes: []
      },
      warnings,
      fallbackUsed: false
    };
  } catch (error) {
    warnings.push(`ffprobe metadata fallback used: ${errorMessage(error)}`);
    return {
      media: {
        kind: 'video',
        sourceUrl: filePath,
        fileSizeBytes: fileStat?.size,
        format,
        durationSec: 0,
        fps: 0,
        aspectRatio: 'unknown',
        hasAudio: false,
        keyframes: []
      },
      warnings,
      fallbackUsed: true
    };
  }
}

export function classifyAspectRatio(width: number, height: number): AssetMediaProfile['aspectRatio'] {
  const ratio = width / height;
  if (Math.abs(ratio - 9 / 16) <= 0.08) return '9:16';
  if (Math.abs(ratio - 16 / 9) <= 0.08) return '16:9';
  if (Math.abs(ratio - 1) <= 0.08) return '1:1';
  return 'unknown';
}

export function parseFrameRate(rate: string | undefined): number {
  if (!rate || rate === '0/0') return 0;
  const [numerator, denominator] = rate.split('/').map(Number);
  if (!denominator) return Number.isFinite(numerator) ? numerator : 0;
  return denominator === 0 ? 0 : numerator / denominator;
}

function readImageDimensions(buffer: Buffer, format: string | undefined): { width?: number; height?: number } {
  if (format === 'png' && buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if ((format === 'jpg' || format === 'jpeg') && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }

  if (format === 'webp' && buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buffer.length >= 30) {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { width, height };
    }
  }

  throw new Error(`Unsupported or unreadable image dimensions for format ${format ?? 'unknown'}.`);
}

function resolveFfprobePath(configured?: string): string {
  const binary = configured?.trim() || process.env.FFPROBE_PATH?.trim() || ffprobeStatic.path;
  if (!binary) {
    throw new Error('ffprobe binary was not found.');
  }
  return binary;
}

async function safeStat(filePath: string): Promise<{ size: number } | null> {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

function formatFromPath(filePath: string): string | undefined {
  return path.extname(filePath).replace('.', '').toLowerCase() || undefined;
}

function runProcess(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || `${command} exited with code ${code}`));
    });
  });
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
