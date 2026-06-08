import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ContentBrief } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from './llmProvider';

/**
 * The aesthetic critic: a vision LLM looks at rendered keyframes of a HyperFrames ad and judges it
 * like a demanding client — hook impact, caption readability, composition, motion/energy, product
 * visibility, honesty — returning a score + concrete fixes the author can act on. Optional: if no
 * vision model is configured (or the call fails), the render service skips it (treats it as "ship").
 */

const CRITIC_TIMEOUT_MS = 60_000;
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function frameToDataUrl(filePath: string): string {
  const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'image/png';
  return `data:${mime};base64,${readFileSync(filePath).toString('base64')}`;
}

export interface CritiqueResult {
  verdict: 'ship' | 'revise';
  score: number; // 0..1
  issues: string[];
  fixes: string[];
}

export interface HyperframesCritic {
  critique(
    framePaths: string[],
    context: { contentBrief: ContentBrief; inspectIssues?: string[] }
  ): Promise<CritiqueResult>;
}

const SYSTEM_PROMPT = `你是病毒式短视频广告的资深质检与创意总监。你会按时间顺序看到一条 9:16 竖屏广告的若干关键帧，请像挑剔的甲方一样、只凭画面客观评审，并输出 JSON。
评审维度：① 钩子冲击力（前几帧是否 1 秒内抓人）；② 文字可读性（字幕清晰、未溢出/被裁切/压住主体）；③ 构图与层次（留白合理、主体突出、不杂乱、不大面积空白）；④ 动感与节奏暗示（画面有变化与张力，而非呆板平铺）；⑤ 产品/品牌呈现（真实产品清晰可辨）；⑥ 诚实（无伪造人物/数据/榜单/效果证据）。
score 为 0-1（综合"作为投放广告的好坏"）。verdict：score>=0.75 且无严重问题 → "ship"，否则 "revise"。
issues 列出具体问题；fixes 给出可直接作用于 HTML/GSAP 作品的修改建议（例："hook 文字过小且压住瓶身，放大字号并上移""第 3 帧纯色闪卡太空，加入产品或更强排版""转场太硬，加入白闪/缩放过渡""节奏太慢，缩短每个场景时长"）。
只输出 JSON：{"score":0.0,"verdict":"ship|revise","issues":["..."],"fixes":["..."]}`;

export function createDoubaoCritic(opts: { model?: string } = {}): HyperframesCritic {
  const client = createOpenAICompatibleClient();
  const modelId =
    opts.model ?? process.env.HYPERFRAMES_CRITIC_MODEL ?? process.env.ASSET_VLM_MODEL ?? process.env.LLM_MODEL;
  if (!modelId) {
    throw new Error('A vision model (HYPERFRAMES_CRITIC_MODEL / ASSET_VLM_MODEL / LLM_MODEL) is required for the critic.');
  }
  return {
    async critique(framePaths, context) {
      const imageParts = framePaths
        .slice(0, 6)
        .map((p) => ({ type: 'image_url' as const, image_url: { url: frameToDataUrl(p) } }));
      const userText = [
        `产品：${context.contentBrief.productName}`,
        `卖点：${(context.contentBrief.sellingPoints ?? []).join('、')}`,
        `CTA：${context.contentBrief.cta}`,
        context.inspectIssues?.length ? `已知结构问题(inspect)：${context.inspectIssues.join('; ')}` : '',
        '下面是按时间顺序的关键帧，请评审并只输出 JSON。'
      ]
        .filter(Boolean)
        .join('\n');
      // No response_format: some Doubao endpoints reject json_object on multimodal calls; parseCritique is tolerant.
      const response = await client.chat.completions.create(
        {
          model: modelId,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: [{ type: 'text', text: userText }, ...imageParts] }
          ],
          temperature: 0.3,
          max_tokens: 1200
        },
        { timeout: CRITIC_TIMEOUT_MS }
      );
      return parseCritique(response.choices[0]?.message?.content ?? '');
    }
  };
}

/** Tolerant parse of the critic's JSON. Defaults to a "ship" verdict when output is unusable. */
export function parseCritique(raw: string): CritiqueResult {
  const fallback: CritiqueResult = { verdict: 'ship', score: 1, issues: [], fixes: [] };
  let s = raw.trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i === -1 || j <= i) return fallback;
  try {
    const d = JSON.parse(s.slice(i, j + 1)) as Record<string, unknown>;
    const score = typeof d.score === 'number' ? Math.max(0, Math.min(1, d.score)) : 0.5;
    const issues = Array.isArray(d.issues) ? d.issues.map(String) : [];
    const fixes = Array.isArray(d.fixes) ? d.fixes.map(String) : [];
    const verdict = d.verdict === 'revise' || d.verdict === 'ship' ? (d.verdict as 'ship' | 'revise') : score >= 0.75 ? 'ship' : 'revise';
    return { verdict, score, issues, fixes };
  } catch {
    return fallback;
  }
}
