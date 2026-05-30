import type { SafetyRiskLevel, SafetyStatus } from '@viral-struct/shared';
import { checkClaimRisk } from './claimRiskChecker';
import { checkIpRisk, isNegatedUse, type RiskCheckResult } from './ipRiskChecker';

export interface BrandSafetyInput {
  prompt?: string;
  script?: string;
  packaging?: string;
  shotSpec?: string;
}

const brandRiskPatterns = [
  /复制源视频/,
  /照搬源片/,
  /照搬源视频/,
  /完全复刻/,
  /copy\s+the\s+source/i,
  /replicate\s+the\s+source/i,
  /same\s+as\s+source/i,
  /演员名/,
  /名人肖像/,
  /真实人物身份仿冒/,
  /Tom\s*Cruise/i
];

export function checkBrandSafety(input: BrandSafetyInput): SafetyStatus {
  const text = [
    input.prompt,
    input.script,
    input.packaging,
    input.shotSpec
  ].filter(Boolean).join('\n');

  const ip = checkIpRisk(text);
  const claim = checkClaimRisk(text);
  const brand = checkBrandRisk(text);
  const status = resolveStatus([ip.risk, claim.risk, brand.risk]);
  const reasons = [
    ...ip.reasons,
    ...brand.reasons,
    ...claim.reasons
  ];

  return {
    status,
    ipRisk: ip.risk,
    brandRisk: brand.risk,
    claimRisk: claim.risk,
    reasons: reasons.length
      ? reasons
      : ['No high-risk IP, brand, source-copying, medical, or absolute advertising claim patterns detected.']
  };
}

function checkBrandRisk(text: string): RiskCheckResult {
  const reasons = brandRiskPatterns.flatMap((pattern) => {
    const match = pattern.exec(text);
    if (!match || isNegatedUse(text, match.index)) {
      return [];
    }

    return [`Brand / source-copying risk: ${match[0]}`];
  });

  return {
    risk: reasons.length ? 'high' : 'low',
    reasons
  };
}

function resolveStatus(risks: SafetyRiskLevel[]): SafetyStatus['status'] {
  if (risks.includes('high')) return 'blocked';
  if (risks.includes('medium')) return 'needs_review';
  return 'passed';
}
