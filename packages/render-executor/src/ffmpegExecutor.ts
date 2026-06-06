import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { framesFor } from './manifestExecutor';
import type { RenderExecutor, RenderInput, RenderResult, RenderSegmentManifestEntry } from './RenderContract';

// ffmpeg-static is CommonJS (module.exports = path); load via createRequire to avoid ESM default-interop friction.
const requireCjs = createRequire(import.meta.url);
const ffmpegPath: string | null = requireCjs('ffmpeg-static');

export interface FfmpegRenderOptions {
  outputPath: string;
}

/**
 * Minimal REAL renderer: encodes each timeline segment as a solid-colour clip (colour derived
 * deterministically from the structural role) and concatenates them into one MP4 via ffmpeg-static.
 * This is the L1 walking skeleton proving TimelineItem[] -> RenderInput -> MP4. Richer visuals
 * (cards, burned captions, motion) come from swapping in a HyperFrames executor behind this same
 * RenderExecutor interface — the decision agent and the contract do not change.
 */
export class FfmpegRenderExecutor implements RenderExecutor {
  readonly name = 'ffmpeg';

  constructor(private readonly options: FfmpegRenderOptions) {}

  async render(input: RenderInput): Promise<RenderResult> {
    if (!ffmpegPath) throw new Error('ffmpeg-static binary path not found');
    if (input.segments.length === 0) throw new Error('cannot render an empty timeline');

    const { width, height, fps } = input.profile;
    const args: string[] = [];
    for (const segment of input.segments) {
      const durationSec = Math.max(0.1, (segment.endMs - segment.startMs) / 1000);
      args.push(
        '-f', 'lavfi',
        '-i', `color=c=${toFfmpegColor(segment.background)}:s=${width}x${height}:d=${durationSec.toFixed(3)}:r=${fps}`
      );
    }
    const n = input.segments.length;
    const concat = input.segments.map((_, index) => `[${index}:v]`).join('') + `concat=n=${n}:v=1:a=0[v]`;
    args.push('-filter_complex', concat, '-map', '[v]', '-pix_fmt', 'yuv420p', '-y', this.options.outputPath);

    await runFfmpeg(ffmpegPath, args);

    const manifest: RenderSegmentManifestEntry[] = input.segments.map((segment) => ({
      id: segment.id,
      slotId: segment.slotId,
      startMs: segment.startMs,
      endMs: segment.endMs,
      frames: framesFor(segment.startMs, segment.endMs, fps),
      source: segment.source,
      unresolvedEvidence: segment.unresolvedEvidence,
      label: segment.label
    }));
    const frameCount = manifest.reduce((sum, entry) => sum + entry.frames, 0);
    const contentHash = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16);

    return {
      ok: true,
      rendered: true,
      executor: this.name,
      format: 'mp4',
      outputPath: this.options.outputPath,
      durationMs: input.totalDurationMs,
      frameCount,
      segmentCount: n,
      unresolvedSegmentIds: input.segments.filter((segment) => segment.unresolvedEvidence).map((segment) => segment.id),
      manifest,
      contentHash,
      warnings: []
    };
  }
}

function toFfmpegColor(token: string): string {
  if (token.startsWith('0x')) return token;
  if (/^[0-9a-fA-F]{6}$/.test(token)) return `0x${token}`;
  return token;
}

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-600)}`));
    });
  });
}
