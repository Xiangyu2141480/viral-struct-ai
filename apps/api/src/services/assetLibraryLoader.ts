import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetCard } from '@viral-struct/shared';
import { getAssetLibraryDir } from './videoPaths';

/**
 * Load a pre-generated asset_cards.json produced by scripts/analyze_asset_library.py.
 * This replaces analyzeAssetsMock() with real LLM-classified AssetCard[].
 *
 * Usage:
 *   python scripts/analyze_asset_library.py --library <libraryId>
 *   # outputs -> seed_assets/asset_libraries/<libraryId>/asset_cards.json
 */
export async function loadAssetLibrary(libraryId: string): Promise<AssetCard[]> {
  const filePath = join(getAssetLibraryDir(), libraryId, 'asset_cards.json');
  const raw = await readFile(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`asset_cards.json for library "${libraryId}" must be a JSON array`);
  }
  return parsed as AssetCard[];
}
