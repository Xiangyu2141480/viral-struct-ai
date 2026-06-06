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
  SourceVideo,
  TargetProduct,
} from '../data';

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
}
export interface ApplyStrategyResponse {
  diagnosis: Record<string, Diagnosis>;
  appliedSlots: string[];
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
