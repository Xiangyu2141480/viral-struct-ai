// boundaryScanRunner.ts — runs the REAL Python boundary micro-scan on ONE seam.
//
//   scripts/boundary_scan.py (microscope clip around a rough boundary + VLM)
//   -> <workDir>/boundary/boundary_micro_scan.json  (transitionCandidate per boundary)
//
// Reuses the rough scan's retained raw video + rough output (see roughScanRunner).
// This is the on-demand counterpart to wiring boundary_scan into the offline graph
// build: the web rough scan does NOT run it (so graph.boundaries is absent and the UI
// synthesizes all-硬切 seams), and this lets the user re-scan ONE seam to recover its
// real transition type (叠化/推镜/…). Beats are skipped (--skip-beats), so 卡点 — which
// needs beat alignment — is never inferred here; it stays 硬切/叠化/推镜.

import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolvePython, runScanCommand, type ScanProgress } from './roughScanRunner';

const REPO_ROOT = process.env.SCAN_REPO_ROOT
  ? path.resolve(process.env.SCAN_REPO_ROOT)
  : path.resolve(process.cwd(), '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

// Boundary scan spawns ffmpeg (slowed microscope clip) + a VLM upload — lighter than
// fine scan but still memory/IO sensitive. Serialize by default (raise via
// BOUNDARY_SCAN_MAX_CONCURRENCY); extra requests QUEUE and run as slots free.
const BOUNDARY_SCAN_MAX_CONCURRENCY = Math.max(1, Number(process.env.BOUNDARY_SCAN_MAX_CONCURRENCY ?? 1));
let boundaryScanActive = 0;
const boundaryScanWaiters: Array<() => void> = [];

function acquireBoundaryScanSlot(): Promise<void> {
  if (boundaryScanActive < BOUNDARY_SCAN_MAX_CONCURRENCY) {
    boundaryScanActive += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => boundaryScanWaiters.push(resolve));
}

function releaseBoundaryScanSlot(): void {
  const next = boundaryScanWaiters.shift();
  if (next) {
    next();
  } else {
    boundaryScanActive = Math.max(0, boundaryScanActive - 1);
  }
}

/** The one boundary's transition candidate, read back from boundary_micro_scan.json. */
export interface BoundaryScanCandidate {
  boundaryId: string;
  /** True when the VLM found an actual transition unit (vs a plain content cut). */
  exists: boolean;
  techniqueTags: string[];
  confidence?: number;
  /** Free-text visual description of the change (honest evidence). */
  visualChange?: string;
}

export interface BoundaryScanResult {
  candidate: BoundaryScanCandidate;
  warnings: string[];
}

interface MicroScanDoc {
  boundaries?: Array<{
    boundaryId?: string;
    transitionCandidate?: {
      exists?: boolean;
      techniqueTags?: unknown;
      confidence?: number;
      visualChange?: string;
    };
  }>;
}

/**
 * Boundary-scan a single seam of an already-rough-scanned video.
 * `videoPath` = the raw upload; `roughScanPath` = the retained rough output (has the
 * boundaryCandidates); `workDir` = the retained per-video dir. `boundaryId` is the
 * rough scan's id for the seam (e.g. `boundary_003`).
 */
export async function runBoundaryScan(
  videoPath: string,
  roughScanPath: string,
  boundaryId: string,
  workDir: string,
  onProgress?: ScanProgress,
): Promise<BoundaryScanResult> {
  const python = resolvePython();
  if (boundaryScanActive >= BOUNDARY_SCAN_MAX_CONCURRENCY) {
    onProgress?.('排队中 · 前面还有转场扫描任务（逐个运行）');
  }
  await acquireBoundaryScanSlot();
  try {
    onProgress?.('转场微扫描中 · 边界显微 + VLM 解析');
    const outDir = path.join(workDir, 'boundary');
    await mkdir(outDir, { recursive: true });

    await runScanCommand(
      python,
      [
        path.join(SCRIPTS_DIR, 'boundary_scan.py'),
        '--rough-scan', roughScanPath,
        '--video', videoPath,
        '--boundary-id', boundaryId,
        '--skip-beats',
        '--env', '.env',
        '--out-dir', outDir,
      ],
      { cwd: REPO_ROOT, timeoutMs: Number(process.env.SCAN_BOUNDARY_TIMEOUT_MS ?? 300_000), label: 'boundary_scan.py' },
    );

    const outPath = path.join(outDir, 'boundary_micro_scan.json');
    const doc = JSON.parse(await readFile(outPath, 'utf-8')) as MicroScanDoc;
    const entry = (doc.boundaries ?? []).find((b) => b.boundaryId === boundaryId);
    if (!entry) {
      throw new Error(`边界扫描完成但未返回 ${boundaryId} 的结果`);
    }
    const tc = entry.transitionCandidate ?? {};
    const techniqueTags = Array.isArray(tc.techniqueTags)
      ? tc.techniqueTags.filter((t): t is string => typeof t === 'string')
      : [];
    return {
      candidate: {
        boundaryId,
        exists: Boolean(tc.exists),
        techniqueTags,
        confidence: typeof tc.confidence === 'number' ? tc.confidence : undefined,
        visualChange: typeof tc.visualChange === 'string' ? tc.visualChange : undefined,
      },
      warnings: [],
    };
  } finally {
    releaseBoundaryScanSlot();
  }
}
