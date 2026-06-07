import { Router } from 'express';
import { checkBrandSafety } from '../services/brandSafetyChecker';

export const safetyRouter = Router();

safetyRouter.post('/check', (req, res) => {
  const body = req.body as {
    prompt?: unknown;
    script?: unknown;
    packaging?: unknown;
    shotSpec?: unknown;
    job?: {
      positivePrompt?: unknown;
      negativePrompt?: unknown;
      shotSpec?: unknown;
    };
  };

  const safetyStatus = checkBrandSafety({
    prompt: [
      asText(body.prompt),
      asText(body.job?.positivePrompt),
      asText(body.job?.negativePrompt)
    ].filter(Boolean).join('\n'),
    script: asText(body.script),
    packaging: asText(body.packaging),
    shotSpec: [
      asText(body.shotSpec),
      asText(body.job?.shotSpec)
    ].filter(Boolean).join('\n')
  });

  res.json({
    safetyStatus,
    disclaimer: 'Deterministic demo guardrail only. This is not legal advice and does not call an external brand safety service.'
  });
});

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
