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
  kind: 'photo' | 'text';
  subject: string;
  slot: string | null;
  quality: number;
  color?: string;
}

export interface DiagnosisFill {
  reshoot: { guide: string; shots: string[] };
  hyperframes: { uses: string[]; desc: string };
  aigc: { prompt: string };
}

export interface Diagnosis {
  state: StateKey;
  have: string[];
  need: string[];
  gap_reason: string;
  impact: { dim: string; pct: number; note: string };
  fix: { kind: string; desc: string } | null;
  strategy: string | null;
  fill?: DiagnosisFill;
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
