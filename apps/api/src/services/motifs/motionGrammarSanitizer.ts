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
  },
  // --- extended vocabulary (Phase 2): the remaining MotionTokens the enum
  // declares. Each rule is a deterministic EN+中文 keyword group. Adding a new
  // token rule here is the supported "new entry" extension point — no change
  // needed elsewhere. Keep patterns specific enough to avoid false fires.
  {
    token: 'dynamic_entry',
    canonicalPhrase: 'dynamic entry',
    patterns: [/enters? the frame/i, /\bentry\b/i, /flies? in/i, /入画/, /登场/, /进入画面/, /飞入/]
  },
  {
    token: 'falling_object',
    canonicalPhrase: 'falling object',
    patterns: [/fall(s|ing)?\b/i, /drop(s|ping)?\b/i, /from above/i, /坠落/, /落下/, /掉落/, /从上方/]
  },
  {
    token: 'impact_beat',
    canonicalPhrase: 'impact beat',
    patterns: [/impact/i, /\bland(s|ing)?\b/i, /on the beat/i, /撞击/, /砸/, /卡点/, /落地/]
  },
  {
    token: 'snap_open',
    canonicalPhrase: 'snap open',
    patterns: [/snap open/i, /pops? open/i, /unfold/i, /cap open/i, /开盖/, /展开/, /弹开/, /掀开/]
  },
  {
    token: 'assembly_reveal',
    canonicalPhrase: 'assembly reveal',
    patterns: [/snap together/i, /form into/i, /assemble into/i, /拼合/, /拼接/, /组合成/, /成形/, /合体/]
  },
  {
    token: 'activation_moment',
    canonicalPhrase: 'activation moment',
    patterns: [/activat/i, /lights? up/i, /turns? on/i, /powers? on/i, /点亮/, /激活/, /启动/, /亮起/]
  },
  {
    token: 'pour_flow',
    canonicalPhrase: 'pour flow',
    patterns: [/pour/i, /\bflow(s|ing)?\b/i, /倒入/, /倾倒/, /注入/, /流出/, /流入/]
  },
  {
    token: 'drink_action',
    canonicalPhrase: 'drink action',
    patterns: [/drink/i, /\bsip\b/i, /喝/, /饮(用|一口)/, /品尝/, /一口/]
  },
  {
    token: 'bottle_rotation',
    canonicalPhrase: 'bottle rotation',
    patterns: [/rotat/i, /\bspin/i, /turns? around/i, /旋转/, /转动/, /翻转/, /环绕/]
  },
  {
    token: 'lineup_sweep',
    canonicalPhrase: 'lineup sweep',
    patterns: [/line[- ]?up/i, /\bsweep/i, /pack shot/i, /排列/, /横移/, /扫过/, /一字排开/, /阵列/]
  },
  {
    token: 'card_drop',
    canonicalPhrase: 'card drop',
    patterns: [/caption card/i, /benefit card/i, /\bcard drop/i, /卡片/, /字幕卡/, /信息卡/, /卖点卡/]
  },
  {
    token: 'clean_hold',
    canonicalPhrase: 'clean hold',
    patterns: [/clean (end )?frame/i, /lock ?-?up/i, /\bhold\b/i, /静帧/, /定格/, /尾帧/, /收尾/, /锁定/]
  },
  {
    token: 'quick_cut',
    canonicalPhrase: 'quick cut',
    patterns: [/quick cut/i, /rapid cut/i, /fast cut/i, /快切/, /快速剪辑/, /连切/]
  },
  {
    token: 'push_in',
    canonicalPhrase: 'push in',
    patterns: [/push[- ]?in/i, /zoom[- ]?in/i, /dolly in/i, /推近/, /推进/, /拉近/]
  },
  {
    token: 'match_cut',
    canonicalPhrase: 'match cut',
    patterns: [/match[- ]?cut/i, /匹配剪辑/, /无缝转场/, /衔接转场/]
  },
  {
    token: 'morph',
    canonicalPhrase: 'morph',
    patterns: [/morph/i, /transform/i, /变形/, /形变/, /渐变/, /变成/]
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
