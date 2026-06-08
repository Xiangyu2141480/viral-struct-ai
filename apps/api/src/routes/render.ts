import { Router } from 'express';
import type { TimelineItem } from '@viral-struct/shared';
import type { RenderProfile } from '@viral-struct/render-executor';
import { renderTimeline } from '../services/renderService';

export const renderRouter = Router();

export const RENDER_REQUEST_LIMITS = {
  maxTimelineItems: 100,
  maxDurationSec: 60,
  maxWidth: 1920,
  maxHeight: 1920,
  maxPixels: 1080 * 1920,
  maxFps: 30
} as const;

type RenderValidationResult =
  | {
    ok: true;
    timeline: TimelineItem[];
    unresolvedSlotIds?: string[];
    profile?: RenderProfile;
  }
  | {
    ok: false;
    error: string;
  };

renderRouter.post('/', async (req, res) => {
  const validation = validateRenderRequestBody(req.body ?? {});
  if (!validation.ok) {
    res.status(400).json({
      error: validation.error,
      limits: RENDER_REQUEST_LIMITS
    });
    return;
  }

  try {
    const result = await renderTimeline({
      timeline: validation.timeline,
      unresolvedSlotIds: validation.unresolvedSlotIds,
      profile: validation.profile
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: `render failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

export function validateRenderRequestBody(body: unknown): RenderValidationResult {
  if (!isRecord(body)) {
    return { ok: false, error: 'render request body must be an object.' };
  }

  const timeline = body.timeline;
  if (!Array.isArray(timeline) || timeline.length === 0) {
    return { ok: false, error: 'timeline (non-empty array of TimelineItem) is required.' };
  }
  if (timeline.length > RENDER_REQUEST_LIMITS.maxTimelineItems) {
    return {
      ok: false,
      error: `timeline exceeds the route render cap of ${RENDER_REQUEST_LIMITS.maxTimelineItems} items.`
    };
  }

  const timelineCheck = validateTimelineBounds(timeline);
  if (!timelineCheck.ok) return timelineCheck;

  const profileCheck = validateRenderProfile(body.profile);
  if (!profileCheck.ok) return profileCheck;

  const unresolvedSlotIds = Array.isArray(body.unresolvedSlotIds)
    ? body.unresolvedSlotIds.filter((slotId): slotId is string => typeof slotId === 'string').slice(0, RENDER_REQUEST_LIMITS.maxTimelineItems)
    : undefined;

  return {
    ok: true,
    timeline: timeline as TimelineItem[],
    unresolvedSlotIds,
    profile: profileCheck.profile
  };
}

function validateTimelineBounds(timeline: unknown[]): RenderValidationResult {
  let maxEnd = 0;
  for (const [index, rawItem] of timeline.entries()) {
    if (!isRecord(rawItem)) {
      return { ok: false, error: `timeline item ${index} must be an object.` };
    }
    const start = Number(rawItem.start);
    const end = Number(rawItem.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      return { ok: false, error: `timeline item ${index} must have finite non-negative start and end > start.` };
    }
    maxEnd = Math.max(maxEnd, end);
  }

  if (maxEnd > RENDER_REQUEST_LIMITS.maxDurationSec) {
    return {
      ok: false,
      error: `timeline duration exceeds the route render cap of ${RENDER_REQUEST_LIMITS.maxDurationSec}s.`
    };
  }

  return { ok: true, timeline: timeline as TimelineItem[] };
}

function validateRenderProfile(profile: unknown): { ok: true; profile?: RenderProfile } | { ok: false; error: string } {
  if (profile === undefined || profile === null) {
    return { ok: true };
  }
  if (!isRecord(profile)) {
    return { ok: false, error: 'profile must be an object when provided.' };
  }

  const width = Number(profile.width);
  const height = Number(profile.height);
  const fps = Number(profile.fps);
  const format = profile.format ?? 'mp4';

  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, error: 'profile width and height must be positive integers.' };
  }
  if (width > RENDER_REQUEST_LIMITS.maxWidth || height > RENDER_REQUEST_LIMITS.maxHeight || width * height > RENDER_REQUEST_LIMITS.maxPixels) {
    return {
      ok: false,
      error: `profile exceeds render limits: max ${RENDER_REQUEST_LIMITS.maxWidth}x${RENDER_REQUEST_LIMITS.maxHeight}, max ${RENDER_REQUEST_LIMITS.maxPixels} pixels.`
    };
  }
  if (!Number.isInteger(fps) || fps <= 0 || fps > RENDER_REQUEST_LIMITS.maxFps) {
    return { ok: false, error: `profile fps must be a positive integer <= ${RENDER_REQUEST_LIMITS.maxFps}.` };
  }
  if (format !== 'mp4') {
    return { ok: false, error: 'profile format must be mp4.' };
  }

  return {
    ok: true,
    profile: {
      width,
      height,
      fps,
      format: 'mp4'
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
