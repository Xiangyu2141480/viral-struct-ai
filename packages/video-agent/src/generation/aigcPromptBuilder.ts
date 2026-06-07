import type { AssetGenerationRequest } from './AssetGenerationRequest';

export function buildAigcPrompt(request: AssetGenerationRequest): string {
  return [
    request.positivePrompt,
    `Aspect ratio: ${request.aspectRatio}.`,
    request.durationMs ? `Duration: ${request.durationMs}ms.` : '',
    request.referenceAssetIds.length ? `Reference assets: ${request.referenceAssetIds.join(', ')}.` : '',
    'Do not render readable text, logos, factual claims, prices, rankings, or proof statements in pixels.',
    `Do not include: ${request.forbiddenElements.join(', ')}.`,
    `Negative prompt: ${request.negativePrompt}.`
  ].filter(Boolean).join('\n');
}
