// roughScanRunner.ts — runs the REAL Python rough scan on an uploaded video.
//
// Pipeline (the same one a developer runs by hand, now wired for uploads):
//   ffmpeg (5fps/720w preview) -> scripts/rough_scan.py (VLM via Ark Files+Responses)
//   -> scripts/extract_structure_graph.py (rough-only) -> ViralStructureGraph
//
// The graph is the exact format graphToSourceVideo() already consumes. The per-video
// work dir (preview, rough.json, graph.json, clips/) is RETAINED so a follow-up fine
// scan can reuse the raw rough output + the same dir for clips.

import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import type { ViralStructureGraph } from '@viral-struct/shared';
import { ViralStructureGraphSchema } from '@viral-struct/shared';

/** Monorepo root (the API runs with cwd=apps/api; scripts + .venv live at the root). */
const REPO_ROOT = process.env.SCAN_REPO_ROOT
  ? path.resolve(process.env.SCAN_REPO_ROOT)
  : path.resolve(process.cwd(), '..', '..');

const SCRIPTS_DIR = path.join(REPO_ROOT, 'scripts');

/** Persistent per-video scan dir (retained so fine scan can reuse rough output + clips). */
export function getScanDataDir(): string {
  return process.env.SCAN_DATA_DIR ? path.resolve(process.env.SCAN_DATA_DIR) : path.join(tmpdir(), 'viral-scans');
}

/** Python interpreter — prefer the repo .venv, fall back to PATH `python`. */
export function resolvePython(): string {
  if (process.env.SCAN_PYTHON) return process.env.SCAN_PYTHON;
  const venvWin = path.join(REPO_ROOT, '.venv', 'Scripts', 'python.exe');
  const venvNix = path.join(REPO_ROOT, '.venv', 'bin', 'python');
  if (existsSync(venvWin)) return venvWin;
  if (existsSync(venvNix)) return venvNix;
  return 'python';
}

export function resolveFfmpeg(): string {
  return process.env.FFMPEG_PATH?.trim() || ffmpegStatic || 'ffmpeg';
}

export function buildScanCommandEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  if (!ffmpegStatic) return env;

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  const currentPath = env[pathKey] ?? '';
  const ffmpegDir = path.dirname(ffmpegStatic);
  const pathParts = currentPath.split(path.delimiter).filter(Boolean);
  if (!pathParts.includes(ffmpegDir)) {
    env[pathKey] = [ffmpegDir, ...pathParts].join(path.delimiter);
  }
  return env;
}

export interface ScanProgress {
  (stage: string): void;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn a command, capture output, reject on non-zero exit or timeout. */
export function runScanCommand(
  command: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number; label: string; env?: NodeJS.ProcessEnv }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, windowsHide: true, env: buildScanCommandEnv(opts.env) });
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
  /** Persisted rough scan JSON (kept for a follow-up fine scan). */
  roughScanPath: string;
  /** Persisted per-video work dir (preview, rough.json, graph.json, clips/). */
  workDir: string;
}

/**
 * Run the real rough scan on `videoPath` and return a ViralStructureGraph.
 * `videoId` should be a filesystem-safe id (used for the work dir + sampling).
 * The work dir is RETAINED for a follow-up fine scan; callers evict it on TTL.
 */
export async function runRoughScan(
  videoPath: string,
  videoId: string,
  durationSec: number,
  onProgress?: ScanProgress
): Promise<RoughScanResult> {
  const python = resolvePython();
  const ffmpeg = resolveFfmpeg();
  const workDir = path.join(getScanDataDir(), videoId);
  await mkdir(path.join(workDir, 'clips'), { recursive: true });
  const warnings: string[] = [];

  // 1) Preprocess → 5fps / 720w preview (what rough_scan.py expects).
  onProgress?.('预处理视频（5fps 预览）');
  const preview = path.join(workDir, 'preview.mp4');
  await runScanCommand(ffmpeg, ['-y', '-i', videoPath, '-vf', 'fps=5,scale=720:-2', '-an', preview], {
    timeoutMs: 120_000,
    label: 'ffmpeg preprocess',
  });

  // 2) Rough scan via the VLM (upload + Responses API). Slow — generous timeout.
  onProgress?.('粗扫描中 · VLM 解析镜头与结构');
  const roughOut = path.join(workDir, 'rough.json');
  await runScanCommand(
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
  const graphOut = path.join(workDir, 'graph.json');
  await runScanCommand(
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
  return { graph, warnings, roughScanPath: roughOut, workDir };
}
