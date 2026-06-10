// fineScanMotifAdapter.ts — bridges FINE-SCAN output into the director's prompt generation.
//
// The fine scan (fine_scan.py) produces a rich per-block understanding — transferableMotifs (e.g.
// product_handling: "部件从散落汇聚组装成产品"), claimVisualizationPattern.pattern ("exploded_assembly"),
// productPresentation.revealMode — that captures the SOURCE's abstract structure far better than the rough
// caption alone. Until now that detail was display-only (screen 01); it never reached the gap-resolution
// prompts, so abstract motifs like 散落到聚合 / 部件展示 were lost. This adapter turns that detail into two
// signals the existing director machinery already consumes:
//   1. a SHORT source-abstract-structure hint appended to a segment's shot text → sharpens the per-slot
//      subtype inference (e.g. exploded_assembly → assembly_detail) and grounds the vocab translator;
//   2. a per-segment kinetic ViralMotifAnnotation when the fine scan signals an assembly/cascade beat → fires
//      the director's kinetic_assembly_reveal branch (由散到聚 → product-native equivalent), with motionTokens.

import type { MotionToken, MotifType, ViralMotifAnnotation } from '@viral-struct/shared';
import type { FineBlockDetail } from '../fineScanRunner';
import type { SourceVideo } from './structTypes';

/** Free-text signals that read as an assembly / scatter-to-converge / parts-come-together beat. */
const ASSEMBLY_SIGNAL =
  /exploded_assembly|assembl|converg|cascade|object_kinetic|particle_explosion|synchronized_object|汇聚|聚合|散落|组装|归位|拼合|部件|零件|拆分|组合/i;
const BURST_SIGNAL = /explos|burst|spectacle|爆发|飞溅|迸发|炸开/i;
const ENTRY_SIGNAL = /entry|entrance|drop[-_ ]?in|登场|入场|飞入|弹出/i;
const INTERACT_SIGNAL = /activation|interact|tap|press|swipe|激活|点击|操作|触发/i;

/** Pull a motionPattern off a transferableMotif (present in the JSON, omitted from the loose interface). */
function motionPatternOf(motif: { description?: string; motionPattern?: string }): string {
  return [motif.description, motif.motionPattern].filter(Boolean).join(' ');
}

/** All free-text the fine scan offers about a block's transferable abstract structure, lower-cased blob. */
function fineScanBlob(detail: FineBlockDetail): string {
  const motifs = (detail.transferableMotifs ?? []) as Array<{ description?: string; motionPattern?: string }>;
  return [
    detail.claimVisualizationPattern?.pattern,
    detail.productPresentation?.revealMode,
    ...motifs.map(motionPatternOf),
  ]
    .filter(Boolean)
    .join(' ');
}

/** A concise human hint ("可迁移结构：…") describing the source abstract structure of this block, or ''. */
export function fineScanAbstractHint(detail: FineBlockDetail): string {
  const motifs = (detail.transferableMotifs ?? []) as Array<{ description?: string; motifType?: string }>;
  const pieces = [
    ...motifs.map((m) => m.description).filter(Boolean),
    detail.claimVisualizationPattern?.pattern,
    detail.productPresentation?.revealMode,
  ].filter((p): p is string => Boolean(p));
  // De-dupe + cap so the enriched shot text stays readable.
  return Array.from(new Set(pieces)).slice(0, 3).join('；');
}

/** MotionTokens implied by the fine-scan blob (used by the director's cascade steps / bridge). */
function motionTokensFromBlob(blob: string): MotionToken[] {
  const tokens: MotionToken[] = [];
  if (ASSEMBLY_SIGNAL.test(blob)) tokens.push('component_cascade', 'chaos_to_order', 'assembly_completion', 'cta_reveal');
  if (BURST_SIGNAL.test(blob)) tokens.push('spectacle_burst');
  if (ENTRY_SIGNAL.test(blob)) tokens.push('dynamic_entry');
  if (INTERACT_SIGNAL.test(blob)) tokens.push('interaction_activation');
  return Array.from(new Set(tokens));
}

/** A minimal, schema-valid kinetic-assembly motif derived from the fine scan, or undefined when this block
 *  is not an assembly/cascade beat. transferVariables/preferredEquivalents stay empty — the category-equivalent
 *  vocab supplies the product-native actions; this only flips the slot into the kinetic branch. */
function deriveFineScanMotif(
  detail: FineBlockDetail,
  segmentId: string,
  targetCategory: string,
  blob: string,
): { motif?: ViralMotifAnnotation; motionTokens: MotionToken[] } {
  const motionTokens = motionTokensFromBlob(blob);
  if (!ASSEMBLY_SIGNAL.test(blob)) return { motif: undefined, motionTokens };
  const motifType: MotifType = 'kinetic_assembly_reveal';
  const evidence = (detail.transferableMotifs ?? [])
    .map((m) => m.description)
    .filter((d): d is string => Boolean(d))
    .slice(0, 3);
  const motif: ViralMotifAnnotation = {
    id: `fsmotif_${segmentId}`,
    segmentId,
    motifType,
    motionTokens: motionTokens.length ? motionTokens : ['component_cascade', 'chaos_to_order', 'assembly_completion', 'cta_reveal'],
    sanitizedIntent: '由散到聚的级联组装揭示，最后收束到产品与 CTA',
    transferVariables: [],
    bannedSourceTerms: [],
    targetCategoryMapping: {
      targetCategory: targetCategory || 'generic',
      preferredEquivalents: [],
      rejectedEquivalents: [],
      rationale: 'Migrated abstract assembly grammar from the fine-scan; product equivalents come from the vocab.',
    },
    evidence: evidence.length ? evidence : ['fine-scan assembly motif'],
    confidence: 0.7,
  };
  return { motif, motionTokens: motif.motionTokens };
}

export interface FineScanEnrichment {
  /** Source video with each fine-scanned segment's `shot` enriched by its abstract-structure hint. */
  sourceVideo: SourceVideo;
  /** Per-segment-id kinetic motif (only assembly/cascade beats). */
  motifBySegmentId: Map<string, ViralMotifAnnotation>;
  /** Per-segment-id motion tokens implied by the fine scan. */
  motionTokensBySegmentId: Map<string, MotionToken[]>;
  /** Count of segments that carried usable fine-scan detail (for warnings/telemetry). */
  enrichedSegmentCount: number;
}

/**
 * Fold the fine-scan detail map (segmentId → FineBlockDetail) into the source structure so the downstream
 * matcher + director see the abstract structure. Returns the (copied) enriched source video and per-segment
 * motif / motionToken maps. A no-op (returns the input + empty maps) when no detail is supplied.
 */
export function enrichSourceVideoWithFineScan(
  sourceVideo: SourceVideo,
  segmentDetails: Record<string, FineBlockDetail> | undefined,
  targetCategory: string,
): FineScanEnrichment {
  const motifBySegmentId = new Map<string, ViralMotifAnnotation>();
  const motionTokensBySegmentId = new Map<string, MotionToken[]>();
  if (!segmentDetails || Object.keys(segmentDetails).length === 0) {
    return { sourceVideo, motifBySegmentId, motionTokensBySegmentId, enrichedSegmentCount: 0 };
  }

  let enrichedSegmentCount = 0;
  const segments = sourceVideo.segments.map((seg) => {
    const detail = segmentDetails[seg.id];
    if (!detail) return seg;
    enrichedSegmentCount += 1;
    const blob = fineScanBlob(detail);
    const { motif, motionTokens } = deriveFineScanMotif(detail, seg.id, targetCategory, blob);
    if (motif) motifBySegmentId.set(seg.id, motif);
    if (motionTokens.length) motionTokensBySegmentId.set(seg.id, motionTokens);

    const hint = fineScanAbstractHint(detail);
    const enrichedShot = hint && !seg.shot.includes(hint) ? `${seg.shot}（可迁移结构：${hint}）` : seg.shot;
    return { ...seg, shot: enrichedShot };
  });

  return {
    sourceVideo: { ...sourceVideo, segments },
    motifBySegmentId,
    motionTokensBySegmentId,
    enrichedSegmentCount,
  };
}
