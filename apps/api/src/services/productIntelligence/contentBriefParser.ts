import type { ContentBrief } from '@viral-struct/shared';
import { ContentBriefSchema } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from '../llmProvider';

/**
 * Content brief parser — the production "front door".
 *
 * On a live product the user does NOT hand-author the structured ContentBrief; they type one free-form
 * paragraph describing their product. This turns that paragraph into a schema-valid ContentBrief
 * (productName / category / targetAudience / scenario / sellingPoints / cta / stylePreference), which then
 * feeds the existing pipeline: analyzeProductIntelligence(ContentBrief) → structural compression → Director.
 *
 * LLM path (faithful extraction) + deterministic fallback (best-effort split, demo-stable / no-LLM). It is
 * an understanding step, not a render step. See docs/product-intelligence-optimization-plan.md (P0-A).
 */

type Client = ReturnType<typeof createOpenAICompatibleClient>;

/**
 * The single source of truth for the front-end input hint. Show this to the user above the text box so
 * they cover the aspects the parser needs; the same string can be imported by the web app.
 */
export const USER_BRIEF_INPUT_GUIDANCE = `用一段话介绍你要推广的产品就好（不用分点，自然说一段，系统会自动解析）。尽量说清楚这几点：
① 产品是什么 —— 名字 + 大概品类（例：“康师傅冰红茶，一款柠檬味即饮红茶饮料”）
② 卖给谁 —— 目标人群（例：夏天通勤、爱聚餐的年轻人）
③ 什么场景 / 什么时候用（例：天热口渴、饭后解腻、朋友聚会）
④ 最想突出的 3–5 个卖点 / 特点（例：冰爽解腻、柠檬茶香、大瓶分享、冰镇更清爽）
⑤ 希望观众看完做什么 —— 一句行动号召（例：现在就来一瓶）
⑥（可选）风格偏好（例：高节奏、夏日清爽、真实质感）

小提示：少写绝对化用语（“最/第一”）、医疗功效和未经证实的数字，系统会按广告合规自动过滤。`;

export interface ParseContentBriefOptions {
  /** The user's free-form product paragraph. */
  rawInput: string;
  /** When false, skip the LLM and return the deterministic best-effort parse. */
  useLlm?: boolean;
  clientFactory?: () => Client;
  model?: string;
}

export interface ParseContentBriefResult {
  contentBrief: ContentBrief;
  warnings: string[];
  source: 'llm' | 'deterministic';
}

export async function parseContentBrief(opts: ParseContentBriefOptions): Promise<ParseContentBriefResult> {
  const deterministic = buildDeterministicContentBrief(opts.rawInput);
  const warnings: string[] = [];

  if (opts.useLlm === false) {
    return { contentBrief: deterministic, warnings, source: 'deterministic' };
  }
  const model = opts.model ?? process.env.LLM_MODEL;
  if (!model) {
    warnings.push('content brief: LLM_MODEL not set, used deterministic parse.');
    return { contentBrief: deterministic, warnings, source: 'deterministic' };
  }

  try {
    const client = (opts.clientFactory ?? createOpenAICompatibleClient)();
    const raw = await callLlm(client, model, opts.rawInput);
    const parsed = ContentBriefSchema.safeParse(normalizeLlmBrief(raw));
    if (!parsed.success) {
      warnings.push(`content brief: LLM output failed schema (${parsed.error.issues[0]?.message ?? 'invalid'}), used deterministic parse.`);
      return { contentBrief: deterministic, warnings, source: 'deterministic' };
    }
    return { contentBrief: parsed.data, warnings, source: 'llm' };
  } catch (err) {
    warnings.push(`content brief: LLM call failed (${err instanceof Error ? err.message : String(err)}), used deterministic parse.`);
    return { contentBrief: deterministic, warnings, source: 'deterministic' };
  }
}

// ---------------------------------------------------------------------------
// LLM path
// ---------------------------------------------------------------------------

const BRIEF_MAX_TOKENS = 1024;

const BRIEF_SYSTEM_PROMPT = `你是广告短视频的需求解析器。用户用自然语言描述他要推广的产品，你把它解析成结构化 JSON brief，供后续生成视频脚本使用。

只输出 JSON：
{
 "productName": "产品名称（必填，简短）",
 "category": "品类（如 beverage/饮料/零食/美妆/电子/课程/服务；不确定就留空字符串）",
 "targetAudience": "目标人群，一句话（必填）",
 "scenario": "使用/消费场景，一句话（必填）",
 "sellingPoints": ["3-6 条精炼卖点短语，每条尽量≤10字"],
 "cta": "一句行动号召（必填）",
 "stylePreference": "风格偏好（可选，没有就留空）"
}

规则：
1. productName / targetAudience / scenario / cta 必须非空；sellingPoints 至少 1 条。
2. 用户没明说的，基于常识合理补全；但绝不要编造具体数字、价格、绝对化（最/第一）或医疗功效。
3. sellingPoints 要提炼成短卖点，不要整句照抄。
4. 忠实用户原意，不夸大。`;

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

async function callLlm(client: Client, model: string, rawInput: string): Promise<Record<string, unknown>> {
  const messages = [
    { role: 'system' as const, content: BRIEF_SYSTEM_PROMPT },
    { role: 'user' as const, content: `用户输入：\n${rawInput.trim()}\n\n只输出 brief JSON 本体。` }
  ];
  let response;
  try {
    response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.2,
      max_tokens: BRIEF_MAX_TOKENS,
      response_format: { type: 'json_object' }
    });
  } catch (err) {
    if (!isUnsupportedResponseFormatError(err)) throw err;
    response = await client.chat.completions.create({ model, messages, temperature: 0.2, max_tokens: BRIEF_MAX_TOKENS });
  }
  const raw = response.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(stripJsonFence(raw));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('content brief LLM did not return a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** Drop empty optional fields so ContentBriefSchema's optionals stay optional (empty string ≠ absent). */
function normalizeLlmBrief(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  for (const key of ['category', 'stylePreference']) {
    if (typeof out[key] === 'string' && (out[key] as string).trim().length === 0) delete out[key];
  }
  if (Array.isArray(out.sellingPoints)) {
    out.sellingPoints = (out.sellingPoints as unknown[]).filter((s) => typeof s === 'string' && s.trim().length > 0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic fallback (best-effort; rough but always schema-valid)
// ---------------------------------------------------------------------------

const LEAD_IN = /^(请?帮?我?(想|要|想要|准备|打算)?(推广|宣传|介绍|做|卖|拍)一?个?[:：，,]?\s*)/;
const AUDIENCE_CUES = ['人群', '用户', '年轻人', '学生', '白领', '上班', '通勤', '妈妈', '宝妈', '家庭', '男士', '女性', '面向', '卖给', '受众'];
const SCENARIO_CUES = ['场景', '时候', '天气', '聚餐', '出行', '出游', '办公', '在家', '运动', '饭后', '夏天', '夏日', '炎热', '聚会', '通勤'];
const CTA_CUES = ['购买', '下单', '来一', '立即', '现在就', '马上', '试试', '尝试', '扫码', '点击', '关注', '入手', '抢购', '了解一下'];
const BENEFIT_HINTS = ['爽', '香', '快', '省', '强', '好', '方便', '解腻', '清爽', '高效', '轻', '薄', '稳', '甜', '脆', '滑', '冰', '续航', '性价比', '耐'];

export function buildDeterministicContentBrief(rawInput: string): ContentBrief {
  const text = (rawInput ?? '').trim();
  const fragments = splitFragments(text);

  const productName = clamp(stripLeadIn(fragments[0] ?? text) || '待命名产品', 30);
  const audienceFragment = pickByCue(fragments, AUDIENCE_CUES, new Set());
  const targetAudience = audienceFragment ?? '大众消费者';
  // scenario must not be the same fragment we used for audience (they share cue words like 通勤).
  const scenarioFragment = pickByCue(fragments, SCENARIO_CUES, new Set(audienceFragment ? [audienceFragment] : []));
  const scenario = scenarioFragment ?? '日常使用场景';
  const ctaFragment = pickByCue(fragments, CTA_CUES, new Set());
  const cta = ctaFragment ?? `现在就了解${productName}`;

  // Selling points = remaining fragments that are NOT the name / audience / scenario / cta and do not
  // themselves carry audience/scenario/cta cues (so "在天热口渴" doesn't masquerade as a selling point).
  const used = new Set([fragments[0], audienceFragment, scenarioFragment, ctaFragment].filter(Boolean) as string[]);
  const isCueBearing = (f: string) => [...AUDIENCE_CUES, ...SCENARIO_CUES, ...CTA_CUES].some((c) => f.includes(c));
  const sellingCandidates = fragments
    .filter((f) => !used.has(f) && !isCueBearing(f))
    .filter((f) => f.length <= 16 && (BENEFIT_HINTS.some((h) => f.includes(h)) || f.length <= 12));
  const sellingPoints = (sellingCandidates.length ? sellingCandidates : fragments.slice(1).filter((f) => !used.has(f)))
    .map((f) => clamp(f, 14))
    .filter((f) => f.length > 0)
    .slice(0, 5);

  return {
    productName,
    targetAudience,
    scenario,
    sellingPoints: sellingPoints.length ? sellingPoints : ['核心卖点'],
    cta: clamp(cta, 40)
  };
}

function splitFragments(text: string): string[] {
  return text
    .split(/[，。;；、!！?？\n\r,.]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function stripLeadIn(fragment: string): string {
  return fragment.replace(LEAD_IN, '').trim();
}

function pickByCue(fragments: string[], cues: string[], exclude: Set<string>): string | undefined {
  const hit = fragments.find((f) => !exclude.has(f) && cues.some((c) => f.includes(c)));
  return hit ? clamp(hit, 40) : undefined;
}

function clamp(value: string, max: number): string {
  const v = value.trim();
  return v.length <= max ? v : v.slice(0, max);
}
