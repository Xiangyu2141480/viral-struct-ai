import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiSrcDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(apiSrcDir, '../../../..');

export function resolveRepoPath(value: string | undefined, fallback: string): string {
  const configured = value && value.trim().length > 0 ? value : fallback;
  return path.isAbsolute(configured) ? configured : path.resolve(repoRoot, configured);
}

export function getRepoRoot(): string {
  return repoRoot;
}

export function getUploadDir(): string {
  return resolveRepoPath(process.env.UPLOAD_DIR, './uploads');
}

export function getFrameDir(): string {
  return resolveRepoPath(process.env.FRAME_DIR, './frames');
}

export function getCoverDir(): string {
  return resolveRepoPath(process.env.COVER_DIR, './covers');
}

export function getDemoAssetDir(): string {
  return resolveRepoPath(process.env.DEMO_ASSET_DIR, './seed_assets/demo_assets');
}

export function getAssetLibraryDir(): string {
  return resolveRepoPath(process.env.ASSET_LIBRARY_DIR, './seed_assets/asset_libraries');
}

export function getAnalysisDir(): string {
  return resolveRepoPath(process.env.ANALYSIS_DIR, './seed_assets/analysis');
}

export function getRenderDir(): string {
  return resolveRepoPath(process.env.RENDER_DIR, './renders');
}

/**
 * PERSISTENT dir for the file-backed pipeline database (scan results, slot matches,
 * and other records that previously lived only in memory). Sits next to the other
 * persistent seed_assets stores so records survive server restarts.
 */
export function getDbDir(): string {
  return resolveRepoPath(process.env.DB_DIR, './seed_assets/db');
}

/** Folder where the live pipeline drops per-run data for sharing (see pipeline_data/README.md). */
export function getPipelineDataDir(): string {
  return resolveRepoPath(process.env.PIPELINE_DATA_DIR, './pipeline_data');
}

export function getSeedVideoDir(): string {
  return resolveRepoPath(process.env.SEED_VIDEO_DIR, './seed_assets/raw_videos');
}

/**
 * PERSISTENT dir for the saved-structure library ("结构样例库"). Mirrors the other
 * persistent seed_assets dirs (NOT os.tmpdir) so saved structures survive restarts.
 */
export function getStructLibraryDir(): string {
  return resolveRepoPath(process.env.STRUCT_LIBRARY_DIR, './seed_assets/struct_library');
}
