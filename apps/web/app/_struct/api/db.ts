// db.ts — client for the file-backed pipeline DB (scans / libraries / matches) and
// reshoot ingestion. Thin typed wrappers over the /api/struct/db/* + reshoot routes.

import { structGet, structPostForm } from './client';
import type { Material } from '../data';

export interface ScanSummary {
  id: string;
  videoId: string;
  title: string;
  createdAt: string;
  durationSec: number;
  segmentCount: number;
  source: 'rough_scan' | 'sample_analyze' | 'import';
}

export interface LibrarySummary {
  libraryId: string;
  cardCount: number;
  updatedAt?: string;
}

export interface SlotMatchEntry {
  slotId: string;
  assetId: string | null;
  quality: number;
  fillStatus?: string;
  role?: string;
}
export interface MatchSet {
  id: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  matches: SlotMatchEntry[];
}

/** Persisted scan results (案例视频结构), newest first. */
export function listScans(): Promise<{ scans: ScanSummary[] }> {
  return structGet('/api/struct/db/scans');
}
export function getScan(id: string): Promise<{ scan: unknown }> {
  return structGet(`/api/struct/db/scans/${encodeURIComponent(id)}`);
}

/** Asset libraries (素材 + asset card) and their card counts. */
export function listLibraries(): Promise<{ libraries: LibrarySummary[] }> {
  return structGet('/api/struct/db/libraries');
}
export function getLibrary(id: string): Promise<{ libraryId: string; cardCount: number; materials: Material[] }> {
  return structGet(`/api/struct/db/libraries/${encodeURIComponent(id)}`);
}

/** Persisted slot↔asset matching for a project (素材匹配字段). */
export function getMatchSet(projectId: string): Promise<{ matchSet: MatchSet }> {
  return structGet(`/api/struct/db/matches/${encodeURIComponent(projectId)}`);
}

/**
 * Reshoot ingestion: upload 补拍 clip(s) into a named library; the backend analyzes
 * them into asset cards, appends them (renumbered) and persists. Returns the FULL
 * updated library as materials so the new clip shows up in context immediately.
 */
export function reshootIntoLibrary(
  files: File[],
  libraryId: string,
  textBrief?: string,
): Promise<{ libraryId: string; added: number; cardCount: number; materials: Material[]; warnings?: string[] }> {
  const form = new FormData();
  for (const file of files) form.append('assets', file);
  form.append('libraryId', libraryId);
  if (textBrief) form.append('textBrief', textBrief);
  return structPostForm('/api/struct/materials/reshoot', form);
}
