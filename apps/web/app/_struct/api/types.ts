// types.ts — request/response DTOs for the `/api/struct/*` endpoints.
//
// These shapes mirror the demo UI's own data model (see ../data.ts) rather than
// @viral-struct/shared, so the frontend needs no type bridging. The backend
// implements routes that return exactly these shapes. Keep this file and
// docs/API_CONTRACT.md (§10) in sync.

import type {
  CompileVersion,
  Diagnosis,
  Material,
  ResolutionMethod,
  SourceVideo,
  TargetProduct,
} from '../data';
import type { FineBlockDetail } from './scan';
import type { ContentBrief, ProductIntelligence } from '@viral-struct/shared';

/** POST /api/struct/sample/analyze */
export interface AnalyzeSampleResponse {
  sourceVideo: SourceVideo;
  warnings?: string[];
}

/** POST /api/struct/materials/upload */
export interface UploadMaterialsResponse {
  materials: Material[];
  warnings?: string[];
}

/** POST /api/struct/materials/match */
export interface MatchMaterialsRequest {
  sourceVideo: SourceVideo;
  materials: Material[];
  product?: TargetProduct;
  contentBrief?: ContentBrief;
  productIntelligence?: ProductIntelligence | null;
  rawProductDescription?: string;
  /** materialId -> slotId | null. Omit to let the backend auto-match. */
  assignments?: Record<string, string | null>;
}
export interface MatchMaterialsResponse {
  materials: Material[];
  warnings?: string[];
}

/** POST /api/struct/diagnose */
export interface DiagnoseRequest {
  sourceVideo: SourceVideo;
  materials: Material[];
  product: TargetProduct;
  /** Per-segment FINE-SCAN detail (keyed by segment id). When present the backend folds the abstract
   *  structure (transferableMotifs / exploded_assembly / revealMode) into the matcher + director so the
   *  prompts reflect motifs like 散落到聚合 / 部件展示. Omitted when no fine scan was run. */
  segmentDetails?: Record<string, FineBlockDetail>;
  contentBrief?: ContentBrief;
  productIntelligence?: ProductIntelligence | null;
  rawProductDescription?: string;
}
export interface DiagnoseResponse {
  diagnosis: Record<string, Diagnosis>;
  warnings?: string[];
}

/** POST /api/struct/strategy/apply */
export interface ApplyStrategyRequest {
  slotId: string;
  sourceVideo: SourceVideo;
  materials: Material[];
  diagnosis: Record<string, Diagnosis>;
  /** Which resolution channel to apply. Omit → backend uses recommended/strategy. */
  method?: ResolutionMethod;
  /** Opaque payload (uploaded asset ref / generated job id) for the chosen method. */
  payload?: unknown;
}
export interface ApplyStrategyResponse {
  diagnosis: Record<string, Diagnosis>;
  appliedSlots: string[];
  /** The channel the backend actually applied. */
  method?: ResolutionMethod;
  warnings?: string[];
}

/** A single compiled timeline segment (drives Screen 04 preview/timeline). */
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

/** POST /api/struct/compile */
export interface CompileRequest {
  sourceVideo: SourceVideo;
  materials: Material[];
  diagnosis: Record<string, Diagnosis>;
  versionId: string;
  product: TargetProduct;
  contentBrief?: ContentBrief;
  productIntelligence?: ProductIntelligence | null;
  rawProductDescription?: string;
}
export interface CompileResponse {
  version: CompileVersion;
  timeline: TimelineSeg[];
  warnings?: string[];
}

/** POST /api/struct/nl-edit */
export interface NlEditRequest {
  instruction: string;
  versionId: string;
  sourceVideo: SourceVideo;
  timeline: TimelineSeg[];
}
export interface NlEditResponse {
  timeline: TimelineSeg[];
  patchSummary: string;
  warnings?: string[];
}

export type ExportJobStatus = 'pending' | 'rendering' | 'done' | 'failed';

/** POST /api/struct/export and GET /api/struct/export/:jobId */
export interface ExportRequest {
  versionId: string;
  format: string;
  timeline: TimelineSeg[];
}
export interface ExportResult {
  jobId: string;
  status: ExportJobStatus;
  progress: number;
  downloadUrl?: string;
  warnings?: string[];
}

/** POST /api/struct/produce — kick off the REAL AIGC produce (Wan2.7). */
export interface ProduceRequest {
  sourceVideo: SourceVideo;
  materials: Material[];
  product?: TargetProduct;
  contentBrief?: ContentBrief;
  productIntelligence?: ProductIntelligence | null;
  rawProductDescription?: string;
  /** Product reference image url (an uploaded image material's url). */
  productImageUrl?: string;
  versionId?: string;
}

/** POST /api/struct/product/parse */
export interface ProductParseRequest {
  rawInput: string;
}
export interface ProductParseResponse {
  product: TargetProduct;
  contentBrief: ContentBrief;
  productIntelligence: ProductIntelligence | null;
  warnings?: string[];
  parseWarnings?: string[];
  source: 'llm' | 'deterministic';
}
/** POST /api/struct/produce → 202 { jobId }. */
export interface ProduceStartResponse {
  jobId: string;
}
/** GET /api/struct/produce/:jobId — poll until status==='done'|'error'. */
export interface ProduceStatus {
  status: 'running' | 'done' | 'error';
  stage?: string;
  downloadUrl?: string;
  warnings?: string[];
  error?: string;
  elapsedSec?: number;
}
