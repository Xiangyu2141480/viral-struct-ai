import type { ContentBrief, TimelineItem } from '@viral-struct/shared';

export type TimelineEditType =
  | 'hook_stronger'
  | 'product_info_earlier'
  | 'reduce_subtitles'
  | 'increase_rhythm'
  | 'stronger_cta'
  | 'combined'
  | 'unsupported';

type AtomicEditType = Exclude<TimelineEditType, 'combined' | 'unsupported'>;

export interface TimelineEditChangedItem {
  itemId: string;
  changes: string[];
  before: TimelineItem;
  after: TimelineItem;
}

export interface TimelineEditResult {
  updatedTimeline: TimelineItem[];
  patchSummary: string;
  changedItems: TimelineEditChangedItem[];
  editType: TimelineEditType;
  appliedEditTypes: AtomicEditType[];
  rationale: string;
  warnings: string[];
  supportedEditSuggestions: string[];
}

export interface TimelineEditInput {
  instruction: string;
  timeline: TimelineItem[];
  contentBrief?: Partial<ContentBrief>;
}

const supportedEditSuggestions = [
  '开头更抓人',
  '商品信息提前',
  '减少字幕',
  '增强节奏感',
  'CTA 更强 / 购买引导更明确'
];

export function applyTimelineEdit(input: TimelineEditInput): TimelineEditResult {
  const instruction = normalizeInstruction(input.instruction);
  const original = cloneTimeline(input.timeline);
  let updated = cloneTimeline(input.timeline);
  const brief = normalizeBrief(input.contentBrief);
  const applied = detectEditTypes(instruction);

  if (!updated.length) {
    return {
      updatedTimeline: [],
      patchSummary: 'Timeline 为空，未执行修改。',
      changedItems: [],
      editType: 'unsupported',
      appliedEditTypes: [],
      rationale: '没有可修改的 timeline item。',
      warnings: ['Timeline 为空。'],
      supportedEditSuggestions
    };
  }

  for (const editType of applied) {
    updated = applyAtomicEdit(updated, editType, brief);
  }

  if (!applied.length) {
    return {
      updatedTimeline: original,
      patchSummary: '未识别该编辑指令，已保持 timeline 不变。',
      changedItems: [],
      editType: 'unsupported',
      appliedEditTypes: [],
      rationale: '当前 rule-based patch 支持 hook、商品信息、字幕、节奏和 CTA 五类高频改片指令。',
      warnings: [`未识别指令：${input.instruction || 'empty instruction'}`],
      supportedEditSuggestions
    };
  }

  const changedItems = buildChangedItems(original, updated);
  return {
    updatedTimeline: updated,
    patchSummary: buildPatchSummary(applied, changedItems),
    changedItems,
    editType: applied.length === 1 ? applied[0] : 'combined',
    appliedEditTypes: applied,
    rationale: buildRationale(applied),
    warnings: changedItems.length ? [] : ['指令已识别，但没有找到可安全修改的 timeline item。'],
    supportedEditSuggestions
  };
}

function applyAtomicEdit(
  timeline: TimelineItem[],
  editType: AtomicEditType,
  brief: Required<Pick<ContentBrief, 'productName' | 'sellingPoints' | 'cta' | 'scenario'>>
): TimelineItem[] {
  switch (editType) {
    case 'hook_stronger':
      return applyHookStronger(timeline, brief);
    case 'product_info_earlier':
      return applyProductInfoEarlier(timeline, brief);
    case 'reduce_subtitles':
      return applyReduceSubtitles(timeline);
    case 'increase_rhythm':
      return applyIncreaseRhythm(timeline);
    case 'stronger_cta':
      return applyStrongerCta(timeline, brief);
  }
}

function applyHookStronger(
  timeline: TimelineItem[],
  brief: Required<Pick<ContentBrief, 'productName' | 'sellingPoints' | 'scenario'>>
): TimelineItem[] {
  const updated = cloneTimeline(timeline);
  const first = updated[0];
  const firstSellingPoint = brief.sellingPoints[0] ?? '核心卖点';
  first.script = `3 秒先看：${brief.productName}在${brief.scenario}里怎么做到${firstSellingPoint}。`;
  first.subtitles = splitSubtitle(first.script, 8);
  first.visualAction = `${first.visualAction}，开场直接推近产品和结果感。`;
  first.packaging = {
    ...first.packaging,
    captionStyle: 'click_large_bottom_bold',
    cardType: 'title_card',
    transition: 'zoom_in',
    motion: 'push_in'
  };
  setDuration(updated, 0, Math.max(1.2, durationOf(first) * 0.72));
  return reflowTimeline(updated);
}

function applyProductInfoEarlier(
  timeline: TimelineItem[],
  brief: Required<Pick<ContentBrief, 'productName' | 'sellingPoints'>>
): TimelineItem[] {
  const updated = cloneTimeline(timeline);
  const productIndex = findProductInfoIndex(updated, brief);
  const targetIndex = productIndex > -1 ? productIndex : Math.min(1, updated.length - 1);
  const item = updated[targetIndex];
  item.script = `${brief.productName}先看核心卖点：${brief.sellingPoints.slice(0, 2).join('，') || '重点利益明确'}。${stripLeadingProduct(item.script, brief.productName)}`;
  item.subtitles = splitSubtitle(item.script, 10);
  item.packaging = {
    ...item.packaging,
    captionStyle: 'conversion_large_bottom_bold',
    cardType: item.packaging.cardType ?? 'selling_point_card',
    transition: item.packaging.transition ?? 'push'
  };

  if (targetIndex > 1) {
    const [moved] = updated.splice(targetIndex, 1);
    updated.splice(1, 0, moved);
  }

  return reflowTimeline(updated);
}

function applyReduceSubtitles(timeline: TimelineItem[]): TimelineItem[] {
  return cloneTimeline(timeline).map((item) => {
    const essentialCard = item.segmentRole === 'hook' || item.segmentRole === 'cta';
    return {
      ...item,
      subtitles: item.subtitles.length > 1 ? [item.subtitles.join('').slice(0, 18)] : item.subtitles,
      packaging: {
        ...item.packaging,
        captionStyle: 'premium_center_light',
        cardType: essentialCard ? item.packaging.cardType : undefined
      }
    };
  });
}

function applyIncreaseRhythm(timeline: TimelineItem[]): TimelineItem[] {
  const updated = cloneTimeline(timeline).map((item, index) => ({
    ...item,
    visualAction: `${item.visualAction}，节奏压缩并贴近强拍切换。`,
    packaging: {
      ...item.packaging,
      transition: 'quick_cut' as const,
      motion: index % 2 === 0 ? 'push_in' as const : 'crop_zoom' as const
    }
  }));

  for (let index = 0; index < updated.length; index += 1) {
    setDuration(updated, index, Math.max(0.8, durationOf(updated[index]) * 0.86));
  }

  return reflowTimeline(updated);
}

function applyStrongerCta(
  timeline: TimelineItem[],
  brief: Required<Pick<ContentBrief, 'productName' | 'cta'>>
): TimelineItem[] {
  const updated = cloneTimeline(timeline);
  const ctaIndex = findLastIndex(updated, (item) => item.segmentRole === 'cta');
  const index = ctaIndex >= 0 ? ctaIndex : updated.length - 1;
  const item = updated[index];
  item.script = `立即行动：${brief.cta || `现在就选择${brief.productName}`} 现在就下单，把${brief.productName}加入你的下一条内容。`;
  item.subtitles = splitSubtitle(item.script, 10);
  item.visualAction = `${item.visualAction}，结尾锁定产品和购买引导。`;
  item.packaging = {
    ...item.packaging,
    captionStyle: 'conversion_large_bottom_bold',
    cardType: 'cta_card',
    transition: 'zoom_in',
    motion: 'push_in'
  };
  return updated;
}

function detectEditTypes(instruction: string): AtomicEditType[] {
  const edits: AtomicEditType[] = [];
  if (hasAny(instruction, ['开头更抓人', '开头抓人', '开头更强', '开头吸引', 'hook', '前3秒', '前三秒'])) {
    edits.push('hook_stronger');
  }
  if (hasAny(instruction, ['商品信息提前', '商品提前', '卖点提前', '信息提前', '产品提前', '商品信息前置', '卖点前置'])) {
    edits.push('product_info_earlier');
  }
  if (hasAny(instruction, ['减少字幕', '字幕更少', '少字幕', '降低字幕', '字幕密度低'])) {
    edits.push('reduce_subtitles');
  }
  if (hasAny(instruction, ['增强节奏', '节奏更快', '增强节奏感', '快节奏', '加快节奏', '更有节奏'])) {
    edits.push('increase_rhythm');
  }
  if (hasAny(instruction, ['cta', '购买引导', '行动号召', '下单', '转化更强', '引导更明确'])) {
    edits.push('stronger_cta');
  }
  return Array.from(new Set(edits));
}

function buildPatchSummary(applied: AtomicEditType[], changedItems: TimelineEditChangedItem[]): string {
  const labels: Record<AtomicEditType, string> = {
    hook_stronger: '开头更抓人',
    product_info_earlier: '商品信息提前',
    reduce_subtitles: '减少字幕',
    increase_rhythm: '增强节奏感',
    stronger_cta: 'CTA 更强'
  };
  return `${applied.map((edit) => labels[edit]).join('，')}：已修改 ${changedItems.length} 个 timeline item。`;
}

function buildRationale(applied: AtomicEditType[]): string {
  const rationales: Record<AtomicEditType, string> = {
    hook_stronger: '首段改成结果前置和强标题包装，并压缩开场时长。',
    product_info_earlier: '把商品名和核心卖点前移到更靠前的 timeline item。',
    reduce_subtitles: '降低字幕行数和非必要卖点卡，减少信息压迫。',
    increase_rhythm: '压缩 item 时长并统一 quick cut / motion 建议。',
    stronger_cta: '强化结尾行动指令，让购买引导更明确。'
  };
  return applied.map((edit) => rationales[edit]).join(' ');
}

function buildChangedItems(before: TimelineItem[], after: TimelineItem[]): TimelineEditChangedItem[] {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  return after.flatMap((item, orderIndex) => {
    const previous = beforeById.get(item.id);
    if (!previous) return [];
    const changes = describeChanges(previous, item, before.findIndex((beforeItem) => beforeItem.id === item.id), orderIndex);
    if (!changes.length) return [];
    return [{ itemId: item.id, changes, before: previous, after: item }];
  });
}

function describeChanges(before: TimelineItem, after: TimelineItem, beforeIndex: number, afterIndex: number): string[] {
  const changes: string[] = [];
  if (beforeIndex !== afterIndex) changes.push(`order ${beforeIndex + 1} -> ${afterIndex + 1}`);
  if (before.script !== after.script) changes.push('script');
  if (before.visualAction !== after.visualAction) changes.push('visualAction');
  if (before.start !== after.start || before.end !== after.end) changes.push('timing');
  if (before.subtitles.join('|') !== after.subtitles.join('|')) changes.push('subtitles');
  if (JSON.stringify(before.packaging) !== JSON.stringify(after.packaging)) changes.push('packaging');
  return changes;
}

function cloneTimeline(timeline: TimelineItem[]): TimelineItem[] {
  return timeline.map((item) => ({
    ...item,
    subtitles: [...item.subtitles],
    packaging: { ...item.packaging },
    ...(item.repair ? { repair: { ...item.repair, gapSpec: item.repair.gapSpec ? { ...item.repair.gapSpec } : undefined } } : {}),
    ...(item.treatmentSpec ? { treatmentSpec: { ...item.treatmentSpec } } : {})
  }));
}

function normalizeInstruction(instruction: string | undefined): string {
  return (instruction ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeBrief(contentBrief: Partial<ContentBrief> | undefined): Required<Pick<ContentBrief, 'productName' | 'sellingPoints' | 'cta' | 'scenario'>> {
  return {
    productName: contentBrief?.productName?.trim() || '新商品',
    sellingPoints: contentBrief?.sellingPoints?.filter(Boolean) ?? [],
    cta: contentBrief?.cta?.trim() || '',
    scenario: contentBrief?.scenario?.trim() || '目标场景'
  };
}

function hasAny(input: string, patterns: string[]): boolean {
  return patterns.some((pattern) => input.includes(pattern.toLowerCase().replace(/\s+/g, '')));
}

function durationOf(item: TimelineItem): number {
  return Math.max(0.1, item.end - item.start);
}

function setDuration(timeline: TimelineItem[], index: number, duration: number): void {
  const item = timeline[index];
  item.end = Number((item.start + duration).toFixed(2));
}

function reflowTimeline(timeline: TimelineItem[]): TimelineItem[] {
  let cursor = timeline[0]?.start ?? 0;
  return timeline.map((item) => {
    const duration = durationOf(item);
    const start = Number(cursor.toFixed(2));
    const end = Number((start + duration).toFixed(2));
    cursor = end;
    return { ...item, start, end };
  });
}

function splitSubtitle(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += maxChars) {
    chunks.push(text.slice(index, index + maxChars));
  }
  return chunks;
}

function findProductInfoIndex(
  timeline: TimelineItem[],
  brief: Required<Pick<ContentBrief, 'productName' | 'sellingPoints'>>
): number {
  const keywords = [brief.productName, ...brief.sellingPoints, '卖点', '商品', '产品'].filter(Boolean);
  return timeline.findIndex((item) => item.segmentRole === 'selling_point' || keywords.some((keyword) => item.script.includes(keyword)));
}

function stripLeadingProduct(script: string, productName: string): string {
  return script.replace(new RegExp(`^${escapeRegExp(productName)}[：:，,。\\s]*`), '');
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
