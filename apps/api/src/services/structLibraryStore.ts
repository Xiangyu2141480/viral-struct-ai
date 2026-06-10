// structLibraryStore.ts — file-backed persistence for the saved-structure library
// ("结构样例库"). One SUBDIR per saved structure:
//   <getStructLibraryDir()>/<id>/structure.json   (the SavedStructure record)
//   <getStructLibraryDir()>/<id>/source<ext>       (optional: the ORIGINAL source video)
//   <getStructLibraryDir()>/<id>/rough.json        (optional: its rough-scan output)
//
// The dir is PERSISTENT (see videoPaths.getStructLibraryDir), so saved structures
// survive server restarts. Persisting the source video + rough.json lets a reopened
// structure run 精扫描 (fine scan) on any segment again. Contract = real data +
// fail-fast: inputs are validated (a structure must carry a non-empty segments array)
// and corrupt files are parse-guarded so they never crash a list read.

import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  /** True when the original source video + rough.json were persisted alongside. */
  hasVideo?: boolean;
  /** Basename of the persisted source video (e.g. "source.mp4") when hasVideo. */
  videoFile?: string;
  /** Basename of the persisted rough-scan output (always "rough.json") when hasVideo. */
  roughFile?: string;
}

/** Lightweight projection for the library list view. */
export interface SavedStructureSummary {
  id: string;
  title: string;
  savedAt: string;
  segmentCount: number;
  durationSec: number;
  platform?: string;
  /** Whether the source video is persisted (and thus re-fine-scannable on reopen). */
  hasVideo: boolean;
}

/** Only [A-Za-z0-9_-] ids are allowed — guards against path traversal on read/delete. */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const STRUCTURE_FILE = 'structure.json';
const ROUGH_FILE = 'rough.json';

function isSafeId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** Absolute path to the per-id subdir. Callers must pass an isSafeId-checked id. */
function dirFor(id: string): string {
  return path.join(getStructLibraryDir(), id);
}

/** Absolute path to a structure's structure.json. Callers must pass a safe id. */
function fileFor(id: string): string {
  return path.join(dirFor(id), STRUCTURE_FILE);
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function toSummary(record: SavedStructure): SavedStructureSummary {
  return {
    id: record.id,
    title: record.title,
    savedAt: record.savedAt,
    segmentCount: record.sourceVideo.segments.length,
    durationSec: record.sourceVideo.duration,
    platform: record.sourceVideo.platform,
    hasVideo: record.hasVideo === true,
  };
}

/**
 * Persist a scanned structure into the library. Validates the sourceVideo carries a
 * non-empty segments array (fail-fast with a clear Error otherwise). When both
 * `sourceVideoPath` and `roughScanPath` are provided AND exist on disk, the original
 * video is copied to `<id>/source<ext>` and the rough output to `<id>/rough.json` so a
 * reopened structure can be fine-scanned again; otherwise the structure still saves
 * with `hasVideo: false`. Returns the summary used by the list view (incl. hasVideo).
 */
export async function saveStructure(input: {
  sourceVideo: SourceVideo;
  segmentDetails?: Record<string, FineBlockDetail>;
  title?: string;
  sourceVideoPath?: string;
  roughScanPath?: string;
}): Promise<SavedStructureSummary> {
  const { sourceVideo, segmentDetails, sourceVideoPath, roughScanPath } = input;
  if (!sourceVideo || !Array.isArray(sourceVideo.segments) || sourceVideo.segments.length === 0) {
    throw new Error('无法保存结构：sourceVideo 缺少 segments（至少需要一个段落）。');
  }

  const id = randomUUID();
  const dir = dirFor(id);
  await mkdir(dir, { recursive: true });

  const title = input.title?.trim() || sourceVideo.title || `结构 ${new Date().toISOString()}`;
  const savedAt = new Date().toISOString();

  // Persist the original source video + rough.json only when BOTH paths are provided
  // and present on disk (the scan's retained inputs may already have expired).
  let hasVideo = false;
  let videoFile: string | undefined;
  let roughFile: string | undefined;
  if (
    sourceVideoPath &&
    roughScanPath &&
    (await exists(sourceVideoPath)) &&
    (await exists(roughScanPath))
  ) {
    const ext = path.extname(sourceVideoPath) || '.mp4';
    videoFile = `source${ext}`;
    roughFile = ROUGH_FILE;
    await copyFile(sourceVideoPath, path.join(dir, videoFile));
    await copyFile(roughScanPath, path.join(dir, roughFile));
    hasVideo = true;
  }

  const record: SavedStructure = {
    id,
    title,
    savedAt,
    sourceVideo,
    ...(segmentDetails ? { segmentDetails } : {}),
    hasVideo,
    ...(hasVideo ? { videoFile, roughFile } : {}),
  };

  await writeFile(fileFor(id), JSON.stringify(record, null, 2), 'utf-8');
  return toSummary(record);
}

/**
 * List all saved structures as summaries, newest first. A missing dir yields []; a
 * subdir without a parseable structure.json is skipped (one bad entry must not crash
 * the whole list).
 */
export async function listStructures(): Promise<SavedStructureSummary[]> {
  const dir = getStructLibraryDir();
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const summaries: SavedStructureSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeId(entry.name)) continue;
    try {
      const raw = await readFile(path.join(dir, entry.name, STRUCTURE_FILE), 'utf-8');
      const record = JSON.parse(raw) as SavedStructure;
      if (record?.sourceVideo?.segments && Array.isArray(record.sourceVideo.segments)) {
        summaries.push(toSummary(record));
      }
    } catch {
      // Skip corrupt/partial subdirs — one bad entry must not break the whole list.
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

/**
 * Absolute paths to a saved structure's persisted source video + rough.json when it
 * hasVideo (and both files actually exist on disk), else null. Path-traversal guarded.
 * Used to re-register a reopened structure into the in-memory scan-artifacts map so
 * fine scan can find its inputs again.
 */
export async function getStructureArtifacts(
  id: string,
): Promise<{ videoPath: string; roughScanPath: string } | null> {
  if (!isSafeId(id)) return null;
  const record = await getStructure(id);
  if (!record || record.hasVideo !== true || !record.videoFile || !record.roughFile) return null;
  const videoPath = path.join(dirFor(id), record.videoFile);
  const roughScanPath = path.join(dirFor(id), record.roughFile);
  if (!(await exists(videoPath)) || !(await exists(roughScanPath))) return null;
  return { videoPath, roughScanPath };
}

/** Delete a saved structure by id (its whole subdir). Returns true if removed. Guarded. */
export async function deleteStructure(id: string): Promise<boolean> {
  if (!isSafeId(id)) return false;
  const dir = dirFor(id);
  if (!(await exists(dir))) return false;
  try {
    await rm(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
