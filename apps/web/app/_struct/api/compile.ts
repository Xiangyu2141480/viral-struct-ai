// compile.ts — Screen 04 (成片编译) API calls.

import { structGet, structPost } from './client';
import type {
  CompileRequest,
  CompileResponse,
  ExportRequest,
  ExportResult,
  NlEditRequest,
  NlEditResponse,
  ProduceRequest,
  ProduceStartResponse,
  ProduceStatus,
} from './types';

/** Compile the chosen version into a playable timeline. */
export function compile(body: CompileRequest): Promise<CompileResponse> {
  return structPost<CompileResponse>('/api/struct/compile', body);
}

/** Apply a natural-language edit, producing a new timeline draft. */
export function nlEdit(body: NlEditRequest): Promise<NlEditResponse> {
  return structPost<NlEditResponse>('/api/struct/nl-edit', body);
}

/** Kick off a render/export job. Poll {@link pollExport} until status==='done'. */
export function exportVideo(body: ExportRequest): Promise<ExportResult> {
  return structPost<ExportResult>('/api/struct/export', body);
}

/** Poll an export job's status. */
export function pollExport(jobId: string): Promise<ExportResult> {
  return structGet<ExportResult>(`/api/struct/export/${jobId}`);
}

/**
 * Kick off the REAL AIGC produce job (Wan2.7). Returns 202 { jobId }. Poll with
 * {@link getProduceStatus} until status==='done' (has downloadUrl when rendered)
 * or status==='error'. HONEST-GATE: the backend fails the job verbatim when
 * DASHSCOPE_API_KEY is unset — never a fake MP4.
 */
export function startProduce(body: ProduceRequest): Promise<ProduceStartResponse> {
  return structPost<ProduceStartResponse>('/api/struct/produce', body);
}

/** Poll a produce job's status. */
export function getProduceStatus(jobId: string): Promise<ProduceStatus> {
  return structGet<ProduceStatus>(`/api/struct/produce/${jobId}`);
}
