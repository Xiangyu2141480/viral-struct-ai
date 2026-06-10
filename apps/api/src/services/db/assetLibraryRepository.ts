// assetLibraryRepository.ts — read/append/list ASSET LIBRARIES (素材 + asset card).
//
// Asset cards already live as `<assetLibraryDir>/<libraryId>/asset_cards.json` (the
// format loadAssetLibrary reads + analyze_asset_library.py writes). This repository is
// the WRITER side of that single source of truth: it lets new material — including
// reshoot clips re-analyzed at runtime — be appended to a library and persisted, so a
// re-load picks them up. Ids of appended cards are renumbered to continue the library's
// `asset_NNN` sequence (no collisions with existing cards).

import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AssetCard } from '@viral-struct/shared';
import { AssetCardSchema } from '@viral-struct/shared';
import { getAssetLibraryDir } from '../videoPaths';
import { normalizeAssetCards } from '../assetManager/assetNormalizer';

const LibraryIdSchema = z.string().trim().min(1).regex(/^[A-Za-z0-9_-]+$/);
const AssetCardArraySchema = z.array(AssetCardSchema);
const CARDS_FILE = 'asset_cards.json';

export interface LibrarySummary {
  libraryId: string;
  cardCount: number;
  updatedAt?: string;
}

function libDir(libraryId: string): string {
  return path.join(getAssetLibraryDir(), LibraryIdSchema.parse(libraryId));
}

/** Read a library's cards (normalized), or [] when the library does not exist yet. */
export async function readLibraryCards(libraryId: string): Promise<AssetCard[]> {
  const file = path.join(libDir(libraryId), CARDS_FILE);
  try {
    return normalizeAssetCards(AssetCardArraySchema.parse(JSON.parse(await readFile(file, 'utf-8'))));
  } catch {
    return [];
  }
}

/** Atomically write a library's cards. */
async function writeLibraryCards(libraryId: string, cards: AssetCard[]): Promise<void> {
  const dir = libDir(libraryId);
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, CARDS_FILE);
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(cards, null, 2), 'utf-8');
  await rename(tmp, target);
}

/** Highest existing `asset_NNN` index in a card list (0 when none). */
function maxAssetIndex(cards: AssetCard[]): number {
  let max = 0;
  for (const card of cards) {
    const m = /^asset_(\d+)$/.exec(card.id ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/**
 * Append new cards to a library (creating it if absent), renumbering the appended cards
 * to continue the `asset_NNN` sequence so ids never collide. Returns the full card list.
 */
export async function appendLibraryCards(libraryId: string, newCards: AssetCard[]): Promise<AssetCard[]> {
  const existing = await readLibraryCards(libraryId);
  let next = maxAssetIndex(existing);
  const renumbered = newCards.map((card) => {
    next += 1;
    return { ...card, id: `asset_${String(next).padStart(3, '0')}` };
  });
  const merged = [...existing, ...renumbered];
  await writeLibraryCards(libraryId, merged);
  return merged;
}

/** List all asset libraries with their card counts. */
export async function listLibraries(): Promise<LibrarySummary[]> {
  const root = getAssetLibraryDir();
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const summaries: LibrarySummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !LibraryIdSchema.safeParse(entry.name).success) continue;
    const cards = await readLibraryCards(entry.name);
    let updatedAt: string | undefined;
    try {
      updatedAt = (await stat(path.join(root, entry.name, CARDS_FILE))).mtime.toISOString();
    } catch {
      /* no cards file yet */
    }
    summaries.push({ libraryId: entry.name, cardCount: cards.length, updatedAt });
  }
  summaries.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  return summaries;
}
