// structLibraryStore.ts — JSON-file-backed persistence for the saved-structure
// library ("结构样例库"). One file per saved structure:
//   <getStructLibraryDir()>/<id>.json
//
// The dir is PERSISTENT (see videoPaths.getStructLibraryDir), so saved structures
// survive server restarts. Contract = real data + fail-fast: inputs are validated
// (a structure must carry a non-empty segments array) and corrupt files are
// parse-guarded so they never crash a list read.

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getStructLibraryDir } from './videoPaths';
import type { SourceVideo } from './structAdapter/structTypes';
import type { FineBlockDetail } from './fineScanRunner';

/** A fully-persisted structure: the SourceVideo plus optional per-segment fine details. */
export interface SavedStructure {
  id: string;
  title: string;
  savedAt: string;
  sourceVideo: SourceVideo;
  segmentDetails?: Record<string, FineBlockDetail>;
}

/** Lightweight projection for the library list view. */
export interface SavedStructureSummary {
  id: string;
  title: string;
  savedAt: string;
  segmentCount: number;
  durationSec: number;
  platform?: string;
}

/** Only [A-Za-z0-9_-] ids are allowed — guards against path traversal on read/delete. */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function isSafeId(id: string): boolean {
  return ID_PATTERN.test(id);
}

function fileFor(id: string): string {
  return path.join(getStructLibraryDir(), `${id}.json`);
}

function toSummary(record: SavedStructure): SavedStructureSummary {
  return {
    id: record.id,
    title: record.title,
    savedAt: record.savedAt,
    segmentCount: record.sourceVideo.segments.length,
    durationSec: record.sourceVideo.duration,
    platform: record.sourceVideo.platform,
  };
}

/**
 * Persist a scanned structure into the library. Validates the sourceVideo carries a
 * non-empty segments array (fail-fast with a clear Error otherwise). Returns the
 * summary used by the list view.
 */
export async function saveStructure(input: {
  sourceVideo: SourceVideo;
  segmentDetails?: Record<string, FineBlockDetail>;
  title?: string;
}): Promise<SavedStructureSummary> {
  const { sourceVideo, segmentDetails } = input;
  if (!sourceVideo || !Array.isArray(sourceVideo.segments) || sourceVideo.segments.length === 0) {
    throw new Error('无法保存结构：sourceVideo 缺少 segments（至少需要一个段落）。');
  }

  const dir = getStructLibraryDir();
  await mkdir(dir, { recursive: true });

  const id = randomUUID();
  const title = input.title?.trim() || sourceVideo.title || `结构 ${new Date().toISOString()}`;
  const savedAt = new Date().toISOString();

  const record: SavedStructure = {
    id,
    title,
    savedAt,
    sourceVideo,
    ...(segmentDetails ? { segmentDetails } : {}),
  };

  await writeFile(fileFor(id), JSON.stringify(record, null, 2), 'utf-8');
  return toSummary(record);
}

/**
 * List all saved structures as summaries, newest first. A missing dir yields []; a
 * corrupt/unparseable file is skipped (it never crashes the whole list).
 */
export async function listStructures(): Promise<SavedStructureSummary[]> {
  const dir = getStructLibraryDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const summaries: SavedStructureSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = await readFile(path.join(dir, entry), 'utf-8');
      const record = JSON.parse(raw) as SavedStructure;
      if (record?.sourceVideo?.segments && Array.isArray(record.sourceVideo.segments)) {
        summaries.push(toSummary(record));
      }
    } catch {
      // Skip corrupt/partial files — one bad file must not break the whole list.
    }
  }

  summaries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return summaries;
}

/** Load a full saved structure by id, or null if missing. Path-traversal guarded. */
export async function getStructure(id: string): Promise<SavedStructure | null> {
  if (!isSafeId(id)) return null;
  try {
    const raw = await readFile(fileFor(id), 'utf-8');
    return JSON.parse(raw) as SavedStructure;
  } catch {
    return null;
  }
}

/** Delete a saved structure by id. Returns true if a file was removed. Guarded. */
export async function deleteStructure(id: string): Promise<boolean> {
  if (!isSafeId(id)) return false;
  try {
    await unlink(fileFor(id));
    return true;
  } catch {
    return false;
  }
}
