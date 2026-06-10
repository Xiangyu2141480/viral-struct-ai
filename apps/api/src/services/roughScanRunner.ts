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
import { mkdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ViralStructureGraph } from '@viral-struct/shared';
import { ViralStructureGraphSchema } from '@viral-struct/shared';
import { probeVideo } from './assetManager/mediaProbeService';

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

function resolveFfmpeg(): string {
  return process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
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
  opts: { cwd?: string; timeoutMs: number; label: string }
): Promise<RunResult> {
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
  onProgress?: ScanProgress
): Promise<RoughScanResult> {
  const python = resolvePython();
  const ffmpeg = resolveFfmpeg();
  const workDir = path.join(getScanDataDir(), videoId);
  await mkdir(path.join(workDir, 'clips'), { recursive: true });
  const warnings: string[] = [];

  // Duration is only a prompt hint for rough_scan.py. Probe it cheaply via ffprobe
  // rather than running the full analyzeVideoFile (keyframe + cover extraction) pass
  // just to read it — that was redundant ffmpeg work + an extra failure surface.
  onProgress?.('读取视频信息');
  const durationSec = (await probeVideo(videoPath)).media.durationSec ?? 0;

  // 1) Preprocess → 5fps / 720w preview (what rough_scan.py expects).
  onProgress?.('预处理视频（5fps 预览）');
  const preview = path.join(workDir, 'preview.mp4');
  await runScanCommand(
    ffmpeg,
    [
      '-y',
      '-i',
      videoPath,
      '-vf',
      'fps=5,scale=720:-2',
      '-an',
      '-c:v',
      'libx264',
      '-crf',
      '30',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      preview,
    ],
    {
      timeoutMs: 120_000,
      label: 'ffmpeg preprocess',
    }
  );

  // Honest size check: an oversized preview makes the upload slow/flaky. Surface it.
  const PREVIEW_SIZE_WARN_BYTES = 8 * 1024 * 1024;
  try {
    const previewBytes = (await stat(preview)).size;
    if (previewBytes > PREVIEW_SIZE_WARN_BYTES) {
      const mb = (previewBytes / (1024 * 1024)).toFixed(1);
      warnings.push(`预览体积较大(${mb}MB)，上传可能较慢`);
    }
  } catch {
    // stat failure is non-fatal — the upload step will surface a real error if the file is missing.
  }

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
      // Keep debug dumps in THIS video's work dir. The script's defaults point at the
      // canonical DEFAULT_VIDEO_ID analysis dir (computed at import time), so without
      // these every uploaded scan would misfile its debug + overwrite the sample's.
      '--raw-out', path.join(workDir, 'rough_raw_response.json'),
      '--text-out', path.join(workDir, 'rough_response_text.txt'),
      '--file-info-out', path.join(workDir, 'uploaded_file_info.json'),
    ],
    // Runner timeout must cover the script's own budget: file-preprocessing wait
    // (≤300s) + Responses API (≤600s). The old 300s default SIGKILLed real scans.
    { cwd: REPO_ROOT, timeoutMs: Number(process.env.SCAN_ROUGH_TIMEOUT_MS ?? 900_000), label: 'rough_scan.py' }
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
