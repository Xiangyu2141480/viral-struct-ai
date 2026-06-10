import { z } from 'zod';
import type { SegmentRole, TimelineItem } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from './llmProvider';

// ---------------------------------------------------------------------------
// Natural-language timeline editing (任务12/13 / 加分项).
//
// Design (mirrors the project's "model owns semantics, code owns deterministic
// transforms" philosophy):
//   1. parseEditInstruction*  : NL instruction -> structured EditOperation[]
//   2. applyEditOperations    : EditOperation[] + timeline -> new timeline + patches
//
// Structural ops (pace / caption density / reorder) are fully deterministic and
// work WITHOUT an LLM. Copy-rewrite ops (strengthen_hook / restyle_ending /
// rewrite_script) require LLM-provided `newText`; without it they are skipped.
// ---------------------------------------------------------------------------

export const EDIT_OPERATION_TYPES = [
  'strengthen_hook', // "开头更抓人"
  'restyle_ending', // "结尾表达"
  'rewrite_script', // generic copy rewrite (targetRole / targetItemId)
  'reduce_caption_density', // "减少字幕"
  'increase_caption_density',
  'increase_pace', // "增强节奏感"
  'decrease_pace',
  'move_product_info_earlier', // "把商品信息提前"
  'reorder_selling_points', // "卖点顺序"
  'change_caption_style' // "包装风格"
] as const;

export type EditOperationType = (typeof EDIT_OPERATION_TYPES)[number];

const SEGMENT_ROLES: [SegmentRole, ...SegmentRole[]] = [
  'hook',
  'pain_point',
  'selling_point',
  'proof',
  'usage',
  'comparison',
  'cta'
];

export const EditOperationSchema = z.object({
  type: z.enum(EDIT_OPERATION_TYPES),
  targetRole: z.enum(SEGMENT_ROLES).optional(),
  targetItemId: z.string().optional(),
  newText: z.string().optional(),
  newCaptionStyle: z.string().optional(),
  factor: z.number().positive().max(4).optional(),
  newOrder: z.array(z.string()).optional(),
  reason: z.string().optional()
});

export type EditOperation = z.infer<typeof EditOperationSchema>;

export const EditPlanSchema = z.object({
  operations: z.array(EditOperationSchema)
});

export interface EditPatch {
  op: EditOperationType;
  targetItemId: string;
  field: string;
  before: unknown;
  after: unknown;
  reason: string;
}

export interface ApplyEditResult {
  timeline: TimelineItem[];
  patches: EditPatch[];
}

export interface NaturalLanguageEditResult extends ApplyEditResult {
  operations: EditOperation[];
  editSource: 'llm_parsed' | 'rule_based';
  warning?: string;
}

// ---------------------------------------------------------------------------
// Deterministic applier
// ---------------------------------------------------------------------------

function round(value: number): number {
  return Number(value.toFixed(2));
}

function cloneItem(item: TimelineItem): TimelineItem {
  return { ...item, packaging: { ...item.packaging }, subtitles: [...item.subtitles] };
}

/** Re-pack start/end contiguously from the first item's start, preserving each item's own duration. */
function resequence(items: TimelineItem[]): TimelineItem[] {
  if (!items.length) return items;
  let cursor = items[0].start;
  return items.map((item) => {
    const duration = Math.max(0.1, round(item.end - item.start));
    const start = round(cursor);
    const end = round(cursor + duration);
    cursor = end;
    return { ...item, start, end };
  });
}

function mergeAdjacentLines(lines: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    out.push(lines.slice(i, i + 2).join(' ').trim());
  }
  return out;
}

function splitIntoSubtitles(text: string): string[] {
  const parts = text
    .replace(/([，。！？、,.!?；;])/g, '$1\n')
    .split(/\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const lines = parts.length ? parts : [text.trim()];
  const out: string[] = [];
  for (const line of lines) {
    if (line.length <= 16) {
      out.push(line);
    } else {
      for (let i = 0; i < line.length; i += 14) {
        out.push(line.slice(i, i + 14));
      }
    }
  }
  return out.length ? out : [text.trim()];
}

function targetRoleForType(op: EditOperation): SegmentRole | undefined {
  if (op.type === 'strengthen_hook') return 'hook';
  if (op.type === 'restyle_ending') return 'cta';
  return op.targetRole;
}

function applyCaptionDensity(items: TimelineItem[], op: EditOperation, patches: EditPatch[]): TimelineItem[] {
  const reduce = op.type === 'reduce_caption_density';
  return items.map((item) => {
    if (reduce && item.subtitles.length <= 1) return item;
    const before = item.subtitles;
    const after = reduce
      ? mergeAdjacentLines(item.subtitles)
      : item.subtitles.flatMap((line) =>
          line.length > 8 ? [line.slice(0, Math.ceil(line.length / 2)), line.slice(Math.ceil(line.length / 2))] : [line]
        );
    if (after.length === before.length) return item;
    patches.push({
      op: op.type,
      targetItemId: item.id,
      field: 'subtitles',
      before,
      after,
      reason: op.reason ?? (reduce ? '减少字幕行数' : '拆分字幕，提高密度')
    });
    return { ...item, subtitles: after };
  });
}

function applyPace(items: TimelineItem[], op: EditOperation, patches: EditPatch[]): TimelineItem[] {
  const faster = op.type === 'increase_pace';
  const factor = op.factor ?? (faster ? 0.8 : 1.25);
  const transition: NonNullable<TimelineItem['packaging']['transition']> = faster ? 'quick_cut' : 'fade';
  const scaled = items.map((item) => {
    const duration = Math.max(0.1, item.end - item.start);
    return {
      ...item,
      end: round(item.start + duration * factor),
      packaging: { ...item.packaging, transition }
    };
  });
  const next = resequence(scaled);
  const beforeTotal = round((items.at(-1)?.end ?? 0) - (items[0]?.start ?? 0));
  const afterTotal = round((next.at(-1)?.end ?? 0) - (next[0]?.start ?? 0));
  patches.push({
    op: op.type,
    targetItemId: '*',
    field: 'duration+transition',
    before: `总时长 ${beforeTotal}s`,
    after: `总时长 ${afterTotal}s，转场→${transition}`,
    reason: op.reason ?? (faster ? '压缩时长、加快节奏' : '拉长时长、放慢节奏')
  });
  return next;
}

function applyMoveProductEarlier(items: TimelineItem[], op: EditOperation, patches: EditPatch[]): TimelineItem[] {
  const firstSell = items.findIndex((item) => item.segmentRole === 'selling_point');
  if (firstSell < 0) return items;
  let insertAt = 0;
  while (insertAt < items.length && items[insertAt].segmentRole === 'hook') insertAt += 1;
  if (firstSell <= insertAt) return items;
  const reordered = [...items];
  const [moved] = reordered.splice(firstSell, 1);
  reordered.splice(insertAt, 0, moved);
  const next = resequence(reordered);
  patches.push({
    op: op.type,
    targetItemId: moved.id,
    field: 'order',
    before: items.map((item) => item.id),
    after: next.map((item) => item.id),
    reason: op.reason ?? '把商品/卖点信息前移'
  });
  return next;
}

function applyReorderSellingPoints(items: TimelineItem[], op: EditOperation, patches: EditPatch[]): TimelineItem[] {
  if (!op.newOrder?.length) return items;
  const positions = items.map((item, index) => ({ item, index })).filter((x) => x.item.segmentRole === 'selling_point');
  const byId = new Map(positions.map((x) => [x.item.id, x.item]));
  const ordered = op.newOrder.map((id) => byId.get(id)).filter((item): item is TimelineItem => Boolean(item));
  if (ordered.length !== positions.length) return items;
  const next = [...items];
  positions.forEach((slot, k) => {
    next[slot.index] = ordered[k];
  });
  const resequenced = resequence(next);
  patches.push({
    op: op.type,
    targetItemId: '*',
    field: 'order',
    before: items.map((item) => item.id),
    after: resequenced.map((item) => item.id),
    reason: op.reason ?? '调整卖点顺序'
  });
  return resequenced;
}

function applyRewrite(items: TimelineItem[], op: EditOperation, patches: EditPatch[]): TimelineItem[] {
  if (!op.newText?.trim()) return items; // copy rewrite needs LLM-provided text
  const role = targetRoleForType(op);
  let done = false;
  return items.map((item) => {
    if (done) return item;
    const hit = op.targetItemId ? item.id === op.targetItemId : role ? item.segmentRole === role : false;
    if (!hit) return item;
    done = true;
    const beforeScript = item.script;
    patches.push({
      op: op.type,
      targetItemId: item.id,
      field: 'script',
      before: beforeScript,
      after: op.newText!.trim(),
      reason: op.reason ?? '改写文案'
    });
    return { ...item, script: op.newText!.trim(), subtitles: splitIntoSubtitles(op.newText!.trim()) };
  });
}

function applyCaptionStyle(items: TimelineItem[], op: EditOperation, patches: EditPatch[]): TimelineItem[] {
  if (!op.newCaptionStyle) return items;
  const role = op.targetRole;
  return items.map((item) => {
    if (role && item.segmentRole !== role) return item;
    const before = item.packaging.captionStyle;
    if (before === op.newCaptionStyle) return item;
    patches.push({
      op: op.type,
      targetItemId: item.id,
      field: 'packaging.captionStyle',
      before,
      after: op.newCaptionStyle,
      reason: op.reason ?? '调整包装风格'
    });
    return { ...item, packaging: { ...item.packaging, captionStyle: op.newCaptionStyle! } };
  });
}

function applyOne(items: TimelineItem[], op: EditOperation, patches: EditPatch[]): TimelineItem[] {
  switch (op.type) {
    case 'reduce_caption_density':
    case 'increase_caption_density':
      return applyCaptionDensity(items, op, patches);
    case 'increase_pace':
    case 'decrease_pace':
      return applyPace(items, op, patches);
    case 'move_product_info_earlier':
      return applyMoveProductEarlier(items, op, patches);
    case 'reorder_selling_points':
      return applyReorderSellingPoints(items, op, patches);
    case 'strengthen_hook':
    case 'restyle_ending':
    case 'rewrite_script':
      return applyRewrite(items, op, patches);
    case 'change_caption_style':
      return applyCaptionStyle(items, op, patches);
    default:
      return items;
  }
}

export function applyEditOperations(timeline: TimelineItem[], operations: EditOperation[]): ApplyEditResult {
  let current = timeline.map(cloneItem);
  const patches: EditPatch[] = [];
  for (const op of operations) {
    current = applyOne(current, op, patches);
  }
  return { timeline: current, patches };
}

// ---------------------------------------------------------------------------
// Rule-based parser (fallback — structural ops only, no LLM)
// ---------------------------------------------------------------------------

export function parseEditInstructionRules(instruction: string): EditOperation[] {
  const text = (instruction ?? '').toLowerCase();
  const ops: EditOperation[] = [];
  if (/减少字幕|字幕.*少|少.*字幕|精简字幕/.test(text)) {
    ops.push({ type: 'reduce_caption_density', reason: '指令：减少字幕' });
  }
  if (/增加字幕|更多字幕|字幕.*多/.test(text)) {
    ops.push({ type: 'increase_caption_density', reason: '指令：增加字幕' });
  }
  if (/节奏|快一点|加快|更快|紧凑|快节奏/.test(text)) {
    ops.push({ type: 'increase_pace', reason: '指令：增强节奏感' });
  }
  if (/慢一点|放慢|舒缓|慢节奏/.test(text)) {
    ops.push({ type: 'decrease_pace', reason: '指令：放慢节奏' });
  }
  if (/商品.*提前|卖点.*提前|提前.*(商品|卖点)|信息前置|前置/.test(text)) {
    ops.push({ type: 'move_product_info_earlier', reason: '指令：把商品信息提前' });
  }
  if (/(开头|hook).*(抓|强|猛|吸引)|更抓人/.test(text)) {
    ops.push({ type: 'strengthen_hook', reason: '指令：开头更抓人（需 LLM 改写文案）' });
  }
  return ops;
}

// ---------------------------------------------------------------------------
// LLM parser (configured provider via openai-compatible SDK)
// ---------------------------------------------------------------------------

const EDIT_SYSTEM_PROMPT = `你是短视频时间线的编辑意图解析器。
用户会用一句话提出修改要求（例如"开头更抓人""减少字幕，增强节奏感""把商品信息提前"）。
你的任务：把这句话解析成一组结构化编辑操作（operations），只能从下列 type 中选：
- strengthen_hook：让开头更抓人（必须给出改写后的 newText）
- restyle_ending：改写结尾 CTA（必须给出 newText）
- rewrite_script：改写某一段文案（给 targetRole 或 targetItemId + newText）
- reduce_caption_density / increase_caption_density：减少/增加字幕密度
- increase_pace / decrease_pace：加快/放慢节奏
- move_product_info_earlier：把商品/卖点信息前移
- reorder_selling_points：调整卖点顺序（给 newOrder = 卖点 item id 数组）
- change_caption_style：改包装风格（给 newCaptionStyle）

规则：
- 文案改写类（strengthen_hook/restyle_ending/rewrite_script）必须给 newText，且要利用 ContentBrief 的真实卖点，不要写"3秒看懂""你是不是也遇到过"这类俗套。
- 结构类（节奏/字幕/重排）不需要 newText。
- 一句话可能对应多个操作。
- 只输出 JSON，不要 Markdown，不要解释。`;

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  }
  return trimmed;
}

type Client = ReturnType<typeof createOpenAICompatibleClient>;

export interface ParseEditLLMOptions {
  instruction: string;
  timeline: TimelineItem[];
  contentBrief?: unknown;
  clientFactory?: () => Client;
  model?: string;
}

export async function parseEditInstructionLLM(opts: ParseEditLLMOptions): Promise<EditOperation[]> {
  const client = (opts.clientFactory ?? createOpenAICompatibleClient)();
  const modelId = opts.model ?? process.env.LLM_MODEL;
  if (!modelId) {
    throw new Error('LLM_MODEL is required for parseEditInstructionLLM.');
  }
  const timelineView = opts.timeline.map((item) => ({
    id: item.id,
    role: item.segmentRole,
    script: item.script,
    subtitleLines: item.subtitles.length,
    durationSec: round(item.end - item.start)
  }));
  const userPrompt = `用户指令：${opts.instruction}

ContentBrief：
${JSON.stringify(opts.contentBrief ?? null)}

当前时间线（精简）：
${JSON.stringify(timelineView, null, 2)}

请输出 JSON：{"operations": [{"type": "...", "targetRole": "...", "newText": "...", "factor": 0.8, "newOrder": [...], "newCaptionStyle": "...", "reason": "..."}]}
只输出 JSON 本体。`;

  const response = await client.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: EDIT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3,
    // no response_format: this Ark/Doubao endpoint 400s on json_object; prompt + JSON parser handle it.
  });
  const raw = response.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(stripFence(raw));
  return EditPlanSchema.parse(parsed).operations;
}

// ---------------------------------------------------------------------------
// Orchestrator (try LLM, fall back to rules; always apply deterministically)
// ---------------------------------------------------------------------------

export async function applyNaturalLanguageEditWithFallback(
  opts: ParseEditLLMOptions
): Promise<NaturalLanguageEditResult> {
  try {
    const operations = await parseEditInstructionLLM(opts);
    const { timeline, patches } = applyEditOperations(opts.timeline, operations);
    return { timeline, patches, operations, editSource: 'llm_parsed' };
  } catch (error) {
    const operations = parseEditInstructionRules(opts.instruction);
    const { timeline, patches } = applyEditOperations(opts.timeline, operations);
    return {
      timeline,
      patches,
      operations,
      editSource: 'rule_based',
      warning: `LLM 解析失败，已退回规则解析（仅结构类操作）：${error instanceof Error ? error.message : String(error)}`
    };
  }
}
