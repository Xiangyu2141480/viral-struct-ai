import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AssetCard } from '@viral-struct/shared';
import { AssetCardSchema } from '@viral-struct/shared';
import { getAssetLibraryDir } from './videoPaths';

const AssetCardArraySchema = z.array(AssetCardSchema);

/**
 * Load pre-generated AssetCard records produced by scripts/analyze_asset_library.py.
 */
export async function loadAssetLibrary(libraryId: string): Promise<AssetCard[]> {
  const filePath = join(getAssetLibraryDir(), libraryId, 'asset_cards.json');
  const raw = await readFile(filePath, 'utf-8');
  return AssetCardArraySchema.parse(JSON.parse(raw));
}
