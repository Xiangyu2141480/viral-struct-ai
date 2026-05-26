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

export function getSeedVideoDir(): string {
  return resolveRepoPath(process.env.SEED_VIDEO_DIR, './seed_assets/raw_videos');
}
