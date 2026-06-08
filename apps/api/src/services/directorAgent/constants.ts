/**
 * Shared safety constants for the Director Agent. Kept identical to the Asset Manager's
 * SAFE_NEGATIVE_PROMPT (missingMaterialBriefBuilder.ts) so synthesized fallback prompts and
 * transition frame-bridge job cards carry the same guardrails as ②'s briefs.
 */
export const SAFE_NEGATIVE_PROMPT = [
  'no text overlays',
  'no watermark',
  'no celebrity',
  'no other brands',
  'no price promotion',
  'no medical claims',
  'do not alter the product packaging or label',
  'avoid copying the source video composition exactly'
].join(', ');

/** Chinese negative prompt — used for Chinese-language AIGC job cards and frame bridges. */
export const SAFE_NEGATIVE_PROMPT_ZH = [
  '无文字叠加',
  '无水印',
  '无明星或公众人物',
  '无其它品牌',
  '无价格或促销承诺',
  '无医疗或功效宣称',
  '不改变产品包装与标签',
  '避免完全照搬源视频构图'
].join('，');

export const DEFAULT_ASPECT_RATIO = '9:16' as const;

/** Default share of transitions that should run as hyperframes (decision 2 / §7). */
export const DEFAULT_HYPERFRAMES_TRANSITION_WEIGHT = 0.8;
