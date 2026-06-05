import type { SafetyRiskLevel } from '@viral-struct/shared';
import { isNegatedUse, type RiskCheckResult } from './ipRiskChecker';

const highClaimPatterns = [
  /保证治愈/,
  /治愈/,
  /疗效/,
  /药效/,
  /治疗/,
  /医疗功效/,
  /降血糖/,
  /cure/i,
  /medical\s+effect/i,
  /guaranteed/i
];

const absoluteClaimPatterns = [
  /100%/,
  /保证/,
  /最好/,
  /最强/,
  /第一/,
  /No\.?\s*1/i,
  /best/i
];

export function checkClaimRisk(text: string): RiskCheckResult {
  const highReasons = [
    ...findMatches(text, highClaimPatterns, 'Medical or guaranteed claim risk'),
    ...findMatches(text, absoluteClaimPatterns, 'Absolute advertising claim risk')
  ];

  const risk: SafetyRiskLevel = highReasons.length ? 'high' : 'low';

  return {
    risk,
    reasons: highReasons
  };
}

function findMatches(text: string, patterns: RegExp[], label: string): string[] {
  return patterns.flatMap((pattern) => {
    const match = pattern.exec(text);
    if (!match || isNegatedUse(text, match.index)) {
      return [];
    }

    return [`${label}: ${match[0]}`];
  });
}
