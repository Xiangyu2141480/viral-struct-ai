import type {
  AssetCard,
  ClaimBoundary,
  ContentBrief,
  ProductComplexity,
  ProductFact,
  ProductIntelligence,
  ProofRegime,
  ProofType,
  TargetDurationMode
} from '@viral-struct/shared';
import { ProductIntelligenceSchema } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from '../llmProvider';

/**
 * Product Intelligence analyzer (P0-A).
 *
 * Turns the (authoritative) user text brief — corroborated by already-analyzed asset cards and
 * the LLM's world knowledge — into a structured, evidence-bearing understanding of the TARGET
 * product. Two paths: an LLM path (free text → full structure) and a deterministic fallback
 * (keyword/category rules) for demo stability and no-LLM environments.
 *
 * Authoritative input = user text; assets only corroborate (raise confidence / add evidence); the
 * LLM fills category-level world knowledge (complexity, proof regime, compliance boundaries).
 * Conflicts resolve in favor of the user text. See docs/product-intelligence-optimization-plan.md §3.
 *
 * This is an understanding step (same class of LLM call as the slot judge / channel author); it never
 * renders or generates anything.
 */

type Client = ReturnType<typeof createOpenAICompatibleClient>;

export interface AnalyzeProductIntelligenceOptions {
  contentBrief: ContentBrief;
  /** Already-analyzed asset cards used only to corroborate user claims (grounding). */
  assetCards?: AssetCard[];
  /** When false, skip the LLM and return the deterministic fallback directly. */
  useLlm?: boolean;
  clientFactory?: () => Client;
  model?: string;
}

export interface AnalyzeProductIntelligenceResult {
  productIntelligence: ProductIntelligence;
  warnings: string[];
}

export async function analyzeProductIntelligence(
  opts: AnalyzeProductIntelligenceOptions
): Promise<AnalyzeProductIntelligenceResult> {
  const deterministic = buildDeterministicProductIntelligence(opts.contentBrief, opts.assetCards);
  const warnings: string[] = [];

  if (opts.useLlm === false) {
    return { productIntelligence: deterministic, warnings };
  }
  const model = opts.model ?? process.env.LLM_MODEL;
  if (!model) {
    warnings.push('product intelligence: LLM_MODEL not set, used deterministic fallback.');
    return { productIntelligence: deterministic, warnings };
  }

  try {
    const client = (opts.clientFactory ?? createOpenAICompatibleClient)();
    const raw = await callLlm(client, model, opts.contentBrief, opts.assetCards ?? []);
    const parsed = ProductIntelligenceSchema.safeParse({ ...raw, analysisSource: 'llm' });
    if (!parsed.success) {
      warnings.push(`product intelligence: LLM output failed schema (${parsed.error.issues[0]?.message ?? 'invalid'}), used deterministic fallback.`);
      return { productIntelligence: deterministic, warnings };
    }
    return { productIntelligence: groundAgainstAssets(parsed.data, opts.assetCards ?? []), warnings };
  } catch (err) {
    warnings.push(`product intelligence: LLM call failed (${err instanceof Error ? err.message : String(err)}), used deterministic fallback.`);
    return { productIntelligence: deterministic, warnings };
  }
}

// ---------------------------------------------------------------------------
// LLM path
// ---------------------------------------------------------------------------

const PI_MAX_TOKENS = 2048;

const PI_SYSTEM_PROMPT = `你是广告产品策略分析师。给定一个目标产品的文本简介（权威输入）和可选的素材证据，输出一个"产品理解"JSON。
目标不是抽卖点词，而是判断这个产品"靠什么说服人"，以便后续做结构迁移。

判断要点：
- complexity：低复杂度冲动品(low_complexity_impulse_product，如饮料/零食/日用) / 中复杂度生活方式品(medium_complexity_lifestyle_product，如美妆/服饰) / 高复杂度功能品(high_complexity_feature_product，如电子/软件/课程/服务)。
- proofRegime：search(可购前查证的功能) / experience(需体验) / credence(需信任) / hybrid。
- recommendedProofTypes：从 feature_proof/usage_proof/sensory_proof/social_proof/comparison_proof/trust_proof/claim_proof 里选与该品类相符的。
- forbiddenClaims：基于广告合规给出禁止宣称。每条的 "risk" 字段【必须】是下列枚举之一（不要写中文描述）：
  performance_exaggeration(夸大/即时见效) / health_or_medical(健康疗效) / absolute_superlative(绝对化第一) / price_or_offer_inconsistency(价格优惠不一致) / before_after(误导前后对比) / ip_or_brand_confusion(品牌或IP混淆)。具体禁止内容写在 "rule" 字段（中文）。
- "complexity"/"proofRegime"/"recommendedProofTypes" 字段也必须用上面给定的英文枚举值，不能用中文。
- 每个 fact 都带 evidence[{source,text,confidence}]，source∈user_description/asset_evidence/llm_inference。用户说的优先；素材能印证的提高置信度；常识用 llm_inference。

只输出 JSON，字段：
{
 "productName": string,
 "category": {"value":string,"evidence":[...],"confidence":0..1},
 "complexity": "...","proofRegime":"...",
 "coreBenefits":[ProductFact],"usageRituals":[ProductFact],"sensoryCues":[ProductFact],"socialContexts":[ProductFact],
 "recommendedProofTypes":["..."],
 "forbiddenClaims":[{"risk":"...","rule":string,"examplesDisallowed":[string],"evidence":[...]}],
 "targetDurationRecommendation":{"preferred":"high_click_15s|high_conversion_20s|full_story_30s","alternatives":["..."],"reason":string}
}
ProductFact = {"value":string,"evidence":[{"source":"...","text":string,"confidence":0..1}],"confidence":0..1}`;

function buildUserPrompt(brief: ContentBrief, assetCards: AssetCard[]): string {
  const assetSummary = assetCards.slice(0, 12).map((card) => {
    const desc = card.spatialDescription ?? card.temporalDescription ?? card.text ?? '';
    return `- ${card.id} [${card.type}] ${desc} | objects=${card.detectedObjects.slice(0, 6).join('/')} | slots=${card.suitableSlots.join('/')}`;
  }).join('\n');
  return `产品文本简介（权威）：
${JSON.stringify({
    productName: brief.productName,
    category: brief.category,
    targetAudience: brief.targetAudience,
    scenario: brief.scenario,
    sellingPoints: brief.sellingPoints,
    cta: brief.cta,
    stylePreference: brief.stylePreference
  }, null, 2)}

素材证据（仅用于印证用户说法，不要凭素材推翻用户简介）：
${assetSummary || '（无素材）'}

只输出产品理解 JSON 本体。`;
}

function isUnsupportedResponseFormatError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /response_format|json_object/i.test(message);
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  }
  return trimmed;
}

async function callLlm(
  client: Client,
  model: string,
  brief: ContentBrief,
  assetCards: AssetCard[]
): Promise<Record<string, unknown>> {
  const messages = [
    { role: 'system' as const, content: PI_SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserPrompt(brief, assetCards) }
  ];
  let response;
  try {
    response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.3,
      max_tokens: PI_MAX_TOKENS,
      response_format: { type: 'json_object' }
    });
  } catch (err) {
    if (!isUnsupportedResponseFormatError(err)) throw err;
    response = await client.chat.completions.create({ model, messages, temperature: 0.3, max_tokens: PI_MAX_TOKENS });
  }
  const raw = response.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(stripJsonFence(raw));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('product intelligence LLM did not return a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** Light grounding: raise confidence + add an asset_evidence span when a fact value shows up in assets. */
function groundAgainstAssets(pi: ProductIntelligence, assetCards: AssetCard[]): ProductIntelligence {
  if (assetCards.length === 0) return pi;
  const blob = assetCards
    .map((c) => [c.spatialDescription, c.temporalDescription, c.text, c.detectedObjects.join(' '), (c.detectedIngredients ?? []).join(' ')].filter(Boolean).join(' '))
    .join(' ')
    .toLowerCase();
  const ground = (fact: ProductFact): ProductFact => {
    const hit = fact.value && blob.includes(fact.value.toLowerCase());
    if (!hit) return fact;
    const alreadyCorroborated = fact.evidence.some((e) => e.source === 'asset_evidence');
    return alreadyCorroborated ? fact : {
      ...fact,
      confidence: Math.min(1, fact.confidence + 0.15),
      evidence: [...fact.evidence, { source: 'asset_evidence', text: `素材中可见「${fact.value}」`, confidence: 0.7 }]
    };
  };
  return {
    ...pi,
    coreBenefits: pi.coreBenefits.map(ground),
    usageRituals: pi.usageRituals.map(ground),
    sensoryCues: pi.sensoryCues.map(ground),
    socialContexts: pi.socialContexts.map(ground)
  };
}

// ---------------------------------------------------------------------------
// Deterministic fallback
// ---------------------------------------------------------------------------

interface CategoryProfile {
  value: string;
  complexity: ProductComplexity;
  proofRegime: ProofRegime;
  proofTypes: ProofType[];
  sensory: string[];
  rituals: string[];
  social: string[];
}

const CATEGORY_RULES: Array<{ keywords: string[]; profile: Omit<CategoryProfile, 'value'> }> = [
  {
    keywords: ['饮料', '冰红茶', '茶', '水', '可乐', '果汁', 'juice', 'tea', 'drink', 'soda', 'coffee', '咖啡', '奶', 'milk', 'beer', '啤酒', 'beverage'],
    profile: {
      complexity: 'low_complexity_impulse_product',
      proofRegime: 'experience',
      proofTypes: ['sensory_proof', 'usage_proof', 'social_proof'],
      sensory: ['冷感', '水珠/冷凝', '色泽', '香气'],
      rituals: ['从冰箱/冰桶取出', '开盖', '倒入有冰的杯中', '畅饮'],
      social: ['聚餐', '饭后', '户外出游', '朋友分享']
    }
  },
  {
    keywords: ['零食', '食品', '薯片', '饼干', '巧克力', 'snack', 'food', 'candy', '糖'],
    profile: {
      complexity: 'low_complexity_impulse_product',
      proofRegime: 'experience',
      proofTypes: ['sensory_proof', 'usage_proof', 'social_proof'],
      sensory: ['口感', '色泽', '香气'],
      rituals: ['拆开包装', '拿取', '入口'],
      social: ['分享', '聚会', '日常']
    }
  },
  {
    keywords: ['化妆', '护肤', '美妆', '口红', '面膜', 'cosmetic', 'beauty', 'skincare', '精华', '乳液'],
    profile: {
      complexity: 'medium_complexity_lifestyle_product',
      proofRegime: 'experience',
      proofTypes: ['usage_proof', 'sensory_proof', 'social_proof'],
      sensory: ['质地', '光泽', '上脸效果'],
      rituals: ['取用', '涂抹', '上妆'],
      social: ['出门', '约会', '日常护理']
    }
  },
  {
    keywords: ['电子', '手机', '电脑', 'laptop', '笔记本', '耳机', '数码', 'phone', 'computer', 'headphone', 'camera', '相机', '芯片', '屏幕'],
    profile: {
      complexity: 'high_complexity_feature_product',
      proofRegime: 'search',
      proofTypes: ['feature_proof', 'comparison_proof', 'trust_proof'],
      sensory: ['做工质感', '屏幕/光效'],
      rituals: ['上手操作', '功能演示'],
      social: ['办公', '通勤', '创作']
    }
  },
  {
    keywords: ['软件', 'app', 'saas', '系统', '平台', '课程', '教育', '培训', 'course', '服务', '金融', '保险', '医疗', '健康'],
    profile: {
      complexity: 'high_complexity_feature_product',
      proofRegime: 'credence',
      proofTypes: ['trust_proof', 'feature_proof', 'social_proof'],
      sensory: ['界面', '结果展示'],
      rituals: ['上手使用', '流程演示'],
      social: ['团队', '学习', '工作']
    }
  }
];

const DEFAULT_PROFILE: Omit<CategoryProfile, 'value'> = {
  complexity: 'medium_complexity_lifestyle_product',
  proofRegime: 'hybrid',
  proofTypes: ['usage_proof', 'sensory_proof', 'feature_proof'],
  sensory: ['外观', '质感'],
  rituals: ['取用', '使用'],
  social: ['日常使用场景']
};

function resolveCategory(brief: ContentBrief): CategoryProfile {
  const haystack = [brief.category, brief.productName, brief.scenario, brief.sellingPoints.join(' ')].filter(Boolean).join(' ').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => haystack.includes(kw.toLowerCase()))) {
      return { value: brief.category ?? rule.keywords[0], ...rule.profile };
    }
  }
  return { value: brief.category ?? 'generic', ...DEFAULT_PROFILE };
}

function fact(value: string, source: 'user_description' | 'llm_inference', confidence: number): ProductFact {
  return { value, evidence: [{ source, text: value, confidence }], confidence };
}

const SENSORY_KEYWORDS = ['冰', '冷', '爽', '香', '甜', '脆', '滑', '热', '凉', '清新', '解腻', '口感', '味', '飞溅', '水珠', '冷雾', '光泽', '质地'];
const SOCIAL_KEYWORDS = ['聚餐', '分享', '朋友', '户外', '出游', '办公', '通勤', '家庭', '派对', '聚会', '约会', '团队', '学习'];

function pickMatching(points: string[], keywords: string[]): string[] {
  return points.filter((p) => keywords.some((kw) => p.includes(kw)));
}

const BASE_FORBIDDEN_CLAIMS: ClaimBoundary[] = [
  { risk: 'health_or_medical', rule: '不得暗示治疗、疗效、减肥或任何医疗/健康功效。', examplesDisallowed: ['喝了能减肥', '治疗/缓解某症状'], evidence: [{ source: 'llm_inference', text: '广告合规：禁止医疗/健康功效宣称', confidence: 0.9 }] },
  { risk: 'absolute_superlative', rule: '不得使用"第一/最/绝对/唯一"等绝对化表述。', examplesDisallowed: ['全国第一', '最好喝'], evidence: [{ source: 'llm_inference', text: '广告合规：禁止绝对化用语', confidence: 0.9 }] },
  { risk: 'performance_exaggeration', rule: '不得夸大效果或承诺即时见效。', examplesDisallowed: ['立刻见效', '瞬间解决'], evidence: [{ source: 'llm_inference', text: '广告合规：禁止夸大/即时见效', confidence: 0.9 }] },
  { risk: 'before_after', rule: '不得使用误导性的前后对比。', evidence: [{ source: 'llm_inference', text: '广告合规：禁止误导性 before/after', confidence: 0.85 }] },
  { risk: 'price_or_offer_inconsistency', rule: '不得出现价格或优惠不一致/误导信息。', evidence: [{ source: 'llm_inference', text: '广告合规：价格/优惠须一致', confidence: 0.85 }] },
  { risk: 'ip_or_brand_confusion', rule: '不得混淆第三方品牌/Logo 或冒用他方知识产权。', evidence: [{ source: 'llm_inference', text: '广告合规：禁止品牌/IP 混淆', confidence: 0.85 }] }
];

function durationForComplexity(complexity: ProductComplexity): { preferred: TargetDurationMode; alternatives: TargetDurationMode[]; reason: string } {
  if (complexity === 'high_complexity_feature_product') {
    return {
      preferred: 'full_story_30s',
      alternatives: ['high_conversion_20s', 'high_click_15s'],
      reason: '高复杂度功能品需要更多解释性/信任性 beats，适合更长的完整叙事。'
    };
  }
  if (complexity === 'medium_complexity_lifestyle_product') {
    return {
      preferred: 'high_conversion_20s',
      alternatives: ['full_story_30s', 'high_click_15s'],
      reason: '中复杂度生活方式品在节奏与解释之间平衡，20s 为主。'
    };
  }
  return {
    preferred: 'high_conversion_20s',
    alternatives: ['high_click_15s', 'full_story_30s'],
    reason: '低复杂度冲动型商品适合高节奏、强感官、强识别的短视频结构。'
  };
}

export function buildDeterministicProductIntelligence(
  brief: ContentBrief,
  assetCards?: AssetCard[]
): ProductIntelligence {
  const profile = resolveCategory(brief);
  const sensoryFromPoints = pickMatching(brief.sellingPoints, SENSORY_KEYWORDS);
  const socialFromPoints = pickMatching(brief.sellingPoints, SOCIAL_KEYWORDS).concat(
    SOCIAL_KEYWORDS.some((kw) => (brief.scenario ?? '').includes(kw)) ? [brief.scenario] : []
  );
  const duration = durationForComplexity(profile.complexity);

  const pi: ProductIntelligence = {
    productName: brief.productName,
    category: { value: profile.value, evidence: [{ source: brief.category ? 'user_description' : 'llm_inference', text: profile.value, confidence: brief.category ? 0.95 : 0.7 }], confidence: brief.category ? 0.95 : 0.7 },
    complexity: profile.complexity,
    proofRegime: profile.proofRegime,
    coreBenefits: brief.sellingPoints.map((p) => fact(p, 'user_description', 0.85)),
    usageRituals: (profile.rituals).map((r) => fact(r, 'llm_inference', 0.6)),
    sensoryCues: (sensoryFromPoints.length ? sensoryFromPoints.map((p) => fact(p, 'user_description', 0.8)) : profile.sensory.map((s) => fact(s, 'llm_inference', 0.6))),
    socialContexts: (socialFromPoints.length ? socialFromPoints.map((p) => fact(p, 'user_description', 0.75)) : profile.social.map((s) => fact(s, 'llm_inference', 0.6))),
    recommendedProofTypes: profile.proofTypes,
    forbiddenClaims: BASE_FORBIDDEN_CLAIMS,
    targetDurationRecommendation: duration,
    analysisSource: 'deterministic'
  };
  return groundAgainstAssets(pi, assetCards ?? []);
}
