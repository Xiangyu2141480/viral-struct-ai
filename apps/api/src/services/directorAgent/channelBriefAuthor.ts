import { createOpenAICompatibleClient } from '../llmProvider';
import { containsSourceSpecificTerm } from '../motifs/motionGrammarSanitizer';

/**
 * Channel brief authoring (option-2 design, see docs/asset-card-extraction-pipeline.md §12 follow-up).
 *
 * One shared, NEUTRAL abstract intent per slot → three capability-bounded prompts → the LLM authors
 * each channel's text under that channel's physical-capability envelope, then a deterministic validator
 * enforces the envelope (soft prompt constraint + hard post-check):
 *
 *   - reshoot     → only real-world, phone-filmable actions/framing. NO surreal/VFX.
 *   - hyperframes → only edits on the EXISTING placed footage + 2D cards/text. NO new photoreal/VFX.
 *   - aigc        → the surreal abstract-transfer concept (cascade/burst/morph) is allowed here only.
 *
 * "Abstraction != surreal": the shared intent is neutral motion grammar; each channel RENDERS it
 * differently (reshoot renders down to real, aigc renders up to surreal). The surreal rendering lives
 * only in aigc. Authoring never throws to the caller — a channel that fails / fails validation is simply
 * omitted, and the caller keeps its deterministic fallback text for that channel.
 *
 * This is an LLM authoring step, not a render/generation step: it only writes briefs (same class of call
 * as the slot-alignment judge). The Director's plan-only boundary (no render, AIGC=job-card) is intact.
 */

export type AuthoringChannel = 'reshoot' | 'hyperframes' | 'aigc';

export interface SharedChannelIntent {
  slotId: string;
  role: string;
  productName: string;
  category: string;
  sellingPoints: string[];
  /** Neutral, source-sanitized intent (already stripped of source-product leakage). */
  transferableIntent?: string;
  /** Neutral motion-grammar tokens detected for this slot (e.g. cascade/converge/activate). */
  motionTokens: string[];
  motifType?: string;
  fillStatus: string;
  /** The real placed/reference asset ids the hyperframes edit must build on. */
  referenceAssetIds: string[];
  /** Visible evidence from the matched/reference asset (keyframe captions, semantic summary). */
  assetEvidence: string[];
  durationSec: number;
}

export interface AuthoredReshoot {
  title: string;
  guidanceNL: string;
  framing: string;
  mustCapture: string[];
  avoid: string[];
}
export interface AuthoredHyperframes {
  title: string;
  editingGuidanceNL: string;
  cardType?: string;
  copy?: { headline?: string; subline?: string; bullets?: string[]; cta?: string };
}
export interface AuthoredAigc {
  prompt: string;
  negativePrompt: string;
}

export interface AuthoredChannelText {
  reshoot?: AuthoredReshoot;
  hyperframes?: AuthoredHyperframes;
  aigc?: AuthoredAigc;
  /** Per-channel notes on why a channel was dropped (fell back to deterministic). */
  warnings: string[];
}

type Client = ReturnType<typeof createOpenAICompatibleClient>;

export interface AuthorChannelBriefsOptions {
  intent: SharedChannelIntent;
  channels: AuthoringChannel[];
  clientFactory?: () => Client;
  model?: string;
}

// ---------------------------------------------------------------------------
// Capability envelopes (the three different prompts)
// ---------------------------------------------------------------------------

const RESHOOT_SYSTEM_PROMPT = `你是真人短视频「补拍」导演。给定一个抽象镜头意图，写一份用普通手机就能在现实中真实拍摄出来的补拍简报。

硬性能力边界（必须遵守）：
1. 只能是物理世界里真人/真物真实可拍的动作、构图、光线、场景。
2. 严禁任何超现实或后期特效内容：悬浮、凭空出现、级联飞入、配料自动汇聚、形变、粒子、爆发、炸开、冷雾炸裂、物体自动组装、镜头穿越物体等，一律不许写。把抽象的"结构动机"落地成真实可执行的人手动作（如：开盖、倒入杯中、举起瓶子旋转展示标签、把多瓶依次摆好、喝一口）。
3. 不得出现具体品牌名/型号/源产品物体；不得出现明星或公众人物；不得写价格、促销、医疗或功效宣称。

只输出 JSON：{"title": "≤14字镜头名", "guidanceNL": "一段可执行的补拍说明，讲清拍什么动作、怎么拍", "framing": "竖屏景别与构图", "mustCapture": ["必须拍到的真实要素"], "avoid": ["要避免的内容"]}`;

const HYPERFRAMES_SYSTEM_PROMPT = `你是使用 HyperFrames 做「基于已有真实素材的剪辑 + 图文动画」的剪辑师。给定抽象镜头意图与已放入的真实素材证据，写一份剪辑指令。

硬性能力边界（必须遵守）：
1. 只能描述对「已有真实素材帧」的剪辑操作（裁切、推近/拉远、卡点、定格、循环、转场擦除）和 2D 图层动画（文字卡、卖点卡、CTA 卡、箭头/高亮/进度点）。必须围绕给定的参考素材来编排。
2. 严禁描述任何需要重新生成的写实新画面或 VFX：不要写"冰块飞入""冷雾爆发""配料级联汇聚""产品形变"等——那是 AIGC 的活，不是剪辑能做的。
3. 不得出现具体品牌名/型号/源产品物体、明星、价格、医疗或功效宣称。

只输出 JSON：{"title": "≤14字", "editingGuidanceNL": "剪辑步骤 + 大致时间轴，说明如何用已有素材+图层完成", "cardType": "卡片类型英文蛇形命名", "copy": {"headline": "可选主文案", "subline": "可选副文案", "bullets": ["可选要点"], "cta": "可选行动号召"}}`;

const AIGC_SYSTEM_PROMPT = `你是 AIGC 视频生成提示词工程师。给定抽象镜头意图，写一条可交给视频生成模型执行的提示词（仅为提示词，不是成片）。

能力与边界：
1. 这里允许超现实的结构迁移效果（级联、汇聚、激活、爆发、形变），但必须用目标品类的等价元素来演绎（饮料语境：冰块、柠檬片、红茶水滴、冷雾、开盖、倒茶、CTA 收口）。
2. 保留源片的抽象运动语法，但严禁照搬源产品/源场景的具体物体；不得出现具体品牌名/型号、明星、价格、医疗或功效宣称。

只输出 JSON：{"prompt": "竖屏 9:16 生成提示词正文", "negativePrompt": "负向提示词（要规避的内容）"}`;

function systemPromptFor(channel: AuthoringChannel): string {
  if (channel === 'reshoot') return RESHOOT_SYSTEM_PROMPT;
  if (channel === 'hyperframes') return HYPERFRAMES_SYSTEM_PROMPT;
  return AIGC_SYSTEM_PROMPT;
}

function buildUserPrompt(channel: AuthoringChannel, intent: SharedChannelIntent): string {
  const shared = {
    role: intent.role,
    product: intent.productName,
    category: intent.category,
    sellingPoints: intent.sellingPoints,
    abstractIntent: intent.transferableIntent,
    motionGrammar: intent.motionTokens,
    motifType: intent.motifType,
    durationSec: intent.durationSec
  };
  const assetContext = channel === 'hyperframes'
    ? { referenceAssetIds: intent.referenceAssetIds, assetEvidence: intent.assetEvidence }
    : {};
  return `抽象镜头意图（中性，不要照抄成超现实，请按本渠道能力渲染）：

${JSON.stringify({ ...shared, ...assetContext }, null, 2)}

请只输出本渠道要求的 JSON 本体。`;
}

// ---------------------------------------------------------------------------
// Validators (hard post-check of the capability envelope)
// ---------------------------------------------------------------------------

// Surreal / VFX vocabulary that reshoot (and hyperframes) must never contain.
const SURREAL_TERMS = [
  '悬浮', '漂浮', '凭空', '级联', '汇聚', '飞入', '飞舞', '飞散', '爆发', '炸开', '炸裂',
  '形变', '变形', '粒子', '冷雾', '自动组装', '拼合', '合体', '穿越', '环绕飞行', '解构', '重组',
  'morph', 'levitate', 'cascade', 'burst', 'explode', 'particle', 'assemble', 'disintegrate'
];

function containsAny(text: string, terms: string[]): string | undefined {
  const lower = text.toLowerCase();
  return terms.find((t) => lower.includes(t.toLowerCase()));
}

function assertReshootFilmable(r: AuthoredReshoot): void {
  const blob = [r.guidanceNL, r.framing, ...r.mustCapture].join(' ');
  const hit = containsAny(blob, SURREAL_TERMS);
  if (hit) throw new Error(`reshoot brief contains non-filmable/surreal term "${hit}"`);
  assertNoSourceLeak(blob);
}

function assertHyperframesEditable(h: AuthoredHyperframes): void {
  const blob = [h.editingGuidanceNL, h.cardType ?? '', JSON.stringify(h.copy ?? {})].join(' ');
  const hit = containsAny(blob, SURREAL_TERMS);
  if (hit) throw new Error(`hyperframes brief describes generation/VFX term "${hit}" (not an editing op)`);
  assertNoSourceLeak(blob);
}

function assertAigcSafe(a: AuthoredAigc): void {
  // aigc MAY be surreal; it must only stay free of source-product leakage in the POSITIVE prompt.
  assertNoSourceLeak(a.prompt);
}

function assertNoSourceLeak(text: string): void {
  if (containsSourceSpecificTerm(text)) {
    throw new Error('authored text leaked a source-specific product term');
  }
}

// ---------------------------------------------------------------------------
// LLM plumbing (mirrors slotMatcher: json_object with retry + stripJsonFence + max_tokens)
// ---------------------------------------------------------------------------

const AUTHORING_MAX_TOKENS = 1024;

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

async function callChannel(
  client: Client,
  model: string,
  channel: AuthoringChannel,
  intent: SharedChannelIntent
): Promise<Record<string, unknown>> {
  const messages = [
    { role: 'system' as const, content: systemPromptFor(channel) },
    { role: 'user' as const, content: buildUserPrompt(channel, intent) }
  ];
  let response;
  try {
    response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.5,
      max_tokens: AUTHORING_MAX_TOKENS,
      response_format: { type: 'json_object' }
    });
  } catch (err) {
    if (!isUnsupportedResponseFormatError(err)) throw err;
    response = await client.chat.completions.create({ model, messages, temperature: 0.5, max_tokens: AUTHORING_MAX_TOKENS });
  }
  const raw = response.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(stripJsonFence(raw));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`${channel} authoring did not return a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Parsers (LLM JSON → typed channel text, with shape validation)
// ---------------------------------------------------------------------------

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

function parseReshoot(raw: Record<string, unknown>): AuthoredReshoot {
  const guidanceNL = asString(raw.guidanceNL);
  if (!guidanceNL) throw new Error('reshoot authoring missing guidanceNL');
  return {
    title: asString(raw.title) ?? '补拍镜头',
    guidanceNL,
    framing: asString(raw.framing) ?? '竖屏中近景，产品居中，上下留出文字安全区',
    mustCapture: asStringArray(raw.mustCapture),
    avoid: asStringArray(raw.avoid)
  };
}

function parseHyperframes(raw: Record<string, unknown>): AuthoredHyperframes {
  const editingGuidanceNL = asString(raw.editingGuidanceNL);
  if (!editingGuidanceNL) throw new Error('hyperframes authoring missing editingGuidanceNL');
  const copyRaw = (typeof raw.copy === 'object' && raw.copy !== null) ? raw.copy as Record<string, unknown> : undefined;
  const copy = copyRaw
    ? {
        headline: asString(copyRaw.headline),
        subline: asString(copyRaw.subline),
        bullets: asStringArray(copyRaw.bullets).length ? asStringArray(copyRaw.bullets) : undefined,
        cta: asString(copyRaw.cta)
      }
    : undefined;
  const out: AuthoredHyperframes = { title: asString(raw.title) ?? '剪辑增强', editingGuidanceNL };
  const cardType = asString(raw.cardType);
  if (cardType) out.cardType = cardType;
  if (copy && (copy.headline || copy.subline || copy.bullets || copy.cta)) out.copy = copy;
  return out;
}

function parseAigc(raw: Record<string, unknown>): AuthoredAigc {
  const prompt = asString(raw.prompt);
  if (!prompt) throw new Error('aigc authoring missing prompt');
  return { prompt, negativePrompt: asString(raw.negativePrompt) ?? '' };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function authorChannelBriefs(opts: AuthorChannelBriefsOptions): Promise<AuthoredChannelText> {
  const result: AuthoredChannelText = { warnings: [] };
  const model = opts.model ?? process.env.LLM_MODEL;
  if (!model) {
    result.warnings.push('channel authoring skipped: LLM_MODEL not set (kept deterministic fallback).');
    return result;
  }
  const client = (opts.clientFactory ?? createOpenAICompatibleClient)();

  await Promise.all(opts.channels.map(async (channel) => {
    try {
      const raw = await callChannel(client, model, channel, opts.intent);
      if (channel === 'reshoot') {
        const r = parseReshoot(raw);
        assertReshootFilmable(r);
        result.reshoot = r;
      } else if (channel === 'hyperframes') {
        const h = parseHyperframes(raw);
        assertHyperframesEditable(h);
        result.hyperframes = h;
      } else {
        const a = parseAigc(raw);
        assertAigcSafe(a);
        result.aigc = a;
      }
    } catch (err) {
      result.warnings.push(`${opts.intent.slotId}/${channel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }));

  return result;
}
