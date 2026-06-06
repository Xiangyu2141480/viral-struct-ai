import { Router } from 'express';
import type { TimelineItem } from '@viral-struct/shared';
import { renderTimeline } from '../services/renderService';

export const renderRouter = Router();

renderRouter.post('/', async (req, res) => {
  const { timeline, unresolvedSlotIds, profile } = req.body ?? {};

  if (!Array.isArray(timeline) || timeline.length === 0) {
    res.status(400).json({ error: 'timeline (non-empty array of TimelineItem) is required.' });
    return;
  }

  try {
    const result = await renderTimeline({
      timeline: timeline as TimelineItem[],
      unresolvedSlotIds: Array.isArray(unresolvedSlotIds) ? unresolvedSlotIds : undefined,
      profile
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: `render failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});
