import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { TimelineItem } from '@viral-struct/shared';
import {
  compileTimelineToRenderInput,
  FfmpegRenderExecutor,
  type RenderExecutor,
  type RenderProfile,
  type RenderResult
} from '@viral-struct/render-executor';
import { getRenderDir } from './videoPaths';

// ffprobe-static is CommonJS ({ path }); load via createRequire for ESM interop.
const requireCjs = createRequire(import.meta.url);
const ffprobePath: string | undefined = requireCjs('ffprobe-static')?.path;

export interface RenderTimelineOptions {
  timeline: TimelineItem[];
  /** Slots the agent marked resolutionStatus:'unresolved' — rendered as honest substitute segments. */
  unresolvedSlotIds?: string[];
  profile?: RenderProfile;
  /** For tests: inject a non-ffmpeg executor. Defaults to the real FFmpeg renderer. */
  executorFactory?: (outputPath: string) => RenderExecutor;
}

export interface DurationCheck {
  expectedMs: number;
  actualMs: number | null;
  toleranceMs: number;
  ok: boolean;
}

export interface RenderTimelineResult {
  render: RenderResult;
  /** Browser-servable URL (served from /media/renders) when a real file was produced; null for plan-only renders. */
  mediaUrl: string | null;
  /** Verifier: the produced MP4's actual duration vs the expected timeline span. Catches renderer↔timeline drift. */
  durationCheck: DurationCheck | null;
}

/**
 * Layer-boundary glue: turns the agent's TimelineItem[] into a RenderInput and hands it to a render
 * executor. The app orchestrates; render-executor encodes. Renderer choice stays swappable via executorFactory.
 */
export async function renderTimeline(options: RenderTimelineOptions): Promise<RenderTimelineResult> {
  const { timeline, unresolvedSlotIds, profile, executorFactory } = options;
  if (!Array.isArray(timeline) || timeline.length === 0) {
    throw new Error('renderTimeline requires a non-empty TimelineItem[].');
  }

  const renderDir = getRenderDir();
  mkdirSync(renderDir, { recursive: true });
  const outputPath = path.join(renderDir, `render_${nanoid(10)}.mp4`);

  const input = compileTimelineToRenderInput(timeline, { profile, unresolvedSlotIds });

  const executor = executorFactory ? executorFactory(outputPath) : new FfmpegRenderExecutor({ outputPath });
  const render = await executor.render(input);

  const mediaUrl = render.rendered && render.outputPath
    ? `/media/renders/${path.basename(render.outputPath)}`
    : null;

  // Duration verifier: probe the real file and compare to the expected timeline span (render.durationMs).
  // This is the check that would have caught the renderer↔timeline mismatch on the actual encoded file.
  let durationCheck: DurationCheck | null = null;
  if (render.rendered && render.outputPath) {
    const actualMs = await probeDurationMs(render.outputPath);
    const toleranceMs = 750;
    durationCheck = {
      expectedMs: render.durationMs,
      actualMs,
      toleranceMs,
      ok: actualMs !== null && Math.abs(actualMs - render.durationMs) <= toleranceMs
    };
  }

  return { render, mediaUrl, durationCheck };
}

function probeDurationMs(filePath: string): Promise<number | null> {
  if (!ffprobePath) return Promise.resolve(null);
  return new Promise((resolve) => {
    const proc = spawn(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nokey=1:noprint_wrappers=1', filePath],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    let out = '';
    proc.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const seconds = Number.parseFloat(out.trim());
      resolve(Number.isFinite(seconds) ? Math.round(seconds * 1000) : null);
    });
  });
}
