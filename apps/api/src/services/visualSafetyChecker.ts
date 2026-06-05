import type { ContentBrief, SafetyStatus } from '@viral-struct/shared';
import { checkBrandSafety } from './brandSafetyChecker';

const blockedPatterns = [/违法/, /暴力血腥/, /仇恨/, /sexual/i];

export function checkVisualPromptSafety(input: {
  positivePrompt: string;
  negativePrompt: string;
  contentBrief?: ContentBrief;
}): SafetyStatus {
  const text = `${input.positivePrompt}\n${input.negativePrompt}\n${input.contentBrief?.productName ?? ''}`;

  const blockedReasons = blockedPatterns
    .filter((pattern) => pattern.test(text))
    .map((pattern) => `Blocked visual-risk pattern: ${pattern.source}`);

  if (blockedReasons.length) {
    return {
      status: 'blocked',
      ipRisk: 'low',
      brandRisk: 'high',
      claimRisk: 'low',
      reasons: blockedReasons
    };
  }

  const safetyStatus = checkBrandSafety({
    prompt: input.positivePrompt,
    packaging: input.negativePrompt
  });

  if (safetyStatus.status !== 'passed') {
    return safetyStatus;
  }

  return {
    status: 'passed',
    ipRisk: 'low',
    brandRisk: 'low',
    claimRisk: 'low',
    reasons: ['Prompt is limited to storyboard planning and avoids source-copying, medical claims, and identity imitation.']
  };
}
