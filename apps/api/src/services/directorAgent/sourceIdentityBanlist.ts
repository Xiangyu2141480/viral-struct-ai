import type { ViralStructureGraph } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from '../llmProvider';

/**
 * Source-Identity Banlist (MANDATORY LLM).
 *
 * Turns the SCANNED source structure graph (productInSource / specificAction / shot subjects) into the set
 * of source-product-specific terms that must never leak into the TARGET product's output. This replaces the
 * hardcoded MacBook word lists that used to live across the Director (they assumed the source video was
 * always the MacBook ad). Now the leak guardrails follow whatever source was actually scanned — earphone,
 * lipstick, anything. There is NO deterministic fallback: if the LLM is unavailable or returns an empty
 * banlist, this throws (mirrors categoryEquivalentTranslator).
 */

type Client = ReturnType<typeof createOpenAICompatibleClient>;

export interface SourceIdentityBanlist {
  /** The source product as named by the scanned source structure graph (e.g. "苹果MacBook笔记本电脑"). */
  sourceProduct: string;
  /** Atomic, substring-matchable source-identity terms (EN + 中文) that must never appear in target output. */
  terms: string[];
}

export interface DeriveSourceIdentityBanlistInput {
  structureGraph: ViralStructureGraph;
  clientFactory?: () => Client;
  model?: string;
  /** Test seam: when this KEY is present (even as undefined) it overrides process.env.LLM_MODEL. */
  envModel?: string;
  maxRetries?: number;
}

const MAX_TOKENS = 1024;

const SYSTEM_PROMPT = `你是短视频「结构迁移」的源身份禁忌词提取器。给定一条爆款源视频扫描出的结构图证据（源产品名、源产品的具体动作、源画面描述），请列出所有「源产品专属、一旦出现在目标成片里就算身份泄漏」的词。

要求：
1. 覆盖三类：源产品名/品牌/型号；源产品的专属物理部件；源产品专属的道具、场景或叙事意象。
2. 每个词都要**原子化、可单独子串匹配**（如源是「苹果MacBook笔记本电脑」要拆成「苹果」「MacBook」「Apple」「笔记本」「laptop」「键盘」「keyboard」「触控板」「机身」等，而不是整串）。
3. 中英文写法都要给。
4. 严禁纳入任何品类通用词（产品、画面、展示、打开、旋转、特写、镜头、背景、光影、质感、定格 等任何产品都可能出现的词）——只要源产品专属、放到别的品类里会显得违和的词。
5. 不要编造源证据里完全没有依据、也不属于该源产品常识部件的词。

只输出一个 JSON：{"sourceProduct": "源产品名", "terms": ["专属词", ...]}`;

function unique(values: (string | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => Boolean(v && v.trim()))));
}

function sourceEvidence(graph: ViralStructureGraph): unknown {
  const slots = (graph.shotSlots ?? []) as Array<{
    sourceInstance?: { productInSource?: string; specificAction?: string };
    requiredAsset?: { subject?: string };
  }>;
  return {
    meta: graph.meta,
    productInSource: unique(slots.map((s) => s.sourceInstance?.productInSource)),
    specificActions: unique(slots.map((s) => s.sourceInstance?.specificAction)).slice(0, 12),
    shotSubjects: unique(slots.map((s) => s.requiredAsset?.subject)).slice(0, 12)
  };
}

function buildUserPrompt(graph: ViralStructureGraph): string {
  return `源视频结构图证据：\n${JSON.stringify(sourceEvidence(graph), null, 2)}\n\n请只输出规定结构的 JSON 本体。`;
}

function stripJsonFence(raw: string): string {
  const t = raw.trim();
  return t.startsWith('```') ? t.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim() : t;
}

function parseBanlist(raw: string): SourceIdentityBanlist {
  const obj = JSON.parse(stripJsonFence(raw)) as { sourceProduct?: unknown; terms?: unknown };
  const sourceProduct = typeof obj.sourceProduct === 'string' ? obj.sourceProduct.trim() : '';
  const terms = unique(Array.isArray(obj.terms) ? obj.terms.map((t) => (typeof t === 'string' ? t : '')) : []);
  if (!sourceProduct || terms.length === 0) {
    throw new Error('incomplete source identity banlist: need sourceProduct and a non-empty terms[]');
  }
  return { sourceProduct, terms };
}

export async function deriveSourceIdentityBanlist(input: DeriveSourceIdentityBanlistInput): Promise<SourceIdentityBanlist> {
  const envModel = 'envModel' in input ? input.envModel : process.env.LLM_MODEL;
  const model = input.model ?? envModel;
  if (!model) {
    throw new Error('LLM_MODEL is required: source-identity banlist must run via the LLM (no fallback).');
  }
  const client = (input.clientFactory ?? createOpenAICompatibleClient)();
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserPrompt(input.structureGraph) }
  ];
  const maxRetries = input.maxRetries ?? 1;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      let response;
      try {
        response = await client.chat.completions.create({ model, messages, temperature: 0.3, max_tokens: MAX_TOKENS, response_format: { type: 'json_object' } });
      } catch (err) {
        if (!/response_format|json_object/i.test(err instanceof Error ? err.message : String(err))) throw err;
        response = await client.chat.completions.create({ model, messages, temperature: 0.3, max_tokens: MAX_TOKENS });
      }
      const raw = response.choices[0]?.message?.content ?? '';
      return parseBanlist(raw);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`source identity banlist failed after ${maxRetries + 1} attempt(s): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
