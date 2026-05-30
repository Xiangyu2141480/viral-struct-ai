import type { SafetyRiskLevel } from '@viral-struct/shared';

export interface RiskCheckResult {
  risk: SafetyRiskLevel;
  reasons: string[];
}

const copyrightedIpPatterns = [
  /Marvel/i,
  /Star\s*Wars/i,
  /Disney/i,
  /Pixar/i,
  /DC\s*Comics/i,
  /Harry\s*Potter/i,
  /Pokemon|Pokémon/i,
  /漫威/,
  /迪士尼/,
  /星球大战/,
  /哈利波特/,
  /宝可梦/
];

const publicFigurePatterns = [
  /Tom\s*Cruise/i,
  /Taylor\s*Swift/i,
  /Elon\s*Musk/i,
  /成龙/,
  /周杰伦/,
  /公众人物/,
  /明星本人/
];

export function checkIpRisk(text: string): RiskCheckResult {
  const reasons = [
    ...findMatches(text, copyrightedIpPatterns, 'Copyright / character IP reference'),
    ...findMatches(text, publicFigurePatterns, 'Public figure or celebrity likeness reference')
  ];

  return {
    risk: reasons.length ? 'high' : 'low',
    reasons
  };
}

export function isNegatedUse(text: string, matchIndex: number): boolean {
  const prefix = text.slice(Math.max(0, matchIndex - 12), matchIndex).toLowerCase();
  return /不要|避免|禁止|不得|无须|无需|no\s*$|avoid\s*$|without\s*$|do not\s*$/.test(prefix);
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
