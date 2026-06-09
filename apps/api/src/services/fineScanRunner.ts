// fineScanRunner.ts — runs the REAL Python fine scan on ONE content block.
//
//   scripts/fine_scan.py (visual peak detection on the raw video + per-peak VLM)
//   -> <workDir>/<blockId>_fine_scan.json  (rich per-segment detail)
//
// Reuses the rough scan's retained raw video + rough output (see roughScanRunner).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getScanDataDir, resolvePython, runScanCommand, type ScanProgress } from './roughScanRunner';

const REPO_ROOT = process.env.SCAN_REPO_ROOT
  ? path.resolve(process.env.SCAN_REPO_ROOT)
  : path.resolve(process.cwd(), '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

/** Rich per-segment detail produced by fine_scan.py (loosely typed — all optional). */
export interface FineBlockDetail {
  blockId?: string;
  roleConfirmation?: { role?: string; confidence?: number; coarseRoleWas?: string; correctionFromCoarse?: boolean };
  dominantTone?: string;
  textOverlayBehavior?: {
    textElements?: Array<{ type?: string; content?: string; positionGrid?: number; animationIn?: string; relativePositionBucket?: string }>;
  };
  productPresentation?: { revealMode?: string; salesPointOrdering?: string };
  transitionOut?: { type?: string; incomingHintForNextBlock?: string };
  requiredAssetType?: Array<{ assetType?: string; purpose?: string; criticality?: string }>;
  claimVisualizationPattern?: { pattern?: string; relativePositionBucket?: string };
  transferableMotifs?: Array<{ motifType?: string; description?: string; transferability?: string }>;
  actionBeats?: Array<{ beatId?: string; semanticAction?: string; actionType?: string; beforeState?: string; afterState?: string }>;
  peakDetectionStats?: { candidatePeakCount?: number; selectedPeakCount?: number; regimeBoundaryCount?: number; hardCutCount?: number };
  sourceTimeRangeMs?: { start?: number; end?: number };
}

export interface FineScanResult {
  detail: FineBlockDetail;
  warnings: string[];
}

/** getScanDataDir re-export so callers can resolve the persisted work dir. */
export { getScanDataDir };

/**
 * Fine-scan a single content block of an already-rough-scanned video.
 * `videoPath` = the raw upload; `roughScanPath` = the retained rough output;
 * `workDir` = the retained per-video dir (output + clips).
 */
export async function runFineScan(
  videoPath: string,
  roughScanPath: string,
  videoId: string,
  blockId: string,
  workDir: string,
  onProgress?: ScanProgress
): Promise<FineScanResult> {
  const python = resolvePython();
  onProgress?.('精扫描中 · 视觉峰值检测 + 逐峰 VLM');

  await runScanCommand(
    python,
    [
      path.join(SCRIPTS_DIR, 'fine_scan.py'),
      '--rough-scan', roughScanPath,
      '--video', videoPath,
      '--video-id', videoId,
      '--block-ids', blockId,
      '--skip-audio',
      '--env', '.env',
      '--out-dir', workDir,
      '--work-dir', path.join(workDir, 'clips'),
    ],
    { cwd: REPO_ROOT, timeoutMs: Number(process.env.SCAN_FINE_TIMEOUT_MS ?? 300_000), label: 'fine_scan.py' }
  );

  const outPath = path.join(workDir, `${blockId}_fine_scan.json`);
  const raw = await readFile(outPath, 'utf-8');
  const detail = JSON.parse(raw) as FineBlockDetail;
  return { detail, warnings: [] };
}
