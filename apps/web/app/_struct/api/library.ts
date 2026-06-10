// library.ts — 结构样例库 persistence (save / list / load / delete a scanned structure).
//
// Targets the `/api/struct/structures` endpoints. Like the rest of the
// `/api/struct/*` layer (see client.ts), every helper THROWS a rich
// StructApiError on any failure (network/backend-down, non-2xx) so the store
// can FAIL FAST and surface exactly what broke instead of silently swallowing.

import { StructApiError, structApiUrl, structGet, structPost } from './client';
import type { SourceVideo } from '../data';
import type { FineBlockDetail } from './scan';

/** Summary card for a saved structure (list + create response). Top-level, not wrapped. */
export interface SavedStructureSummary {
  id: string;
  title: string;
  /** ISO timestamp the structure was saved. */
  savedAt: string;
  segmentCount: number;
  durationSec: number;
  platform?: string;
}

/** Full saved structure record (GET /structures/:id). Top-level, not wrapped. */
export interface SavedStructure {
  id: string;
  title: string;
  savedAt: string;
  sourceVideo: SourceVideo;
  /** Per-segment deep fine-scan detail, keyed by UI segment id (optional). */
  segmentDetails?: Record<string, FineBlockDetail>;
}

/** Body for POST /api/struct/structures. */
export interface SaveStructureBody {
  sourceVideo: SourceVideo;
  segmentDetails?: Record<string, FineBlockDetail>;
  title?: string;
}

/** GET /api/struct/structures → { structures } (newest first). */
interface ListStructuresResponse {
  structures: SavedStructureSummary[];
}

/** DELETE /api/struct/structures/:id → { ok } (404 { ok:false, error } if missing). */
export interface DeleteStructureResponse {
  ok: boolean;
  error?: string;
}

/** POST /api/struct/structures → 201 SavedStructureSummary. */
export function saveStructure(body: SaveStructureBody): Promise<SavedStructureSummary> {
  return structPost<SavedStructureSummary>('/api/struct/structures', body);
}

/** GET /api/struct/structures → SavedStructureSummary[] (newest first). */
export async function listStructures(): Promise<SavedStructureSummary[]> {
  const res = await structGet<ListStructuresResponse>('/api/struct/structures');
  return res.structures ?? [];
}

/** GET /api/struct/structures/:id → SavedStructure. */
export function getStructure(id: string): Promise<SavedStructure> {
  return structGet<SavedStructure>(`/api/struct/structures/${encodeURIComponent(id)}`);
}

/**
 * DELETE /api/struct/structures/:id → { ok }.
 * client.ts exposes no structDelete helper, so this mirrors its fail-fast `request`
 * pattern locally (rich StructApiError on network failure / non-2xx / bad JSON).
 */
export async function deleteStructure(id: string): Promise<DeleteStructureResponse> {
  const path = `/api/struct/structures/${encodeURIComponent(id)}`;
  let res: Response;
  try {
    res = await fetch(structApiUrl(path), { method: 'DELETE' });
  } catch (e) {
    throw new StructApiError('DELETE', path, null, e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).trim().slice(0, 400);
    } catch {
      /* ignore body read failure */
    }
    throw new StructApiError('DELETE', path, res.status, body || res.statusText);
  }
  try {
    return (await res.json()) as DeleteStructureResponse;
  } catch (e) {
    throw new StructApiError('DELETE', path, res.status, `响应不是合法 JSON（${e instanceof Error ? e.message : String(e)}）`);
  }
}
