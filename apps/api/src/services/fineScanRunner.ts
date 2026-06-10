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

// Fine scan spawns a memory/CPU-heavy Python process (PyAV decode + OpenCV optical
// flow). Running several at once exhausts memory/threads/handles on constrained
// machines ("[Errno 11] Resource temporarily unavailable" / "[Errno 12] Cannot
// allocate memory" / Windows "页面文件太小"). Cap how many fine scans run at once —
// extra requests QUEUE (the UI shows 排队中) and run as slots free. Default 1
// (serialize, safest on a tight machine); raise via FINE_SCAN_MAX_CONCURRENCY.
const FINE_SCAN_MAX_CONCURRENCY = Math.max(1, Number(process.env.FINE_SCAN_MAX_CONCURRENCY ?? 1));
let fineScanActive = 0;
const fineScanWaiters: Array<() => void> = [];

function acquireFineScanSlot(): Promise<void> {
  if (fineScanActive < FINE_SCAN_MAX_CONCURRENCY) {
    fineScanActive += 1;
    return Promise.resolve();
  }
  // Slot stays "held" for this waiter; release() hands it over without decrementing.
  return new Promise<void>((resolve) => fineScanWaiters.push(resolve));
}

function releaseFineScanSlot(): void {
  const next = fineScanWaiters.shift();
  if (next) {
    next(); // transfer the slot directly to the next queued fine scan
  } else {
    fineScanActive = Math.max(0, fineScanActive - 1);
  }
}

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
  if (fineScanActive >= FINE_SCAN_MAX_CONCURRENCY) {
    onProgress?.('排队中 · 前面还有精扫描任务（内存保护，逐个运行）');
  }
  await acquireFineScanSlot();
  try {
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
  } finally {
    releaseFineScanSlot();
  }
}

export interface FineScanBatchResult {
  /** Per-block detail, keyed by block id (== source segment id). */
  details: Record<string, FineBlockDetail>;
  warnings: string[];
}

/**
 * Fine-scan MANY blocks in ONE python process. fine_scan.py already parallelizes ACROSS blocks
 * (block_workers, default 4) and WITHIN a block (candidate_workers, default 6) behind a shared HTTP
 * semaphore — so one batch process is far faster than N serial single-block processes AND uses roughly the
 * memory of a single process (no N× PyAV/OpenCV/HTTP fan-out from N separate interpreters). This consumes a
 * single fine-scan concurrency slot regardless of how many blocks it covers.
 */
export async function runFineScanBatch(
  videoPath: string,
  roughScanPath: string,
  videoId: string,
  blockIds: string[],
  workDir: string,
  onProgress?: ScanProgress
): Promise<FineScanBatchResult> {
  const ids = Array.from(new Set(blockIds.filter(Boolean)));
  if (ids.length === 0) return { details: {}, warnings: [] };
  const python = resolvePython();
  if (fineScanActive >= FINE_SCAN_MAX_CONCURRENCY) {
    onProgress?.('排队中 · 前面还有精扫描任务（内存保护，逐个运行）');
  }
  await acquireFineScanSlot();
  try {
    onProgress?.(`精扫描中 · ${ids.length} 段并发（视觉峰值 + 逐峰 VLM）`);

    await runScanCommand(
      python,
      [
        path.join(SCRIPTS_DIR, 'fine_scan.py'),
        '--rough-scan', roughScanPath,
        '--video', videoPath,
        '--video-id', videoId,
        '--block-ids', ids.join(','),
        '--skip-audio',
        '--env', '.env',
        '--out-dir', workDir,
        '--work-dir', path.join(workDir, 'clips'),
      ],
      // Batch covers several blocks → a longer ceiling than the single-block timeout.
      { cwd: REPO_ROOT, timeoutMs: Number(process.env.SCAN_FINE_BATCH_TIMEOUT_MS ?? 900_000), label: 'fine_scan.py (batch)' }
    );

    const details: Record<string, FineBlockDetail> = {};
    const warnings: string[] = [];
    for (const blockId of ids) {
      try {
        const raw = await readFile(path.join(workDir, `${blockId}_fine_scan.json`), 'utf-8');
        details[blockId] = JSON.parse(raw) as FineBlockDetail;
      } catch (e) {
        warnings.push(`精扫描结果缺失（${blockId}）：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return { details, warnings };
  } finally {
    releaseFineScanSlot();
  }
}
