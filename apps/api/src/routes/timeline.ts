import { Router } from 'express';
import type { TimelineItem } from '@viral-struct/shared';
import { generateTimelineMock } from '../services/timelineGenerator';
import { applyNaturalLanguageEditWithFallback } from '../services/timelineEditor';

export const timelineRouter = Router();

timelineRouter.post('/generate', async (req, res) => {
  const result = await generateTimelineMock(req.body);
  res.json(result);
});

timelineRouter.post('/apply-edit', async (req, res) => {
  const { instruction, timeline, contentBrief } = req.body ?? {};

  if (typeof instruction !== 'string' || !instruction.trim()) {
    res.status(400).json({ error: 'instruction (non-empty string) is required.' });
    return;
  }
  if (!Array.isArray(timeline)) {
    res.status(400).json({ error: 'timeline (array of TimelineItem) is required.' });
    return;
  }

  try {
    const result = await applyNaturalLanguageEditWithFallback({
      instruction,
      timeline: timeline as TimelineItem[],
      contentBrief
    });
    res.json({
      updatedTimeline: result.timeline,
      patches: result.patches,
      operations: result.operations,
      editSource: result.editSource,
      warning: result.warning
    });
  } catch (error) {
    res.status(500).json({
      error: `apply-edit failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});
