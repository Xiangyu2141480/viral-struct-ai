// jsonStore.ts — a tiny file-backed "database" engine.
//
// Each COLLECTION is a directory under getDbDir(); each RECORD is one JSON file
// `<id>.json`. This is deliberately dependency-free (no native sqlite build on
// Windows, no extra runtime) and mirrors the proven structLibraryStore layout, so
// records survive server restarts and stay diff-friendly. The typed repositories
// (scanRepository / matchRepository / assetLibraryRepository) are built on top.
//
// Contract: ids are validated (path-traversal guarded), writes are atomic
// (temp file + rename), and a single corrupt record never crashes a list read.

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDbDir } from '../videoPaths';

/** Every stored record carries a stable string id (the file name stem). */
export interface DbRecord {
  id: string;
}

/** Only [A-Za-z0-9_-] ids are allowed — guards against path traversal. */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isSafeId(id: string): boolean {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

/** Generate a fresh collision-resistant id (uuid without dashes is still id-safe). */
export function newId(prefix = ''): string {
  return `${prefix}${randomUUID()}`;
}

export interface Collection<T extends DbRecord> {
  /** Insert or replace a record by its id. Returns the stored record. */
  put(record: T): Promise<T>;
  /** Read one record by id, or null if missing / unsafe id / corrupt. */
  get(id: string): Promise<T | null>;
  /** All records (newest-first when a `createdAt` field is present). Corrupt files skipped. */
  list(): Promise<T[]>;
  /** Records matching a predicate (loaded via list()). */
  query(predicate: (record: T) => boolean): Promise<T[]>;
  /** Delete one record by id. Returns true if a file was removed. */
  remove(id: string): Promise<boolean>;
  /** Absolute directory this collection persists into (for diagnostics). */
  dir(): string;
}

/** Open (lazily creating) a named collection. */
export function createCollection<T extends DbRecord>(name: string): Collection<T> {
  if (!isSafeId(name)) throw new Error(`Invalid collection name: ${name}`);
  const dir = path.join(getDbDir(), name);

  async function put(record: T): Promise<T> {
    if (!isSafeId(record.id)) throw new Error(`Invalid record id: ${String(record.id)}`);
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, `${record.id}.json`);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(record, null, 2), 'utf-8');
    await rename(tmp, target); // atomic on the same filesystem
    return record;
  }

  async function get(id: string): Promise<T | null> {
    if (!isSafeId(id)) return null;
    try {
      return JSON.parse(await readFile(path.join(dir, `${id}.json`), 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  async function list(): Promise<T[]> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return []; // collection dir not created yet
    }
    const records: T[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        records.push(JSON.parse(await readFile(path.join(dir, entry), 'utf-8')) as T);
      } catch {
        // skip a corrupt/partial record — one bad file must not break the whole read
      }
    }
    records.sort((a, b) => {
      const av = (a as { createdAt?: string }).createdAt ?? '';
      const bv = (b as { createdAt?: string }).createdAt ?? '';
      return bv.localeCompare(av); // newest first
    });
    return records;
  }

  async function query(predicate: (record: T) => boolean): Promise<T[]> {
    return (await list()).filter(predicate);
  }

  async function remove(id: string): Promise<boolean> {
    if (!isSafeId(id)) return false;
    try {
      await rm(path.join(dir, `${id}.json`), { force: true });
      return true;
    } catch {
      return false;
    }
  }

  return { put, get, list, query, remove, dir: () => dir };
}
