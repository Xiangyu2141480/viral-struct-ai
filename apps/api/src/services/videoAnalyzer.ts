import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import type { Keyframe, Shot, TranscriptSegment, VideoAnalysis } from '@viral-struct/shared';
import { getCoverDir, getFrameDir, getSeedVideoDir, getUploadDir } from './videoPaths';

const videoExtensions = new Set(['.mp4', '.mov', '.m4v', '.webm']);

export interface SeedVideoInfo {
  filename: string;
  displayName: string;
  sizeBytes: number;
}

interface AnalyzeVideoFileInput {
  videoId: string;
  filePath: string;
  manualTranscript?: string;
}

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

export async function listSeedVideos(): Promise<SeedVideoInfo[]> {
  const seedDir = getSeedVideoDir();
  const entries = await readdir(seedDir, { withFileTypes: true });
  const videos = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && videoExtensions.has(path.extname(entry.name).toLowerCase()))
      .map(async (entry) => {
        const filePath = path.join(seedDir, entry.name);
        const fileStat = await stat(filePath);
        return {
          filename: entry.name,
          displayName: path.parse(entry.name).name,
          sizeBytes: fileStat.size
        };
      })
  );

  return videos.sort((a, b) => a.filename.localeCompare(b.filename));
}

export async function getSeedVideoPath(filename: string): Promise<string | null> {
  const seedVideos = await listSeedVideos();
  const match = seedVideos.find((video) => video.filename === filename);
  return match ? path.join(getSeedVideoDir(), match.filename) : null;
}

export async function getUploadedVideoPath(videoId: string): Promise<string | null> {
  const uploadDir = getUploadDir();
  const safeName = path.basename(videoId);

  if (safeName !== videoId) {
    return null;
  }

  const filePath = path.resolve(uploadDir, safeName);
  if (!isWithinDir(uploadDir, filePath)) {
    return null;
  }

  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile() ? filePath : null;
  } catch {
    return null;
  }
}

export async function analyzeVideoFile(input: AnalyzeVideoFileInput): Promise<VideoAnalysis> {
  try {
    const metadata = await readVideoMetadata(input.videoId, input.filePath);
    const stem = safeFileStem(input.videoId);
    const keyframes = await extractKeyframes(input.filePath, stem, metadata.duration);
    const cover = await extractCover(input.filePath, stem);
    const transcript = buildTranscript(input.manualTranscript, metadata.duration, false);
    const warnings = input.manualTranscript?.trim()
      ? []
      : ['No ASR provider is configured yet; transcript is empty unless manual transcript is provided.'];

    return {
      metadata,
      shots: buildHeuristicShots(metadata.duration, keyframes, cover),
      keyframes,
      transcript,
      analysisSource: 'real_ffmpeg',
      warnings
    };
  } catch (error) {
    const fallback = await analyzeVideoMock(input.videoId, input.manualTranscript);
    return {
      ...fallback,
      analysisSource: 'mock_fallback',
      warnings: [`Real video analysis failed, using mock fallback: ${errorMessage(error)}`]
    };
  }
}

export async function analyzeVideoMock(
  videoId: string,
  manualTranscript?: string
): Promise<VideoAnalysis> {
  return {
    metadata: {
      videoId,
      duration: 15,
      fps: 30,
      width: 1080,
      height: 1920,
      aspectRatio: '9:16'
    },
    shots: [
      { id: 'shot_1', start: 0, end: 2, description: '快速吸引注意的开头镜头' },
      { id: 'shot_2', start: 2, end: 4, description: '痛点展示' },
      { id: 'shot_3', start: 4, end: 8, description: '商品特写与卖点展示' },
      { id: 'shot_4', start: 8, end: 12, description: '对比或证明' },
      { id: 'shot_5', start: 12, end: 15, description: 'CTA 结尾' }
    ],
    keyframes: [
      { time: 1, url: '/mock/frame_1.jpg', description: '大标题 + 产品推近' },
      { time: 3, url: '/mock/frame_2.jpg', description: '痛点字幕' },
      { time: 6, url: '/mock/frame_3.jpg', description: '卖点卡片' },
      { time: 10, url: '/mock/frame_4.jpg', description: '对比卡片' },
      { time: 14, url: '/mock/frame_5.jpg', description: 'CTA 卡片' }
    ],
    transcript: buildTranscript(manualTranscript, 15, true),
    analysisSource: 'mock_fallback',
    warnings: ['Using mock video analysis fallback.']
  };
}

async function readVideoMetadata(videoId: string, filePath: string): Promise<VideoAnalysis['metadata']> {
  const { stdout } = await runProcess(getFfprobePath(), [
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

  if (!videoStream?.width || !videoStream.height) {
    throw new Error('No video stream with width/height found.');
  }

  const duration = Number(output.format?.duration ?? videoStream.duration ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Unable to determine video duration.');
  }

  return {
    videoId,
    duration: round(duration),
    fps: round(parseFrameRate(videoStream.avg_frame_rate || videoStream.r_frame_rate)),
    width: videoStream.width,
    height: videoStream.height,
    aspectRatio: classifyAspectRatio(videoStream.width, videoStream.height)
  };
}

async function extractCover(filePath: string, stem: string): Promise<Keyframe> {
  const coverDir = getCoverDir();
  await mkdir(coverDir, { recursive: true });

  // Cover = the video's very first frame (time 0), extracted directly from the source.
  const time = 0;
  const filename = `${stem}_cover.jpg`;
  const outputPath = path.join(coverDir, filename);
  await extractFrame(filePath, outputPath, time);

  return {
    time,
    url: `/media/covers/${filename}`,
    description: '真实视频首帧封面'
  };
}

async function extractKeyframes(filePath: string, stem: string, duration: number): Promise<Keyframe[]> {
  const frameDir = getFrameDir();
  await mkdir(frameDir, { recursive: true });

  const count = 5;
  const times = Array.from({ length: count }, (_value, index) =>
    round(Math.min(Math.max(((index + 1) * duration) / (count + 1), 0), Math.max(duration - 0.1, 0)))
  );

  return Promise.all(
    times.map(async (time, index) => {
      const filename = `${stem}_frame_${index + 1}.jpg`;
      const outputPath = path.join(frameDir, filename);
      await extractFrame(filePath, outputPath, time);
      return {
        time,
        url: `/media/frames/${filename}`,
        description: `真实关键帧 ${index + 1}`
      };
    })
  );
}

async function extractFrame(filePath: string, outputPath: string, time: number): Promise<void> {
  await runProcess(getFfmpegPath(), [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(time),
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    outputPath
  ]);
}

function buildHeuristicShots(duration: number, keyframes: Keyframe[], cover: Keyframe): Shot[] {
  const descriptions = [
    'Hook / 开头吸引注意镜头',
    '痛点或问题呈现镜头',
    '商品特写或核心卖点镜头',
    '证明、对比或使用过程镜头',
    'CTA / 结尾行动召唤镜头'
  ];

  return descriptions.map((description, index) => {
    const start = round((duration * index) / descriptions.length);
    const end = round(index === descriptions.length - 1 ? duration : (duration * (index + 1)) / descriptions.length);
    return {
      id: `shot_${index + 1}`,
      start,
      end,
      keyframeUrl: keyframes[index]?.url ?? cover.url,
      description
    };
  });
}

function buildTranscript(
  manualTranscript: string | undefined,
  duration: number,
  useDefaultFallback: boolean
): TranscriptSegment[] {
  const manualSegments = splitManualTranscript(manualTranscript);

  if (manualSegments.length) {
    return manualSegments.map((text, index) => ({
      start: round((duration * index) / manualSegments.length),
      end: round(index === manualSegments.length - 1 ? duration : (duration * (index + 1)) / manualSegments.length),
      text
    }));
  }

  if (!useDefaultFallback) {
    return [];
  }

  return [
    { start: 0, end: 2, text: '你还在这样选杯子吗？' },
    { start: 2, end: 4, text: '普通杯不保温还容易漏。' },
    { start: 4, end: 8, text: '这款便携咖啡杯保温八小时。' },
    { start: 8, end: 12, text: '单手开盖，倒置不漏。' },
    { start: 12, end: 15, text: '通勤党放心带。' }
  ];
}

function splitManualTranscript(value: string | undefined): string[] {
  const text = typeof value === 'string' ? value.trim() : '';

  if (!text) {
    return [];
  }

  const sentenceSegments = text
    .replace(/([。！？!?；;])/g, '$1\n')
    .split(/\s*\n\s*/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return sentenceSegments.length ? sentenceSegments : [text];
}

function parseFrameRate(rate: string | undefined): number {
  if (!rate || rate === '0/0') {
    return 0;
  }

  const [numerator, denominator] = rate.split('/').map(Number);
  if (!denominator) {
    return Number.isFinite(numerator) ? numerator : 0;
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

function classifyAspectRatio(width: number, height: number): VideoAnalysis['metadata']['aspectRatio'] {
  const ratio = width / height;

  if (isNear(ratio, 9 / 16)) {
    return '9:16';
  }

  if (isNear(ratio, 16 / 9)) {
    return '16:9';
  }

  if (isNear(ratio, 1)) {
    return '1:1';
  }

  return 'unknown';
}

function isNear(value: number, target: number): boolean {
  return Math.abs(value - target) <= 0.08;
}

function safeFileStem(input: string): string {
  const parsed = path.parse(input).name;
  const slug = parsed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const hash = createHash('sha1').update(input).digest('hex').slice(0, 8);
  return `${slug || 'video'}-${hash}`;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function getFfmpegPath(): string {
  const configured = process.env.FFMPEG_PATH?.trim();
  const binary = configured || ffmpegStatic;

  if (!binary) {
    throw new Error('ffmpeg binary was not found.');
  }

  return binary;
}

function getFfprobePath(): string {
  const configured = process.env.FFPROBE_PATH?.trim();
  const binary = configured || ffprobeStatic.path;

  if (!binary) {
    throw new Error('ffprobe binary was not found.');
  }

  return binary;
}

function runProcess(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${path.basename(command)} exited with code ${code}: ${stderr.slice(0, 800)}`));
    });
  });
}

function isWithinDir(parentDir: string, childPath: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(childPath));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
