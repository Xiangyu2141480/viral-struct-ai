import { mkdirSync } from 'node:fs';
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

export interface RenderTimelineOptions {
  timeline: TimelineItem[];
  /** Slots the agent marked resolutionStatus:'unresolved' — rendered as honest substitute segments. */
  unresolvedSlotIds?: string[];
  profile?: RenderProfile;
  /** For tests: inject a non-ffmpeg executor. Defaults to the real FFmpeg renderer. */
  executorFactory?: (outputPath: string) => RenderExecutor;
}

export interface RenderTimelineResult {
  render: RenderResult;
  /** Browser-servable URL (served from /media/renders) when a real file was produced; null for plan-only renders. */
  mediaUrl: string | null;
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

  return { render, mediaUrl };
}
