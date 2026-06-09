// roughScanRunner.ts — runs the REAL Python rough scan on an uploaded video.
//
// Pipeline (the same one a developer runs by hand, now wired for uploads):
//   ffmpeg (5fps/720w preview) -> scripts/rough_scan.py (VLM via Ark Files+Responses)
//   -> scripts/extract_structure_graph.py (rough-only) -> ViralStructureGraph
//
// The graph is the exact format graphToSourceVideo() already consumes, so the
// rest of the pipeline (UI timeline, slot matching, etc.) is unchanged.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ViralStructureGraph } from '@viral-struct/shared';
import { ViralStructureGraphSchema } from '@viral-struct/shared';

/** Monorepo root (the API runs with cwd=apps/api; scripts + .venv live at the root). */
const REPO_ROOT = process.env.SCAN_REPO_ROOT
  ? path.resolve(process.env.SCAN_REPO_ROOT)
  : path.resolve(process.cwd(), '..', '..');

const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

/** Python interpreter — prefer the repo .venv, fall back to PATH `python`. */
function resolvePython(): string {
  if (process.env.SCAN_PYTHON) return process.env.SCAN_PYTHON;
  const venvWin = path.join(REPO_ROOT, '.venv', 'Scripts', 'python.exe');
  const venvNix = path.join(REPO_ROOT, '.venv', 'bin', 'python');
  if (existsSync(venvWin)) return venvWin;
  if (existsSync(venvNix)) return venvNix;
  return 'python';
}

function resolveFfmpeg(): string {
  return process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
}

export interface RoughScanProgress {
  (stage: string): void;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn a command, capture output, reject on non-zero exit or timeout. */
function run(command: string, args: string[], opts: { cwd?: string; timeoutMs: number; label: string }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${opts.label} timed out after ${Math.round(opts.timeoutMs / 1000)}s`));
    }, opts.timeoutMs);

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`${opts.label} failed to start: ${err.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ code, stdout, stderr });
      } else {
        const tail = (stderr || stdout).split('\n').filter(Boolean).slice(-6).join(' | ').slice(0, 600);
        reject(new Error(`${opts.label} exited ${code}: ${tail}`));
      }
    });
  });
}

export interface RoughScanResult {
  graph: ViralStructureGraph;
  warnings: string[];
}

/**
 * Run the real rough scan on `videoPath` and return a ViralStructureGraph.
 * `videoId` should be a filesystem-safe id (used for artifact naming + sampling).
 */
export async function runRoughScan(
  videoPath: string,
  videoId: string,
  durationSec: number,
  onProgress?: RoughScanProgress
): Promise<RoughScanResult> {
  const python = resolvePython();
  const ffmpeg = resolveFfmpeg();
  const work = await mkdtemp(path.join(tmpdir(), 'roughscan-'));
  const warnings: string[] = [];

  try {
    // 1) Preprocess → 5fps / 720w preview (what rough_scan.py expects).
    onProgress?.('预处理视频（5fps 预览）');
    const preview = path.join(work, 'preview.mp4');
    await run(ffmpeg, ['-y', '-i', videoPath, '-vf', 'fps=5,scale=720:-2', '-an', preview], {
      timeoutMs: 120_000,
      label: 'ffmpeg preprocess',
    });

    // 2) Rough scan via the VLM (upload + Responses API). Slow — generous timeout.
    onProgress?.('粗扫描中 · VLM 解析镜头与结构');
    const roughOut = path.join(work, 'rough.json');
    await run(
      python,
      [
        path.join(SCRIPTS_DIR, 'rough_scan.py'),
        '--video', preview,
        '--video-id', videoId,
        '--duration', String(Math.max(1, Math.round(durationSec * 100) / 100)),
        '--env', '.env',
        '--out', roughOut,
      ],
      { cwd: REPO_ROOT, timeoutMs: Number(process.env.SCAN_ROUGH_TIMEOUT_MS ?? 300_000), label: 'rough_scan.py' }
    );

    // 3) Bridge rough-only → ViralStructureGraph (no fine scan yet).
    onProgress?.('构建结构图');
    const graphOut = path.join(work, 'graph.json');
    await run(
      python,
      [
        path.join(SCRIPTS_DIR, 'extract_structure_graph.py'),
        '--video-id', videoId,
        '--rough-scan', roughOut,
        '--output', graphOut,
      ],
      { cwd: REPO_ROOT, timeoutMs: 60_000, label: 'extract_structure_graph.py' }
    );

    const raw = await readFile(graphOut, 'utf-8');
    const graph = ViralStructureGraphSchema.parse(JSON.parse(raw));
    return { graph, warnings };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
