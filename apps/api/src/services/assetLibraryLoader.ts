import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AssetCard } from '@viral-struct/shared';
import { AssetCardSchema } from '@viral-struct/shared';
import { getAssetLibraryDir } from './videoPaths';
import { normalizeAssetCards } from './assetManager/assetNormalizer';

const AssetCardArraySchema = z.array(AssetCardSchema);
const LibraryIdSchema = z.string().trim().min(1).regex(/^[A-Za-z0-9_-]+$/);

/**
 * Load pre-generated AssetCard records produced by scripts/analyze_asset_library.py.
 */
export async function loadAssetLibrary(libraryId: string): Promise<AssetCard[]> {
  const safeLibraryId = LibraryIdSchema.parse(libraryId);
  const filePath = join(getAssetLibraryDir(), safeLibraryId, 'asset_cards.json');
  const raw = await readFile(filePath, 'utf-8');
  return normalizeAssetCards(AssetCardArraySchema.parse(JSON.parse(raw)));
}
