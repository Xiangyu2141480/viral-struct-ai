// hyperframesSlotRenderer.ts — render ONE slot/beat with the HyperFrames Agent.
//
// This is the narrowed HyperFrames path: instead of authoring a whole 15–18s ad,
// it scopes the existing HyperFrames engine (hyperframesRenderFromContext) to a
// SINGLE beat — the one the user picked "HyperFrames 补全" for in the gap-fill
// studio. The Director authors the per-slot brief (buildGapResolutionOptions →
// the `hyperframes` option: editingGuidanceNL + copy + referencedAssetIds +
// durationMs); we fold that brief into a single-segment VideoEditContext and the
// real author→lint→render→critic loop produces a real MP4 for just that beat.
//
// Honesty: non-generative (real assets only — the render service's own honesty
// gate enforces ./assets/<file>); never throws — returns a structured result.

import type { ContentBrief, HyperframesOption, ViralStructureGraph } from '@viral-struct/shared';
import type { EditConstraints, VideoEditContext } from '@viral-struct/video-agent';
import { buildGapResolutionOptions } from './directorAgent';
import { translateCategoryEquivalents } from './directorAgent/categoryEquivalentTranslator';
import { matchSlotsWithFallback } from './slotMatcher';
import {
  buildContentBrief,
  buildStructureGraph,
  materialsToAssetCards,
} from './structAdapter/structAdapter';
import type { Material, SourceVideo, TargetProduct } from './structAdapter/structTypes';
import { hyperframesRenderFromContext } from './hyperframesRenderService';

export interface HyperframesSlotInput {
  sourceVideo: SourceVideo;
  materials: Material[];
  product: TargetProduct;
  slotId: string;
  productImageUrl?: string;
  onStage?: (stage: string) => void;
}

export interface HyperframesSlotResult {
  rendered: boolean;
  mediaUrl: string | null;
  source: 'llm' | 'mock';
  /** The Director-authored HyperFrames brief used for this beat (for the UI). */
  brief?: HyperframesOption;
  warnings: string[];
  lintErrors: string[];
}

function narrowAspectRatio(ar: string | undefined): EditConstraints['aspectRatio'] {
  return ar === '16:9' || ar === '1:1' ? ar : '9:16';
}

/** Scope a full structure graph to a SINGLE slot/segment so the author writes one beat. */
function singleBeatGraph(graph: ViralStructureGraph, slotId: string): ViralStructureGraph | null {
  const segment = graph.segments.find((s) => s.id === slotId);
  const shotSlot = graph.shotSlots.find((s) => s.id === slotId);
  if (!segment || !shotSlot) return null;
  return {
    ...graph,
    structureSummary: `单beat补全 · ${segment.role} · ${segment.purpose ?? ''}`.trim(),
    segments: [segment],
    shotSlots: [shotSlot],
    edges: [],
    boundaries: [],
    meta: { ...graph.meta, duration: Math.max(1, segment.duration ?? graph.meta.duration) },
  };
}

/** Fold the slot's HyperFrames copy into the product brief so the author writes for THIS beat. */
function scopeBrief(base: ContentBrief, hf: HyperframesOption | undefined): ContentBrief {
  if (!hf?.copy) return base;
  const bullets = (hf.copy.bullets ?? []).filter(Boolean);
  const headline = hf.copy.headline;
  const sellingPoints =
    bullets.length > 0
      ? bullets
      : headline
        ? [headline, ...base.sellingPoints].slice(0, 4)
        : base.sellingPoints;
  return {
    ...base,
    sellingPoints: sellingPoints.length > 0 ? sellingPoints : base.sellingPoints,
    cta: hf.copy.cta ?? base.cta,
  };
}

/**
 * Render ONE slot with the HyperFrames Agent. Builds the graph/assetCards/brief from
 * the UI model, asks the Director for this slot's HyperFrames brief, scopes a
 * single-beat VideoEditContext, and runs the real HyperFrames render. Never throws.
 */
export async function renderHyperframesForSlot(input: HyperframesSlotInput): Promise<HyperframesSlotResult> {
  const { sourceVideo, materials, product, slotId, productImageUrl, onStage } = input;
  const warnings: string[] = [];

  onStage?.('准备结构与素材');
  const graph = buildStructureGraph(sourceVideo);
  const assetCards = materialsToAssetCards(materials, sourceVideo, product);
  const contentBrief = buildContentBrief(product, sourceVideo);

  const beatGraph = singleBeatGraph(graph, slotId);
  if (!beatGraph) {
    return {
      rendered: false,
      mediaUrl: null,
      source: 'mock',
      warnings: [`找不到槽位 ${slotId}（结构可能已更新）`],
      lintErrors: [],
    };
  }

  onStage?.('导演撰写该槽位剪辑 brief');
  const match = (await matchSlotsWithFallback({ graph, assets: assetCards, boundaries: graph.boundaries })).matches.find(
    (m) => m.slotId === slotId,
  );
  const tier: 'matched' | 'partial' | 'gap' =
    match?.status === 'matched' ? 'matched' : match?.status === 'partial' ? 'partial' : 'gap';
  const shotSlot = beatGraph.shotSlots[0];
  // #76: the Director brief needs an LLM-translated category vocabulary (no deterministic
  // fallback). Best-effort: if LLM_MODEL is absent the brief is skipped and we render the
  // beat from the structure + real assets directly (still a real MP4 via the mock author).
  let hf: HyperframesOption | undefined;
  try {
    const vocab = await translateCategoryEquivalents({ contentBrief, assetCards });
    const { options } = buildGapResolutionOptions({
      slot: shotSlot,
      tier,
      contentBrief,
      referenceAssetIds: assetCards.map((c) => c.id),
      chosenAssetId: tier === 'gap' ? undefined : match?.assetId,
      vocab,
      sourceBannedTerms: [],
    });
    hf = options.find((o): o is HyperframesOption => o.id === 'hyperframes');
  } catch {
    warnings.push('HyperFrames brief 跳过（品类等价词表需要 LLM_MODEL）— 直接按结构与真实素材剪辑');
  }

  // Scope the assets the author may use to this slot's referenced ids; fall back to
  // every real-media card so the author always has real footage to edit (honesty
  // gate rejects invented imagery downstream).
  const referenced = new Set(hf?.referencedAssetIds ?? []);
  let contextCards = assetCards.filter((c) => referenced.has(c.id) && c.url);
  if (contextCards.length === 0) contextCards = assetCards.filter((c) => c.url);
  if (contextCards.length === 0) {
    warnings.push('该槽位无可用真实素材（素材均无 url）— HyperFrames 将以纯文字闪卡兜底');
  }

  const constraints: EditConstraints = {
    aspectRatio: narrowAspectRatio(beatGraph.meta.aspectRatio),
    allowAigc: false,
    allowHumanGeneration: false,
    allowedClaimSources: [],
    forbiddenClaims: [],
    maxDurationMs: hf?.durationMs,
  };
  const context: VideoEditContext = {
    projectId: `${sourceVideo.id}__${slotId}`,
    structureGraph: beatGraph,
    contentBrief: scopeBrief(contentBrief, hf),
    assetCards: contextCards,
    slotMatches: match ? [match] : [],
    materialGaps: [],
    constraints,
  };

  onStage?.('HyperFrames 剪辑中（作者→lint→渲染→评审）');
  const result = await hyperframesRenderFromContext(context);
  if (!result.rendered) {
    warnings.push(
      `HyperFrames 渲染未产出${result.lint.errors.length ? `（lint）：${result.lint.errors.join('；')}` : '（见服务日志）'}`,
    );
  } else if (result.source === 'mock') {
    warnings.push('HyperFrames：无 LLM 作者（LLM_MODEL 未配置）— 使用确定性兜底合成（真实素材，仍是真 MP4）');
  }

  return {
    rendered: result.rendered,
    mediaUrl: result.mediaUrl,
    source: result.source,
    brief: hf,
    warnings,
    lintErrors: result.lint.errors,
  };
}
