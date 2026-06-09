import { z } from 'zod';
import type { AssetCard, Boundary, ContentBrief, GapRepair, GapShootSpec, MaterialGap, ViralStructureGraph } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from './llmProvider';

export function planGapRepairs(
  gaps: MaterialGap[],
  _assets: AssetCard[],
  newContent?: ContentBrief,
  boundaries?: Boundary[]
): GapRepair[] {
  return gaps.map((gap) => {
    const repair = buildBaseRepair(gap, newContent);
    return annotateBoundary(annotateMotif(repair, gap), gap, boundaries);
  });
}

function buildBaseRepair(gap: MaterialGap, newContent?: ContentBrief): GapRepair {
  if (gap.type === 'missing_human_host' || gap.type === 'missing_face_closeup') {
    return {
      slotId: gap.slotId,
      strategy: 'ask_user_for_human_demo',
      explanation:
        '样例结构需要授权演示或讲解镜头来建立信任。优先让用户补充授权的演示素材；若无法补拍，则降级为产品特写 + 强字幕说明，不默认生成虚拟人物替代。'
    };
  }

  if (gap.type === 'missing_beauty_demo' || gap.type === 'missing_usage_action') {
    return {
      slotId: gap.slotId,
      strategy: 'hand_demo',
      explanation:
        '缺少真实操作或动作演示素材，优先建议补拍手部操作/使用过程；无法补拍时使用步骤卡、字幕和产品局部特写降级表达。'
    };
  }

  if (gap.type === 'missing_before_after') {
    return {
      slotId: gap.slotId,
      strategy: 'before_after_card',
      explanation:
        '缺少使用前后对比素材，使用对比卡或前后状态文字卡表达变化，并提示用户后续补充真实对比素材。'
    };
  }

  if (gap.type === 'missing_trust_element') {
    return {
      slotId: gap.slotId,
      strategy: 'trust_card',
      explanation:
        '缺少建立信任的口播、评价或证据元素，使用来源可控的卖点证据卡补足；无证据时避免强事实承诺。'
    };
  }

  if (gap.type === 'missing_scene_style') {
    return {
      slotId: gap.slotId,
      strategy: 'style_filter_suggestion',
      explanation:
        '当前素材缺少样例中的柔光、干净背景或高质感画面风格，建议使用统一滤镜、浅色背景、产品特写构图和标题条包装补足审美一致性。'
    };
  }

  if (gap.role === 'opening_attention') {
    return {
      slotId: gap.slotId,
      strategy: 'text_card',
      explanation: `缺少强视觉开头镜头，使用大标题卡 + 产品图推近制造 Hook。标题围绕「${newContent?.productName ?? '新商品'}」的核心痛点生成。`
    };
  }

  if (gap.role === 'usage_demo') {
    return {
      slotId: gap.slotId,
      strategy: 'crop_zoom',
      explanation: '缺少真实使用过程视频，使用现有手持图或产品图局部放大，并叠加步骤字幕和箭头贴纸。'
    };
  }

  if (gap.role === 'comparison') {
    return {
      slotId: gap.slotId,
      strategy: 'comparison_card',
      explanation: '缺少真实对比镜头，使用左右对比卡片表达普通方案与新商品的差异。'
    };
  }

  if (gap.role === 'cta_visual') {
    return {
      slotId: gap.slotId,
      strategy: 'cta_card',
      explanation: '缺少结尾 CTA 镜头，自动生成 CTA 卡片收束。'
    };
  }

  return {
    slotId: gap.slotId,
    strategy: 'caption_rewrite',
    explanation: '使用字幕和卖点卡补足画面信息。'
  };
}

function annotateBoundary(
  repair: GapRepair,
  gap: MaterialGap,
  boundaries?: Boundary[]
): GapRepair {
  if (!boundaries?.length) return repair;
  const segmentId = gap.affectedSegmentId;
  const touching = boundaries.find(
    (b) =>
      (b.from === segmentId || b.to === segmentId)
      && b.intensity === 'strong'
      && (b.transitionType === 'morph' || b.transitionType === 'wipe' || b.transitionType === 'dissolve')
  );
  if (!touching) return repair;
  return {
    ...repair,
    explanation: `[boundary:${touching.transitionType}/${touching.intensity}] 该缺口位于源片强转场边界，补全策略需保持原片节奏；${repair.explanation}`
  };
}

function annotateMotif(repair: GapRepair, gap: MaterialGap): GapRepair {
  const context = gap.motifContext;
  if (!context) return repair;

  const motionTokens = context.missingMotionTokens.length
    ? context.missingMotionTokens.join('/')
    : context.motionTokens.join('/');
  const targetHints = context.targetMotifHints.slice(0, 4).join('/');

  return {
    ...repair,
    explanation: `[motif:${context.motifType}] 缺口来自源片动势语法，需保留 ${motionTokens || 'motion grammar'}；目标语境可参考 ${targetHints || 'category-native visual cues'}。${repair.explanation}`
  };
}

// ---------------------------------------------------------------------------
// LLM gap shoot-spec generator
// source-of-truth prompt at prompts/migration/gap_spec_v0.md
// ---------------------------------------------------------------------------

const GAP_SPEC_SYSTEM_PROMPT = `你是一个短视频迁移系统中的「缺口拍摄规格生成器」。

你将看到：
A. 一个 MaterialGap 列表：每项含 slotId、role、severity、自然语言的 missing 描述、源片该段的 intent。
B. 新商品的 ContentBrief：产品名、目标人群、场景、卖点、CTA、风格偏好。
C. 当前手上已有的 AssetCard 清单（仅供"用现有素材降级"参考）。

对每一个 gap，输出三层拍摄规格：ideal / minimalAcceptable / alternativeIfNoShoot。

规则：
1. ideal 要具体到「时长 + 镜头 + 动作 + 设备建议」，不要写"高质量产品视频"这种废话。
2. minimalAcceptable 要比 ideal 弱一档但仍可用：更少镜头数、更短时长，或用连拍静图代替视频。
3. alternativeIfNoShoot 必须明确指出「用哪几张现有素材 + 加什么后期效果 + 字幕怎么写」。
4. 文案用第二人称，像是给运营/摄影师的工作指南。中文为主，英文蛇形命名只用于动效术语。
5. 只输出 JSON，不要 Markdown，不要解释。`;

const GapShootSpecResponseSchema = z.object({
  ideal: z.string().min(1),
  minimalAcceptable: z.string().min(1),
  alternativeIfNoShoot: z.string().min(1)
});

const GapShootSpecResponseMapSchema = z.record(GapShootSpecResponseSchema);

interface GapForPrompt {
  slotId: string;
  role: string;
  severity: string;
  missing: string;
  segmentIntent?: ViralStructureGraph['shotSlots'][number]['intent'];
}

interface AssetBrief {
  id: string;
  type: AssetCard['type'];
  primarySubject?: string;
  kinematicElements?: string[];
}

function summarizeAssetForGapPrompt(a: AssetCard): AssetBrief {
  return {
    id: a.id,
    type: a.type,
    primarySubject: a.visualContent?.primarySubject ?? a.spatialDescription,
    kinematicElements: a.visualContent?.kinematicElements
  };
}

function buildGapSpecUserPrompt(
  brief: ContentBrief,
  assets: AssetCard[],
  gaps: GapForPrompt[]
): string {
  return `ContentBrief:
${JSON.stringify(brief, null, 2)}

候选素材摘要（仅供 alternativeIfNoShoot 参考）：
${JSON.stringify(assets.map(summarizeAssetForGapPrompt), null, 2)}

待生成规格的缺口列表：
${JSON.stringify(gaps, null, 2)}

请输出 JSON：

{
  "<slotId>": {
    "ideal": "≤120字。完整拍摄方案，含时长/镜头/动作/设备。",
    "minimalAcceptable": "≤80字。降一档的方案。",
    "alternativeIfNoShoot": "≤120字。指明用哪张素材 + 后期 + 字幕。"
  }
}

约束：
- 输入 gap 的每个 slotId 都必须出现在输出里。
- 不要发明素材 id；只引用候选素材清单里的 id。
- 三个字段都不能为空字符串。

只输出 JSON 本体。`;
}

function stripJsonFenceGap(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  }
  return trimmed;
}

type Client = ReturnType<typeof createOpenAICompatibleClient>;

export interface PlanGapRepairsLLMOptions {
  gaps: MaterialGap[];
  assets: AssetCard[];
  newContent: ContentBrief;
  graph?: ViralStructureGraph;
  boundaries?: Boundary[];
  clientFactory?: () => Client;
  model?: string;
}

export async function planGapRepairsLLM(opts: PlanGapRepairsLLMOptions): Promise<GapRepair[]> {
  const { gaps, assets, newContent, graph, boundaries, clientFactory, model } = opts;
  if (gaps.length === 0) return [];

  const client = (clientFactory ?? createOpenAICompatibleClient)();
  const modelId = model ?? process.env.LLM_MODEL;
  if (!modelId) {
    throw new Error('LLM_MODEL is required for planGapRepairsLLM.');
  }

  const slotIndex = new Map(graph?.shotSlots.map((s) => [s.id, s]) ?? []);
  const gapsForPrompt: GapForPrompt[] = gaps.map((g) => ({
    slotId: g.slotId,
    role: g.role,
    severity: g.severity,
    missing: g.reason,
    segmentIntent: slotIndex.get(g.slotId)?.intent
  }));

  const response = await client.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: GAP_SPEC_SYSTEM_PROMPT },
      { role: 'user', content: buildGapSpecUserPrompt(newContent, assets, gapsForPrompt) }
    ],
    temperature: 0.4,
    // no response_format: this Ark/Doubao endpoint 400s on json_object; prompt + JSON parser handle it.
  });

  const raw = response.choices[0]?.message?.content ?? '';
  const parsed = JSON.parse(stripJsonFenceGap(raw));
  const validated = GapShootSpecResponseMapSchema.parse(parsed);

  return gaps.map((gap) => {
    const spec = validated[gap.slotId];
    if (!spec) {
      throw new Error(`LLM gap-spec missing slot ${gap.slotId}`);
    }
    const gapSpec: GapShootSpec = {
      ideal: spec.ideal,
      minimalAcceptable: spec.minimalAcceptable,
      alternativeIfNoShoot: spec.alternativeIfNoShoot
    };
    const baseRepair = buildBaseRepair(gap, newContent);
    const annotated = annotateBoundary(baseRepair, gap, boundaries);
    return { ...annotated, gapSpec };
  });
}

export type PlanGapRepairsResultWithSource = {
  repairs: GapRepair[];
  gapSpecSource: 'llm_generated' | 'rule_based';
  warning?: string;
};

export async function planGapRepairsWithFallback(opts: PlanGapRepairsLLMOptions): Promise<PlanGapRepairsResultWithSource> {
  try {
    const repairs = await planGapRepairsLLM(opts);
    return { repairs, gapSpecSource: 'llm_generated' };
  } catch (err) {
    const fallback = planGapRepairs(opts.gaps, opts.assets, opts.newContent, opts.boundaries);
    return {
      repairs: fallback,
      gapSpecSource: 'rule_based',
      warning: `LLM gap-spec failed (${err instanceof Error ? err.message : String(err)}); using rule-based fallback.`
    };
  }
}
