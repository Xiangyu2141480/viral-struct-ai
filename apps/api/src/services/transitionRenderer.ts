// transitionRenderer.ts — render ONE transition seam between two real clips.
//
// The non-generative HyperFrames transition path: take the two adjacent slots' REAL
// assets (the from-slot's clip + the to-slot's clip) and composite a real transition
// between them with ffmpeg `xfade` — zero new pixels, honest "首尾帧形变转场". The
// transition STYLE comes from the source seam's real type (Boundary Scan: 叠化/推镜/…)
// and the DURATION is content-aware. Returns a short preview MP4 (from → seam → to).
//
// Generative first/last-frame INTERPOLATION (new in-between pixels) is a different
// channel (AIGC / Wan first_frame) and is NOT done here.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import { nanoid } from 'nanoid';

/** UI transition type → ffmpeg xfade transition name. 硬切/卡点 still get a short soft
 *  blend here because the user explicitly asked to COMPOSE a transition ("过渡帧"). */
const XFADE_BY_TYPE: Record<string, string> = {
  叠化: 'dissolve',
  推镜: 'slideleft',
  硬切: 'fade',
  卡点: 'fadeblack',
};

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']);
const CLIP_SEC = 2; // each side shows ~2s of real content around the seam

function resolveFfmpeg(): string {
  return process.env.FFMPEG_PATH?.trim() || (ffmpegStatic as string | null) || 'ffmpeg';
}

function isImage(p: string): boolean {
  return IMAGE_EXT.has(path.extname(p).toLowerCase());
}

/** Per-input args: still images loop into a CLIP_SEC clip; videos take their head. */
function inputArgs(p: string): string[] {
  return isImage(p) ? ['-loop', '1', '-framerate', '30', '-t', String(CLIP_SEC), '-i', p] : ['-t', String(CLIP_SEC), '-i', p];
}

export interface TransitionRenderInput {
  fromPath: string;
  toPath: string;
  uiType: string;
  durationMs: number;
  outDir: string;
  onStage?: (stage: string) => void;
}

export interface TransitionRenderResult {
  rendered: boolean;
  /** Web path under /media/renders (caller prefixes the absolute host). */
  mediaUrl: string | null;
  transition: string;
  durationSec: number;
  warnings: string[];
}

function spawnFfmpeg(bin: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => proc.kill('SIGKILL'), timeoutMs);
    proc.stderr.on('data', (c) => (stderr += String(c)));
    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stderr: stderr + String(err) });
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

/**
 * Composite a real transition between two clips with ffmpeg xfade. Never throws —
 * returns a structured result; rendered:false carries the reason in warnings.
 */
export async function renderTransitionPreview(input: TransitionRenderInput): Promise<TransitionRenderResult> {
  const warnings: string[] = [];
  const transition = XFADE_BY_TYPE[input.uiType] ?? 'dissolve';
  // Clamp the transition window so it never swallows a whole clip.
  const durationSec = Math.min(Math.max(input.durationMs / 1000, 0.12), CLIP_SEC - 0.2);

  if (!existsSync(input.fromPath)) {
    return { rendered: false, mediaUrl: null, transition, durationSec, warnings: [`from 素材文件不存在：${input.fromPath}`] };
  }
  if (!existsSync(input.toPath)) {
    return { rendered: false, mediaUrl: null, transition, durationSec, warnings: [`to 素材文件不存在：${input.toPath}`] };
  }

  await mkdir(input.outDir, { recursive: true });
  const id = nanoid(10);
  const outFile = path.join(input.outDir, `transition_${id}.mp4`);

  // Normalize both sides to 720x1280 / 30fps / yuv420p, then xfade with an offset that
  // starts the blend `durationSec` before the first clip ends.
  // NOTE: do NOT add setpts=PTS-STARTPTS here — it desyncs xfade's `offset` timeline
  // and yields "Nothing was written … received no packets" (verified).
  const norm = (label: string) =>
    `${label}scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:-1:-1:color=black,setsar=1,fps=30,format=yuv420p`;
  // Start the blend `durationSec` before the first clip ends, with a 0.1s safety margin
  // so offset+duration stays strictly < CLIP_SEC (the xfade edge case fails otherwise).
  const offset = Math.max(0.1, CLIP_SEC - durationSec - 0.1).toFixed(3);
  const filter =
    `${norm('[0:v]')}[v0];${norm('[1:v]')}[v1];` +
    `[v0][v1]xfade=transition=${transition}:duration=${durationSec.toFixed(3)}:offset=${offset},format=yuv420p[v]`;

  const args = [
    '-y',
    ...inputArgs(input.fromPath),
    ...inputArgs(input.toPath),
    '-filter_complex', filter,
    '-map', '[v]',
    '-an',
    '-r', '30',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outFile,
  ];

  input.onStage?.(`合成转场（${input.uiType} → xfade ${transition}）`);
  const { code, stderr } = await spawnFfmpeg(resolveFfmpeg(), args, 120_000);
  if (code !== 0 || !existsSync(outFile)) {
    warnings.push(`ffmpeg xfade 失败（code=${code}）：${stderr.slice(-300).trim()}`);
    return { rendered: false, mediaUrl: null, transition, durationSec, warnings };
  }

  return {
    rendered: true,
    mediaUrl: `/media/renders/${path.basename(outFile)}`,
    transition,
    durationSec,
    warnings,
  };
}

/** Content-aware transition duration (ms) from the seam type + the source rhythm.
 *  Fast-cut source → shorter; slow → longer. Capped so it never eats a beat. */
export function transitionDurationMs(uiType: string, avgShotSec?: number): number {
  const base: Record<string, number> = { 硬切: 160, 卡点: 180, 叠化: 280, 推镜: 360 };
  const b = base[uiType] ?? 280;
  const factor = avgShotSec == null ? 1 : avgShotSec < 1.5 ? 0.6 : avgShotSec > 3 ? 1.3 : 1;
  return Math.round(Math.min(Math.max(b * factor, 120), 600));
}
