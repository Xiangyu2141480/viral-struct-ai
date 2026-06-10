// structAdapter.ts — bidirectional bridge between the StructMigrate UI model
// (structTypes.ts) and the @viral-struct/shared protocol artifacts.
//
// FORWARD  (shared → UI): graph + analysis → SourceVideo; AssetCard[] → Material[];
//          SlotMatch/MaterialGap/GapRepair → Diagnosis; TimelineItem[] → TimelineSeg[].
// REVERSE  (UI → shared): SourceVideo → ViralStructureGraph (incl. boundaries);
//          Material[] → AssetCard[]; TargetProduct → ContentBrief; TimelineSeg[] → TimelineItem[].
//
// The reverse builders are ported from the proven frontend adapter
// apps/web/app/_struct/api/assetManager.ts (which already drives the LIVE
// /api/assets/manager/coverage call), moved server-side so all heavy
// shared↔UI translation lives in one place.

import type {
  AigcOption,
  AssetCard,
  Boundary,
  ContentBrief,
  CreativeIngredientType,
  GapRepair,
  GapRepairStrategy,
  GapResolutionOption,
  GapResolutionOptionId,
  HyperframesOption,
  MaterialGap,
  ReshootOption,
  SegmentRole,
  ShotSlotNode,
  ShotSlotRole,
  SlotMatch,
  TargetDurationMode,
  TimelineItem,
  ViralStructureGraph,
} from '@viral-struct/shared';
import type {
  CompileVersion,
  Diagnosis,
  DiagnosisFill,
  Material,
  ResolutionMethod,
  RoleKey,
  SourceSegment,
  SourceVideo,
  StateKey,
  TimelineSeg,
  Transition,
  TransitionTypeKey,
  TargetProduct,
} from './structTypes';

/** The real per-gap 3-option resolution menu the Director Agent produced for one slot. */
export interface SlotGapResolution {
  options: GapResolutionOption[];
  recommendedOptionId: GapResolutionOptionId;
}

/* ─── small helpers ─────────────────────────────────────────── */

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number((value ?? 0).toFixed(3))));
}
function round01(value: number): number {
  return Math.max(0, Number((value ?? 0).toFixed(1)));
}
function tokenizeSubject(subject: string): string[] {
  const tokens = subject
    .split(/[\/\s·,，+]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.length ? tokens : [subject];
}

const PHOTO_PALETTE = ['#3d4a3a', '#414b4d', '#5d3b2b', '#4d3a2a', '#3a3a47', '#46402f', '#2f3a46'];

/* ─── role maps (UI ↔ shared) ───────────────────────────────── */

const ROLE_TO_SHOTSLOT: Record<RoleKey, ShotSlotRole> = {
  hook: 'opening_attention',
  pain: 'benefit_visual',
  emotion: 'usage_demo',
  product: 'product_closeup',
  compare: 'comparison',
  social: 'testimonial',
  cta: 'cta_visual',
};

const SHOTSLOT_TO_ROLE: Record<string, RoleKey> = {
  opening_attention: 'hook',
  benefit_visual: 'pain',
  usage_demo: 'emotion',
  product_closeup: 'product',
  comparison: 'compare',
  testimonial: 'social',
  cta_visual: 'cta',
};

const ROLE_TO_SEGMENT_ROLE: Record<RoleKey, SegmentRole> = {
  hook: 'hook',
  pain: 'pain_point',
  emotion: 'usage',
  product: 'selling_point',
  compare: 'comparison',
  social: 'proof',
  cta: 'cta',
} as Record<RoleKey, SegmentRole>;

const SEGMENT_ROLE_TO_ROLE: Record<string, RoleKey> = {
  hook: 'hook',
  pain_point: 'pain',
  problem: 'pain',
  empathy: 'emotion',
  usage: 'emotion',
  emotion: 'emotion',
  selling_point: 'product',
  product: 'product',
  comparison: 'compare',
  value: 'compare',
  proof: 'social',
  social_proof: 'social',
  trust: 'social',
  cta: 'cta',
};

function shotSlotRoleToRole(role: string | undefined): RoleKey {
  return (role && SHOTSLOT_TO_ROLE[role]) || 'product';
}
function segmentRoleToRole(role: string | undefined): RoleKey {
  return (role && SEGMENT_ROLE_TO_ROLE[role]) || 'product';
}

// Canonical role → segment-id fallback (the standard 7-beat structure).
// Used to suggest a slot for freshly uploaded materials before /materials/match
// refines it against the user's actual structure.
const CANONICAL_ROLE_SLOT: Record<RoleKey, string> = {
  hook: 's1', pain: 's2', emotion: 's3', product: 's4', compare: 's5', social: 's6', cta: 's7',
};

function roleToDim(role: RoleKey): string {
  return role === 'pain' ? 'trust' : role;
}
function importanceForRole(role: RoleKey): 1 | 2 | 3 | 4 | 5 {
  if (role === 'hook' || role === 'product' || role === 'cta') return 5;
  if (role === 'pain' || role === 'social') return 4;
  return 3;
}
function cameraForRole(role: RoleKey): NonNullable<ShotSlotNode['requiredAsset']['camera']> {
  if (role === 'hook' || role === 'product') return 'closeup';
  if (role === 'emotion') return 'medium';
  if (role === 'compare' || role === 'social') return 'wide';
  if (role === 'pain') return 'macro';
  return 'unknown';
}
function motionForRole(role: RoleKey): NonNullable<ShotSlotNode['requiredAsset']['motion']> {
  if (role === 'hook') return 'fast_cut';
  if (role === 'emotion') return 'hand_operation';
  if (role === 'product') return 'push_in';
  if (role === 'cta') return 'static';
  return 'unknown';
}

/* ─── transition vocab (UI ↔ shared boundary) ───────────────── */

export function boundaryTypeToUi(transitionType: string | undefined, alignedToBeat?: boolean): TransitionTypeKey {
  if (alignedToBeat) return '卡点';
  switch (transitionType) {
    case 'fade':
    case 'dissolve':
      return '叠化';
    case 'morph':
    case 'wipe':
      return '推镜';
    case 'cut':
    case 'unknown':
    default:
      return '硬切';
  }
}
function uiTypeToBoundaryType(type: TransitionTypeKey): Boundary['transitionType'] {
  switch (type) {
    case '叠化':
      return 'dissolve';
    case '推镜':
      return 'morph';
    case '卡点':
      return 'cut';
    case '硬切':
    default:
      return 'cut';
  }
}

/** techniqueTag → shared transitionType (substring match, first table hit wins).
 *  Ported verbatim from scripts/extract_structure_graph.py:_classify_technique_tags
 *  so the /scan/:videoId/boundary route classifies a single boundary's micro-scan
 *  result identically to the offline graph build. Returns 'unknown' on no match. */
const TAG_TO_TRANSITION: ReadonlyArray<readonly [string, string]> = [
  ['fade', 'fade'],
  ['dissolve', 'dissolve'],
  ['wipe', 'wipe'],
  ['cut', 'cut'],
  ['morph', 'morph'],
  ['motion_blur', 'morph'],
  ['camera_move', 'morph'],
  ['zoom', 'morph'],
  ['pan', 'morph'],
  ['object_fragmentation', 'morph'],
  ['object_reassembly', 'morph'],
  ['object_manipulation', 'morph'],
];
export function techniqueTagsToBoundaryType(tags: ReadonlyArray<string> | undefined): string {
  if (!tags?.length) return 'unknown';
  const normalized = tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase());
  for (const [predicate, ttype] of TAG_TO_TRANSITION) {
    if (normalized.some((tag) => tag.includes(predicate))) return ttype;
  }
  return 'unknown';
}

/** Build one canonical UI Transition from a (from→to) seam of a known type.
 *  Single source of truth for transition-seam fields, shared by graphToTransitions
 *  (offline graph build) and the /scan/:videoId/boundary route (on-demand re-scan of
 *  ONE seam). `evidence`/`scanned` carry the honest provenance from a boundary scan. */
export function boundaryToUiTransition(args: {
  id: string;
  from: string;
  to: string;
  at: number;
  type: TransitionTypeKey;
  evidence?: string;
  scanned?: boolean;
}): Transition {
  const isCut = args.type === '硬切';
  return {
    id: args.id,
    from: args.from,
    to: args.to,
    at: round01(args.at),
    type: args.type,
    applied: args.type,
    state: isCut ? 'weakly' : 'filled',
    upgradable: isCut,
    dur: isCut ? 0 : 0.3,
    intendedDur: isCut ? 0 : 0.3,
    need: isCut ? ['硬切'] : [`${args.from} 出帧`, `${args.to} 入帧`],
    have: isCut ? ['硬切'] : [`${args.from} 出帧`, `${args.to} 入帧`],
    gap_reason: isCut
      ? args.scanned
        ? 'Boundary Scan 确认此处为硬切，弱满足是它的天花板，不是缺口'
        : '原结构此处即为硬切，弱满足是它的天花板，不是缺口'
      : '—',
    impact: { dim: 'rhythm', pct: 0, note: isCut ? '硬切节奏顿挫' : '过渡成立，节奏平稳' },
    fix: null,
    note: `${args.from.toUpperCase()} → ${args.to.toUpperCase()}`,
    ...(args.evidence ? { evidence: args.evidence } : {}),
  };
}

/* ============================================================
   FORWARD · shared → UI
   ============================================================ */

/**
 * ViralStructureGraph (+ optional analysis meta) → UI SourceVideo.
 *
 * T6: rhythm/packaging fields that the source analysis did NOT detect are filled with
 * NEUTRAL sentinels (bgm_bpm:0 → UI shows '节拍未检测'; captions:'—'; avg_shot:0;
 * hook_density/caption_density:'—') rather than fabricated values shown as real analysis.
 * When `opts.defaultedFields` is supplied, the names of any sentinel-filled fields are
 * pushed into it so the caller can surface an honest "未检测" warning.
 */
export function graphToSourceVideo(
  graph: ViralStructureGraph,
  opts: { videoId?: string; title?: string; defaultedFields?: string[] } = {},
): SourceVideo {
  const defaulted = opts.defaultedFields;
  const markDefaulted = (field: string) => {
    if (defaulted && !defaulted.includes(field)) defaulted.push(field);
  };

  const segments: SourceSegment[] = graph.segments.map((seg, i) => {
    const role = segmentRoleToRole(seg.role as string);
    const start = round01(seg.start ?? 0);
    const end = round01(seg.end ?? start + (seg.duration ?? 0));
    return {
      id: seg.id ?? `s${i + 1}`,
      role,
      start,
      end,
      label: seg.purpose ?? `${role} 段`,
      // `shot` = the source's VISUAL description (graph.caption), NOT the migration
      // rule. The migration directive lives in its own `transferRule` field below so
      // the source-analysis screen never shows "替换为新商品…" as if it were the shot.
      shot: seg.caption ?? seg.narration ?? seg.purpose ?? '',
      caption: seg.caption ?? seg.narration ?? seg.purpose ?? '',
      transferRule: seg.transferRule,
    };
  });

  // Rhythm — only use detected values; otherwise neutral sentinels (no invention).
  const avgShot = graph.rhythm?.avgShotDuration;
  if (avgShot == null) markDefaulted('avg_shot');
  const cutFrequency = graph.rhythm?.cutFrequency;
  // cuts: segment count is a real lower bound (the structure has this many seams),
  // not an invented "high=16/medium=9" tier. Only the tier guess is dropped.
  const detectedBpm = extractBpm(graph.rhythm?.pattern);
  if (detectedBpm == null) markDefaulted('bgm_bpm');
  const captionDensity = graph.packaging?.captionDensity;
  if (captionDensity == null) markDefaulted('caption_density');
  if (cutFrequency == null) markDefaulted('hook_density');

  // Packaging — '—' sentinel when undetected; do NOT fabricate '白底黑字' captions.
  const titleTemplate = graph.packaging?.titleStyle;
  if (titleTemplate == null) markDefaulted('title_template');
  const detectedCardTypes = (graph.packaging?.cardTypes ?? []).join(' / ');
  if (!detectedCardTypes) markDefaulted('captions');
  const bgmPattern = graph.rhythm?.pattern;
  if (bgmPattern == null) markDefaulted('bgm');
  const coverStyle = graph.packaging?.coverStyle;
  if (coverStyle == null) markDefaulted('cover');

  return {
    id: opts.videoId ?? 'struct_source',
    title: opts.title ?? graph.structureSummary ?? '样例结构',
    platform: '—',
    duration: round01(graph.meta?.duration ?? segments[segments.length - 1]?.end ?? 0),
    // Engagement stats are NOT measured from pixels — kept neutral & flagged honestly.
    views: '—',
    likes: '—',
    finish_rate: 0,
    ctr: 0,
    cvr: 0,
    protocol_version: `StructureIR.${graph.schemaVersion ?? 'v1'}`,
    segments,
    transitions: graphToTransitions(graph, segments),
    rhythm: {
      avg_shot: avgShot != null ? round01(avgShot) : 0,
      cuts: segments.length,
      hook_density: cutFrequency === 'high' ? '高' : cutFrequency === 'medium' || cutFrequency === 'low' ? '中' : '—',
      bgm_bpm: detectedBpm ?? 0,
      caption_density: captionDensity === 'high' ? '高' : captionDensity === 'low' ? '低' : captionDensity === 'medium' ? '中' : '—',
    },
    packaging: {
      title_template: titleTemplate ?? '—',
      captions: detectedCardTypes || '—',
      bgm: bgmPattern ?? '—',
      cover: coverStyle ?? '—',
    },
  };
}

function extractBpm(pattern?: string): number | null {
  if (!pattern) return null;
  const m = pattern.match(/(\d{2,3})\s*BPM/i);
  return m ? Number(m[1]) : null;
}

/** Derive UI transition seams from graph.boundaries, or synthesize hard-cut seams. */
export function graphToTransitions(graph: ViralStructureGraph, segments: SourceSegment[]): Transition[] {
  const boundaries = graph.boundaries ?? [];
  if (boundaries.length > 0) {
    return boundaries.map((b, i) => {
      const toSeg = segments.find((s) => s.id === b.to);
      return boundaryToUiTransition({
        id: b.id ?? `t${i + 1}`,
        from: b.from,
        to: b.to,
        at: toSeg?.start ?? 0,
        type: boundaryTypeToUi(b.transitionType, b.alignedToBeat),
      });
    });
  }
  // Synthesize hard-cut seams between consecutive segments (honest floor).
  return segments.slice(1).map((seg, i) => ({
    id: `t${i + 1}`,
    from: segments[i].id,
    to: seg.id,
    at: round01(seg.start),
    type: '硬切',
    applied: '硬切',
    state: 'weakly',
    upgradable: false,
    dur: 0,
    intendedDur: 0,
    need: ['硬切'],
    have: ['硬切'],
    gap_reason: '结构未标注转场，默认硬切兜底（弱满足）',
    impact: { dim: 'rhythm', pct: 0, note: '硬切兜底，无损失' },
    fix: null,
    note: `${segments[i].id.toUpperCase()} → ${seg.id.toUpperCase()}`,
  }));
}

/** AssetCard[] → UI Material[] (slot suggested from suitable role, refined later by /match). */
export function assetCardsToMaterials(cards: AssetCard[]): Material[] {
  return cards.map((card, i) => {
    const role = shotSlotRoleToRole(card.suitableSlots?.[0] ?? card.candidateSlotRoles?.[0]?.role);
    const subject =
      card.spatialDescription ??
      card.text ??
      (card.detectedObjects?.length ? card.detectedObjects.join(' · ') : undefined) ??
      card.id;
    const isText = card.type === 'text';
    const seg = card.segmentSource;
    // A sliced video clip (PR#73) carries segmentSource; treat it as a 'video' material
    // and preserve its provenance/timing so the produce renderer can resolve real clips.
    const kind: Material['kind'] = isText ? 'text' : card.type === 'video' ? 'video' : 'photo';
    const material: Material = {
      id: card.id,
      kind,
      subject,
      slot: isText ? null : CANONICAL_ROLE_SLOT[role],
      quality: clamp01(card.qualityScore ?? 0.6),
      color: isText ? undefined : PHOTO_PALETTE[i % PHOTO_PALETTE.length],
      // Always carry the real file/asset url (AssetCard.url = file path from assetAnalyzer).
      url: card.url,
    };
    if (seg) {
      return {
        ...material,
        kind: 'video',
        parentAssetId: seg.parentAssetId,
        segmentIndex: seg.segmentIndex,
        startSec: seg.startSec,
        endSec: seg.endSec,
        durationSec: seg.durationSec,
        label: seg.label,
        roleHints: seg.roleHints,
        source: seg.source,
      };
    }
    return material;
  });
}

const STRATEGY_KIND_LABELS: Record<string, string> = {
  text_card: '文案卡',
  selling_point_card: '卖点卡',
  comparison_card: '对比卡',
  cta_card: 'CTA 卡',
  before_after_card: '前后对比卡',
  trust_card: '信任卡',
  texture_card: '质感卡',
  swatch_card: '色板卡',
  crop_zoom: '裁剪推近',
  reuse_asset: '素材复用',
  product_closeup_replacement: '产品特写替换',
  aigc_background: 'AIGC 背景',
  aigc_voiceover: 'AIGC 配音',
  hand_demo: '手部演示',
  ask_user_for_human_demo: '请补真人演示',
  caption_rewrite: '字幕改写',
  structure_reorder: '结构重排',
  style_filter_suggestion: '风格滤镜',
};
function strategyKindLabel(strategy: GapRepairStrategy | string): string {
  return STRATEGY_KIND_LABELS[strategy] ?? String(strategy);
}
function strategyToUiStrategy(strategy: GapRepairStrategy | string): 'aigc' | 'hyperframes' {
  return strategy === 'aigc_background' || strategy === 'aigc_voiceover' ? 'aigc' : 'hyperframes';
}

function projectState(match: SlotMatch | undefined, gap: MaterialGap | undefined, assignedCount: number): StateKey {
  if (match?.status === 'matched') return 'filled';
  if (match?.status === 'partial') return 'weakly';
  // missing / no match
  if (gap) return gap.severity === 'high' ? 'critical' : 'missing';
  if (assignedCount > 0) return 'weakly';
  return 'missing';
}

function impactPct(state: StateKey, gap: MaterialGap | undefined): number {
  if (state === 'filled') return 0;
  if (gap?.severity === 'high') return -42;
  if (gap?.severity === 'medium') return -22;
  if (gap?.severity === 'low') return -12;
  return state === 'weakly' ? -15 : -30;
}

/**
 * Fold SlotMatch (3-state) + MaterialGap (severity) + GapRepair into the UI's
 * 4-state Diagnosis, keyed by segment id. THE core projection. Thresholds:
 *   matched               → filled
 *   partial               → weakly
 *   missing + high gap     → critical
 *   missing + low/med gap  → missing
 */
export function toDiagnosisRecord(input: {
  sourceVideo: SourceVideo;
  matches: SlotMatch[];
  gaps: MaterialGap[];
  repairs: GapRepair[];
  materials: Material[];
  /** Real Director-Agent 3-option resolution menus, keyed by slot/segment id (T1). */
  slotResolutions?: Record<string, SlotGapResolution>;
}): Record<string, Diagnosis> {
  const { sourceVideo, matches, gaps, repairs, materials, slotResolutions } = input;
  const out: Record<string, Diagnosis> = {};

  for (const seg of sourceVideo.segments) {
    const match = matches.find((m) => m.slotId === seg.id);
    const gap = gaps.find((g) => g.slotId === seg.id || g.affectedSegmentId === seg.id);
    const repair = repairs.find((r) => r.slotId === seg.id);
    const assigned = materials.filter((m) => m.slot === seg.id);
    const matchedAsset = match?.assetId ? materials.find((m) => m.id === match.assetId) : undefined;
    const resolution = slotResolutions?.[seg.id];

    const state = projectState(match, gap, assigned.length);

    const haveSet = new Map<string, string>();
    for (const m of assigned) haveSet.set(m.id, `${m.id} ${m.subject}`);
    if (matchedAsset) haveSet.set(matchedAsset.id, `${matchedAsset.id} ${matchedAsset.subject}`);
    const have = [...haveSet.values()];

    const need = gap?.gapSpec?.ideal
      ? [gap.gapSpec.ideal, ...(gap.gapSpec.minimalAcceptable ? [gap.gapSpec.minimalAcceptable] : [])]
      : tokenizeSubject(seg.shot).slice(0, 3);

    // Prefer the recommended real option's title for the fix label; fall back to repair / synthesized.
    const recommended = resolution ? (resolution.recommendedOptionId as ResolutionMethod) : undefined;
    const recommendedOption = resolution?.options.find((o) => o.id === resolution.recommendedOptionId);

    const fix =
      recommendedOption != null
        ? { kind: resolutionMethodLabel(recommendedOption.id), desc: resolutionOptionSummary(recommendedOption) }
        : repair != null
          ? { kind: strategyKindLabel(repair.strategy), desc: repair.explanation }
          : state === 'filled'
            ? null
            : { kind: '补全', desc: gap?.reason ?? '建议补拍或合成以满足该槽位' };

    const strategy =
      recommended != null
        ? recommended
        : repair != null
          ? strategyToUiStrategy(repair.strategy)
          : null;

    const diagnosis: Diagnosis = {
      state,
      have,
      need,
      gap_reason: state === 'filled' ? '—' : gap?.reason ?? '该槽位素材不足，需补全',
      impact: {
        dim: roleToDim(seg.role),
        pct: impactPct(state, gap),
        note: gap?.impact ?? (state === 'filled' ? '该槽位已被现有素材覆盖' : '若不补全将削弱该结构环节'),
      },
      fix,
      strategy,
    };

    if (recommended != null) diagnosis.recommended = recommended;

    // Real 3-option menu wins; only fall back to the thin synthesized fill when no
    // Director options exist for this slot (e.g. options omitted by the caller).
    if (resolution) {
      diagnosis.fill = optionsToDiagnosisFill(resolution.options, seg, gap, repair, assigned);
    } else if (state !== 'filled') {
      diagnosis.fill = synthesizeFill(seg, gap, repair, assigned);
    }

    out[seg.id] = diagnosis;
  }

  return out;
}

const RESOLUTION_METHOD_LABELS: Record<GapResolutionOptionId, string> = {
  reshoot: '补拍',
  hyperframes: 'HyperFrames 卡片',
  aigc: 'AIGC 生成',
};
function resolutionMethodLabel(id: GapResolutionOptionId): string {
  return RESOLUTION_METHOD_LABELS[id] ?? String(id);
}

/** One-line human summary of the recommended option for the diagnosis `fix.desc`. */
function resolutionOptionSummary(option: GapResolutionOption): string {
  if (option.id === 'reshoot') return option.guidanceNL || option.title || '补拍该槽位';
  if (option.id === 'hyperframes') return option.editingGuidanceNL;
  return option.prompt;
}

/**
 * Project the Director Agent's real GapResolutionOption[] into the UI DiagnosisFill,
 * carrying the FULL option payload (reshoot / hyperframes / aigc) AND the legacy
 * synthesized fields (so the existing UI mirror keeps rendering). When a channel is
 * absent from the menu, its legacy synthesized value is used as the fallback.
 */
function optionsToDiagnosisFill(
  options: GapResolutionOption[],
  seg: SourceSegment,
  gap: MaterialGap | undefined,
  repair: GapRepair | undefined,
  assigned: Material[],
): DiagnosisFill {
  const base = synthesizeFill(seg, gap, repair, assigned);
  const reshoot = options.find((o): o is ReshootOption => o.id === 'reshoot');
  const hyperframes = options.find((o): o is HyperframesOption => o.id === 'hyperframes');
  const aigc = options.find((o): o is AigcOption => o.id === 'aigc');

  return {
    reshoot: reshoot
      ? {
          guide: reshoot.guidanceNL,
          // ALWAYS use the real Director array — never leak synthesized base shots over
          // real data, even when mustCapture is empty (an empty list is the honest truth).
          shots: reshoot.mustCapture,
          guidanceNL: reshoot.guidanceNL,
          framing: reshoot.framing,
          durationSec: reshoot.durationSec,
          mustCapture: reshoot.mustCapture,
          avoid: reshoot.avoid,
        }
      : base.reshoot,
    hyperframes: hyperframes
      ? {
          uses: hyperframes.referencedAssetIds,
          desc: hyperframes.editingGuidanceNL,
          editingGuidanceNL: hyperframes.editingGuidanceNL,
          cardType: hyperframes.cardType,
          copy: hyperframes.copy,
          referencedAssetIds: hyperframes.referencedAssetIds,
          durationMs: hyperframes.durationMs,
        }
      : base.hyperframes,
    aigc: aigc
      ? {
          prompt: aigc.prompt,
          negativePrompt: aigc.negativePrompt,
          referenceAssetIds: aigc.referenceAssetIds,
          aspectRatio: aigc.aspectRatio,
          expectedDurationSec: aigc.expectedDurationSec,
          providerHint: aigc.providerHint,
          ownership: aigc.ownership,
        }
      : base.aigc,
  };
}

function synthesizeFill(
  seg: SourceSegment,
  gap: MaterialGap | undefined,
  repair: GapRepair | undefined,
  assigned: Material[],
): DiagnosisFill {
  const shots = gap?.gapSpec?.minimalAcceptable
    ? [gap.gapSpec.minimalAcceptable, ...tokenizeSubject(seg.shot).slice(0, 1)]
    : tokenizeSubject(seg.shot).slice(0, 2);
  const reuseIds = assigned.length ? assigned.map((m) => m.id) : repair?.generatedAssetHint ? [] : [];
  return {
    reshoot: {
      guide: gap?.gapSpec?.ideal ?? `补拍满足『${seg.label}』(${seg.shot}) 的镜头，竖屏 9:16。`,
      shots: shots.length ? shots : [`${seg.label} 主体镜头`],
    },
    hyperframes: {
      uses: reuseIds,
      desc: repair?.explanation ?? (reuseIds.length ? '复用现有素材 + 动效合成补足该槽位。' : '暂无可复用素材，建议补拍或 AIGC 生成。'),
    },
    aigc: {
      prompt:
        gap?.gapSpec?.alternativeIfNoShoot ??
        `${seg.label}场景，${seg.shot}，真实质感，9:16 竖屏，情绪克制，自然光`,
    },
  };
}

/** TimelineItem[] → UI TimelineSeg[] for the compile screen preview/timeline. */
export function timelineItemsToSegs(
  items: TimelineItem[],
  opts: { sourceVideo?: SourceVideo; diagnosis?: Record<string, Diagnosis> } = {},
): TimelineSeg[] {
  const segById = new Map((opts.sourceVideo?.segments ?? []).map((s) => [s.id, s]));
  return items.map((item, i) => {
    const seg = segById.get(item.sourceSegmentId);
    const role = seg?.role ?? segmentRoleToRole(item.segmentRole as string);
    const fixKind =
      item.repair != null
        ? strategyKindLabel(item.repair.strategy)
        : opts.diagnosis?.[item.sourceSegmentId]?.fix?.kind ?? null;
    return {
      id: item.id ?? `seg${i + 1}`,
      role,
      start: round01(item.start),
      end: round01(item.end),
      label: seg?.label ?? item.visualAction ?? `镜头 ${i + 1}`,
      shot: item.visualAction ?? seg?.shot ?? '',
      caption: item.subtitles?.[0] ?? item.script ?? seg?.caption ?? '',
      fixKind,
    };
  });
}

/* ============================================================
   REVERSE · UI → shared (ported from frontend api/assetManager.ts)
   ============================================================ */

export function buildContentBrief(product: TargetProduct, sourceVideo: SourceVideo): ContentBrief {
  const sellingPoints =
    Array.isArray(product.sellingPoints) && product.sellingPoints.length
      ? product.sellingPoints
      : [
          product.category,
          product.price,
          product.industry,
          product.stock > 0 ? `${(product.stock ?? 0).toLocaleString()} 件库存可用于限时转化` : '',
        ].filter(Boolean);

  return {
    productName: product.name,
    targetAudience: product.industry,
    scenario: product.category,
    sellingPoints,
    cta: product.cta?.trim() || `${product.name} · 立即了解`,
    stylePreference: product.stylePreference?.trim() || `${sourceVideo.packaging.captions} · ${sourceVideo.packaging.cover}`,
  };
}

export function buildStructureGraph(sourceVideo: SourceVideo): ViralStructureGraph {
  const graph: ViralStructureGraph = {
    schemaVersion: 'v1',
    meta: {
      duration: sourceVideo.duration,
      aspectRatio: '9:16',
      videoType: 'ecommerce',
      style: 'high_conversion',
    },
    structureSummary: `${sourceVideo.title} · ${sourceVideo.protocol_version}`,
    segments: sourceVideo.segments.map((segment) => ({
      id: segment.id,
      role: ROLE_TO_SEGMENT_ROLE[segment.role],
      start: segment.start,
      end: segment.end,
      duration: round01(segment.end - segment.start),
      purpose: segment.label,
      caption: segment.caption,
      // Prefer the dedicated migration field; fall back to legacy `shot` for old
      // payloads that still carried the transfer rule in `shot`.
      transferRule: segment.transferRule ?? segment.shot,
      importance: importanceForRole(segment.role),
    })),
    shotSlots: sourceVideo.segments.map(segmentToShotSlot),
    rhythm: {
      avgShotDuration: sourceVideo.rhythm.avg_shot,
      cutFrequency: sourceVideo.rhythm.cuts >= 16 ? 'high' : sourceVideo.rhythm.cuts >= 9 ? 'medium' : 'low',
      peakAt: sourceVideo.segments[0]?.end,
      pattern: `${sourceVideo.rhythm.hook_density} hook density · ${sourceVideo.rhythm.bgm_bpm} BPM`,
    },
    packaging: {
      captionDensity: sourceVideo.rhythm.caption_density === '高' ? 'high' : 'medium',
      captionPosition: 'bottom_center',
      titleStyle: sourceVideo.packaging.title_template,
      cardTypes: ['hook_title', 'benefit_card', 'cta_card'],
      transitions: ['cut', 'fade'],
      coverStyle: sourceVideo.packaging.cover,
    },
    creativeIngredients: [],
    edges: sourceVideo.segments.slice(1).map((segment, index) => ({
      from: sourceVideo.segments[index].id,
      to: segment.id,
      type: 'sequence',
      explanation: 'Source StructMigrate segment order.',
    })),
  };
  const boundaries = transitionsToBoundaries(sourceVideo.transitions);
  if (boundaries.length) graph.boundaries = boundaries;
  return graph;
}

function transitionsToBoundaries(transitions: Transition[]): Boundary[] {
  return (transitions ?? []).map((t) => ({
    id: t.id,
    from: t.from,
    to: t.to,
    transitionType: uiTypeToBoundaryType(t.applied),
    intensity: t.state === 'filled' ? 'strong' : 'weak',
    alignedToBeat: t.applied === '卡点',
  }));
}

function segmentToShotSlot(segment: SourceSegment): ShotSlotNode {
  const role = ROLE_TO_SHOTSLOT[segment.role];
  return {
    id: segment.id,
    segmentId: segment.id,
    role,
    requiredAsset: {
      type: role === 'usage_demo' ? 'video' : role === 'benefit_visual' ? 'text' : 'image',
      subject: segment.shot,
      camera: cameraForRole(segment.role),
      motion: role === 'usage_demo' ? 'hand_operation' : motionForRole(segment.role),
      minDuration: round01(segment.end - segment.start),
    },
    fallbackStrategies: fallbackStrategiesForRole(role),
    importance: importanceForRole(segment.role),
    intent: {
      purpose: segment.label,
      energyLevel: segment.role === 'hook' || segment.role === 'cta' ? 'high' : 'medium',
      motionPattern: motionForRole(segment.role),
      compositionPrincipal: segment.shot,
      durationMs: [Math.round((segment.end - segment.start) * 800), Math.round((segment.end - segment.start) * 1200)],
      soundDesignHint: 'Follow the source rhythm but migrate content, not product identity.',
    },
    sourceInstance: {
      productInSource: 'source video object',
      specificAction: segment.shot,
      colorSignature: 'derived from source packaging',
    },
    acceptanceCriteria: {
      anyOf: [{
        motionType: motionForRole(segment.role),
        compositionType: cameraForRole(segment.role),
        examples: [segment.shot, segment.caption],
      }],
      rejectIf: ['copies the source product literally', 'uses unrelated asset with no product or story evidence'],
    },
  };
}

function fallbackStrategiesForRole(role: ShotSlotRole): ShotSlotNode['fallbackStrategies'] {
  if (role === 'cta_visual') return ['cta_card', 'text_card', 'reuse_asset'];
  if (role === 'product_closeup') return ['crop_zoom', 'product_closeup_replacement', 'selling_point_card'];
  if (role === 'usage_demo') return ['reuse_asset', 'caption_rewrite', 'aigc_background'];
  if (role === 'comparison') return ['comparison_card', 'text_card', 'reuse_asset'];
  return ['text_card', 'selling_point_card', 'reuse_asset'];
}

export function materialToAssetCard(material: Material, sourceVideo: SourceVideo, product: TargetProduct): AssetCard {
  const assignedSegment = material.slot ? sourceVideo.segments.find((segment) => segment.id === material.slot) : undefined;
  const primaryRole = assignedSegment ? ROLE_TO_SHOTSLOT[assignedSegment.role] : inferRoleFromMaterial(material);
  const suitableSlots = Array.from(new Set([primaryRole, inferRoleFromMaterial(material)].filter(Boolean))) as ShotSlotRole[];
  const description = [material.subject, assignedSegment?.label, product.name, product.category].filter(Boolean).join(' · ');
  const cardType: AssetCard['type'] = material.kind === 'video' ? 'video' : material.kind === 'photo' ? 'image' : 'text';
  const isVisual = material.kind === 'photo' || material.kind === 'video';
  const card: AssetCard = {
    id: material.id,
    type: cardType,
    // Round-trip the real file/asset url so the produce renderer can resolve real clips.
    url: material.url,
    text: material.kind === 'text' ? material.subject : undefined,
    spatialDescription: isVisual ? description : undefined,
    detectedObjects: tokenizeSubject(material.subject),
    suitableSlots,
    qualityScore: clamp01(material.quality),
    detectedIngredients: ingredientsForMaterial(material, primaryRole),
    visualStyleTags: isVisual ? ['clean_background', 'premium_visual'] : ['professional_review'],
    candidateSlotRoles: suitableSlots.map((role) => ({
      role,
      confidence: clamp01(material.quality),
      caveat: material.slot ? `User assigned to ${material.slot}.` : 'Inferred from StructMigrate material subject.',
    })),
    analysisSource: 'deterministic',
  };
  // Re-emit clip provenance when this Material was a sliced video segment, so the
  // Material → AssetCard round-trip preserves segmentSource (real-clip resolution).
  if (material.parentAssetId !== undefined && material.segmentIndex !== undefined) {
    card.segmentSource = {
      parentAssetId: material.parentAssetId,
      startSec: material.startSec ?? 0,
      endSec: material.endSec ?? material.startSec ?? 0,
      durationSec: material.durationSec ?? Math.max(0, (material.endSec ?? 0) - (material.startSec ?? 0)),
      segmentIndex: material.segmentIndex,
      label: material.label ?? material.subject,
      roleHints: (material.roleHints as ShotSlotRole[] | undefined) ?? suitableSlots,
      actionTags: [],
      source: material.source ?? 'deterministic',
    };
  }
  return card;
}

export function materialsToAssetCards(materials: Material[], sourceVideo: SourceVideo, product: TargetProduct): AssetCard[] {
  return materials.map((m) => materialToAssetCard(m, sourceVideo, product));
}

function inferRoleFromMaterial(material: Material): ShotSlotRole {
  const text = material.subject.toLowerCase();
  if (/cta|下单|购买|倒计时|礼盒|链接/.test(text)) return 'cta_visual';
  if (/证书|鉴定|评价|评分|买家|口碑|信任/.test(text)) return 'testimonial';
  if (/对比|价格|价值|同款|竞品/.test(text)) return 'comparison';
  if (/上手|佩戴|使用|过程|场景/.test(text)) return 'usage_demo';
  if (/特写|正面|产品|工艺|包装/.test(text)) return 'product_closeup';
  if (/标题|卖点|文案/.test(text)) return 'benefit_visual';
  return 'benefit_visual';
}

function ingredientsForMaterial(material: Material, role: ShotSlotRole): CreativeIngredientType[] {
  const ingredients = new Set<CreativeIngredientType>();
  if (role === 'product_closeup') ingredients.add('product_closeup_trait');
  if (role === 'usage_demo') ingredients.add('lifestyle_context');
  if (role === 'comparison') ingredients.add('before_after_comparison');
  if (role === 'testimonial') ingredients.add('social_proof');
  if (role === 'benefit_visual' || role === 'cta_visual') ingredients.add('trust_building');
  if (material.kind === 'text') ingredients.add('unknown');
  return Array.from(ingredients);
}

/** UI TimelineSeg[] → minimal TimelineItem[] for apply-edit / render. */
export function segsToTimelineItems(segs: TimelineSeg[]): TimelineItem[] {
  return segs.map((seg, i) => ({
    id: seg.id ?? `seg${i + 1}`,
    start: round01(seg.start),
    end: round01(seg.end),
    segmentRole: ROLE_TO_SEGMENT_ROLE[(seg.role as RoleKey)] ?? ('hook' as SegmentRole),
    sourceSegmentId: seg.id,
    slotId: seg.id,
    script: seg.caption,
    subtitles: seg.caption ? [seg.caption] : [],
    visualAction: seg.shot,
    packaging: { captionStyle: 'bottom_center_white' },
    scriptSource: 'template',
  }));
}

/* ─── compile version presets (server config) ───────────────── */

export const COMPILE_VERSIONS: CompileVersion[] = [
  {
    id: 'click', name: '高点击版', desc: '强化 Hook + 痛点前置',
    bias: '前 3 秒拉满抓人,牺牲 1 段卖点深度',
    stats: [{ k: '离线点击潜力', v: '+24%', up: true }, { k: '完播潜力', v: '+12pt', up: true }, { k: '加购倾向', v: '+8%', up: true }],
    mainStrat: 'pack',
  },
  {
    id: 'convert', name: '高转化版', desc: '侧重卖点 + 价值对比',
    bias: '卖点段加长,加入 ¥599 vs ¥2999 锚价卡',
    stats: [{ k: '离线点击潜力', v: '+15%', up: true }, { k: '完播潜力', v: '+18pt', up: true }, { k: '加购倾向', v: '+30%', up: true }],
    mainStrat: 'reuse',
  },
  {
    id: 'premium', name: '高质感版', desc: '极简包装 + 慢节奏',
    bias: '去除大字弹幕,用环境音 + Ken Burns 镜头',
    stats: [{ k: '品牌好感', v: '+35%', up: true }, { k: '平均观看', v: '+22%', up: true }, { k: '离线点击潜力', v: '-6%', up: false }],
    mainStrat: 'aigc',
  },
];

export function versionFromId(versionId: string | undefined): CompileVersion {
  return COMPILE_VERSIONS.find((v) => v.id === versionId) ?? COMPILE_VERSIONS[0];
}

// Mirror of the (non-exported) GenerationVariant union in services/timelineGenerator.
export type GenerationVariant = 'high_click' | 'high_conversion' | 'premium';

export function versionIdToVariant(versionId: string | undefined): GenerationVariant {
  if (versionId === 'convert') return 'high_conversion';
  if (versionId === 'premium') return 'premium';
  return 'high_click';
}

// Map the UI compile variant onto the Director Agent's TargetDurationMode (the
// duration arc it re-budgets the source into). 高点击版 favours a tight 15s arc;
// 高转化版 a 20s arc with room for value/comparison; 高质感版 preserves the source
// pacing (慢节奏 + Ken Burns) rather than aggressively compressing.
export function variantToTargetDurationMode(variant: GenerationVariant): TargetDurationMode {
  if (variant === 'high_conversion') return 'high_conversion_20s';
  if (variant === 'premium') return 'source_preserve';
  return 'high_click_15s';
}
