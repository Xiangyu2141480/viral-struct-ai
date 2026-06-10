// structTypes.ts — Server-side mirror of the StructMigrate UI data model.
//
// These shapes intentionally mirror the demo UI's OWN model
// (apps/web/app/_struct/data.ts + api/types.ts), NOT @viral-struct/shared,
// per docs/API_CONTRACT.md §10. The /api/struct/* adapter translates the rich
// shared-protocol artifacts (ViralStructureGraph, AssetCard, SlotMatch, …) into
// exactly these shapes so the frontend needs no type bridging.
//
// Keep this file in sync with apps/web/app/_struct/data.ts.

export type RoleKey = 'hook' | 'pain' | 'emotion' | 'product' | 'compare' | 'social' | 'cta';
export type StateKey = 'filled' | 'weakly' | 'missing' | 'critical';
export type TransitionState = 'filled' | 'weakly';
export type TransitionTypeKey = '硬切' | '叠化' | '推镜' | '卡点';

export interface SourceSegment {
  id: string;
  role: RoleKey;
  start: number;
  end: number;
  label: string;
  shot: string;
  caption: string;
}

export interface Transition {
  id: string;
  from: string;
  to: string;
  at: number;
  type: TransitionTypeKey;
  applied: TransitionTypeKey;
  state: TransitionState;
  upgradable: boolean;
  dur: number;
  intendedDur: number;
  need: string[];
  have: string[];
  gap_reason: string;
  impact: { dim: string; pct: number; note: string };
  fix: { kind: string; desc: string } | null;
  note: string;
}

export interface SourceVideo {
  id: string;
  title: string;
  platform: string;
  duration: number;
  views: string;
  likes: string;
  finish_rate: number;
  ctr: number;
  cvr: number;
  protocol_version: string;
  segments: SourceSegment[];
  transitions: Transition[];
  rhythm: {
    avg_shot: number;
    cuts: number;
    hook_density: string;
    bgm_bpm: number;
    caption_density: string;
  };
  packaging: {
    title_template: string;
    captions: string;
    bgm: string;
    cover: string;
  };
}

export interface TargetProduct {
  name: string;
  category: string;
  price: string;
  stock: number;
  asset_count: number;
  industry: string;
}

export interface Material {
  id: string;
  kind: 'photo' | 'text' | 'video';
  subject: string;
  slot: string | null;
  quality: number;
  color?: string;
  /** Real file/asset URL (file path set by the analyzer). Enables real-clip resolution. */
  url?: string;
  /** Provenance: id of the parent asset this clip was sliced from (PR#73). */
  parentAssetId?: string;
  /** Ordinal index of this clip within the parent asset. */
  segmentIndex?: number;
  /** Clip start offset within the parent asset, in seconds. */
  startSec?: number;
  /** Clip end offset within the parent asset, in seconds. */
  endSec?: number;
  /** Clip duration in seconds. */
  durationSec?: number;
  /** Human-readable clip label. */
  label?: string;
  /** Suggested slot roles for this clip (from segment analysis). */
  roleHints?: string[];
  /** How this clip's segmentation was derived. */
  source?: 'deterministic' | 'vlm' | 'hybrid';
}

// The three honest resolution channels, projected from the Director Agent's
// real per-gap GapResolutionOption[]. The legacy synthesized fields (reshoot.guide
// / reshoot.shots / hyperframes.uses / hyperframes.desc / aigc.prompt) are kept for
// backward compatibility; the new structured fields carry the FULL option payload
// so the UI can render the real reshoot brief / HyperFrames card / AIGC job-card.
export interface DiagnosisFill {
  reshoot: {
    /** Legacy synthesized one-liner (kept for the existing UI mirror). */
    guide: string;
    /** Legacy synthesized shot list (kept for the existing UI mirror). */
    shots: string[];
    /** Full natural-language shooting brief authored by the Director Agent. */
    guidanceNL?: string;
    /** Recommended framing for the reshoot. */
    framing?: string;
    /** Suggested shot duration in seconds. */
    durationSec?: number;
    /** What the reshoot MUST capture. */
    mustCapture?: string[];
    /** What the reshoot should avoid. */
    avoid?: string[];
  };
  hyperframes: {
    /** Legacy: ids of reused assets (kept for the existing UI mirror). */
    uses: string[];
    /** Legacy: synthesized description (kept for the existing UI mirror). */
    desc: string;
    /** Full editing guidance the Video Agent can execute from existing assets. */
    editingGuidanceNL?: string;
    /** HyperFrames card type. */
    cardType?: string;
    /** Card copy (headline / subline / bullets / cta). */
    copy?: { headline?: string; subline?: string; bullets?: string[]; cta?: string };
    /** Asset ids referenced by this card. */
    referencedAssetIds?: string[];
    /** Card duration in milliseconds. */
    durationMs?: number;
  };
  aigc: {
    /** Generation prompt (the creative target). */
    prompt: string;
    /** Negative prompt (safety guardrail). */
    negativePrompt?: string;
    /** Reference asset ids that anchor generation to real material. */
    referenceAssetIds?: string[];
    /** Output aspect ratio (e.g. '9:16'). */
    aspectRatio?: string;
    /** Expected clip duration in seconds. */
    expectedDurationSec?: number;
    /** Suggested generation provider. */
    providerHint?: string;
    /** Ownership marker — AIGC is a job-card only, the Director never submits it. */
    ownership?: string;
  };
}

/** The chosen resolution channel persisted by /strategy/apply. */
export type ResolutionMethod = 'reshoot' | 'hyperframes' | 'aigc';

export interface Diagnosis {
  state: StateKey;
  have: string[];
  need: string[];
  gap_reason: string;
  impact: { dim: string; pct: number; note: string };
  fix: { kind: string; desc: string } | null;
  strategy: string | null;
  fill?: DiagnosisFill;
  /** The 3-option resolution menu and its recommendation (Director Agent). */
  recommended?: ResolutionMethod;
  /** The channel the user actually applied (set by /strategy/apply). */
  chosenMethod?: ResolutionMethod;
  /** Opaque payload from /strategy/apply (uploaded asset ref / generated job id). */
  chosenPayload?: unknown;
}

export interface CompileVersion {
  id: string;
  name: string;
  desc: string;
  bias: string;
  stats: { k: string; v: string; up: boolean }[];
  mainStrat: string;
}

export interface TimelineSeg {
  id: string;
  role: string;
  start: number;
  end: number;
  label: string;
  shot: string;
  caption: string;
  fixKind?: string | null;
}

export type ExportJobStatus = 'pending' | 'rendering' | 'done' | 'failed';

export interface ExportResult {
  jobId: string;
  status: ExportJobStatus;
  progress: number;
  downloadUrl?: string;
  warnings?: string[];
}
