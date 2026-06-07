import type { MotionToken } from '@viral-struct/shared';

export const SOURCE_SPECIFIC_TERMS = [
  'keyboard',
  'laptop',
  'touchpad',
  'rocket',
  'hardware',
  'macbook',
  'apple',
  '键盘',
  '笔记本',
  '触控板',
  '火箭',
  '硬件功能'
];

export interface MotionGrammarSanitizerResult {
  sanitizedIntent: string;
  motionTokens: MotionToken[];
  bannedSourceTerms: string[];
  evidence: string[];
}

type TokenRule = {
  token: MotionToken;
  canonicalPhrase: string;
  patterns: RegExp[];
};

const TOKEN_RULES: TokenRule[] = [
  {
    token: 'component_cascade',
    canonicalPhrase: 'component cascade',
    patterns: [/fragment/i, /pieces?/i, /cascade/i, /碎片/, /飞舞/, /飞散/]
  },
  {
    token: 'chaos_to_order',
    canonicalPhrase: 'chaos to order',
    patterns: [/chaos/i, /order/i, /scatter/i, /落到/, /归位/, /从混乱到有序/]
  },
  {
    token: 'assembly_completion',
    canonicalPhrase: 'dynamic assembly',
    patterns: [/assembl/i, /complete/i, /组装/, /自动组装/, /完成/]
  },
  {
    token: 'interaction_activation',
    canonicalPhrase: 'interaction activation',
    patterns: [/touchpad/i, /press/i, /button/i, /control/i, /按/, /控制/, /触控板/, /圆形按键/]
  },
  {
    token: 'spectacle_burst',
    canonicalPhrase: 'spectacle burst',
    patterns: [/rocket/i, /burst/i, /explode/i, /confetti/i, /火箭/, /炸开/, /彩屑/]
  },
  {
    token: 'cta_reveal',
    canonicalPhrase: 'CTA reveal',
    patterns: [/purchase/i, /window/i, /cta/i, /购买/, /购买窗口/, /弹出/]
  }
];

export function sanitizeMotionGrammarText(text: string): MotionGrammarSanitizerResult {
  const normalized = text.toLowerCase();
  const motionTokens = TOKEN_RULES
    .filter((rule) => rule.patterns.some((pattern) => pattern.test(text) || pattern.test(normalized)))
    .map((rule) => rule.token);

  const canonicalPhrases = TOKEN_RULES
    .filter((rule) => motionTokens.includes(rule.token))
    .map((rule) => rule.canonicalPhrase);

  const sanitizedIntent = canonicalPhrases.length > 0
    ? `Transfer ${joinHumanReadable(canonicalPhrases)} into category-native motion grammar.`
    : 'Use the original role template; no transferable viral motion grammar was detected.';

  const evidence = TOKEN_RULES
    .filter((rule) => motionTokens.includes(rule.token))
    .map((rule) => `Detected ${rule.token} from rule-based source text scan.`);

  return {
    sanitizedIntent,
    motionTokens: unique(motionTokens),
    bannedSourceTerms: SOURCE_SPECIFIC_TERMS,
    evidence
  };
}

export function containsSourceSpecificTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return SOURCE_SPECIFIC_TERMS.some((term) => lower.includes(term.toLowerCase()));
}

function joinHumanReadable(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? '';
  }

  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
