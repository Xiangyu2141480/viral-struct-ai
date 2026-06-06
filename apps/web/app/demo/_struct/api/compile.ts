// compile.ts — Screen 04 (成片编译) API calls.

import { structGet, structPost } from './client';
import type {
  CompileRequest,
  CompileResponse,
  ExportRequest,
  ExportResult,
  NlEditRequest,
  NlEditResponse,
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
