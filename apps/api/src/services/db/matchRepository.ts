// matchRepository.ts — persistence for SLOT↔ASSET MATCHES (素材匹配字段).
//
// One MatchSet per project (a scan / migration run). Re-running diagnosis upserts the
// same project's set (idempotent by a sanitized project id), so the latest matching is
// always readable: which slot got which asset, at what quality / fill status.

import { createCollection, type DbRecord } from './jsonStore';

export interface SlotMatchEntry {
  slotId: string;
  /** Matched asset id, or null when the slot is an unfilled gap. */
  assetId: string | null;
  quality: number;
  fillStatus?: string;
  role?: string;
}

export interface MatchSetRecord extends DbRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** The project this matching belongs to (usually sourceVideo.id). */
  projectId: string;
  /** Optional links to the originating scan + asset library. */
  scanId?: string;
  libraryId?: string;
  matches: SlotMatchEntry[];
}

const collection = createCollection<MatchSetRecord>('matches');

/** Map an arbitrary project id to a stable, path-safe record id (idempotent upsert key). */
function recordIdFor(projectId: string): string {
  const safe = projectId.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80) || 'project';
  return `mset_${safe}`;
}

export async function saveMatchSet(input: {
  projectId: string;
  matches: SlotMatchEntry[];
  scanId?: string;
  libraryId?: string;
}): Promise<MatchSetRecord> {
  const id = recordIdFor(input.projectId);
  const existing = await collection.get(id);
  const now = new Date().toISOString();
  const record: MatchSetRecord = {
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    projectId: input.projectId,
    ...(input.scanId ? { scanId: input.scanId } : {}),
    ...(input.libraryId ? { libraryId: input.libraryId } : {}),
    matches: input.matches,
  };
  return collection.put(record);
}

export async function getMatchSet(projectId: string): Promise<MatchSetRecord | null> {
  return collection.get(recordIdFor(projectId));
}

export async function listMatchSets(): Promise<MatchSetRecord[]> {
  return collection.list();
}
