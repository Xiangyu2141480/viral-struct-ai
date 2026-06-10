import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { AigcBeatPlan, WanJob } from '@viral-struct/shared';
import { type WanClientConfig, type WanGenerateResult, downloadVideo, generateClip } from './wanVideoClient';

/**
 * AIGC renderer (orchestrator, IO).
 *
 * Resolves every {@link AigcBeatPlan} into a local clip — matched real clips are used verbatim; `generate`
 * beats are produced by Wan2.7 (bounded concurrency) and downloaded, falling back to a real clip on failure —
 * then stitches them in timeline order with ffmpeg, **keeping each beat's own audio** (P1; unified BGM later).
 *
 * `generate` / `download` / `runFfmpeg` are injectable so tests run with zero network, zero quota and no ffmpeg.
 */

export interface AigcRenderDeps {
  generate?: (cfg: WanClientConfig, job: WanJob) => Promise<WanGenerateResult>;
  download?: (url: string, dest: string) => Promise<string>;
  runFfmpeg?: (args: string[]) => Promise<{ code: number; out: string }>;
}

export interface AigcRenderInput {
  plans: AigcBeatPlan[];
  outputPath: string;
  cfg: WanClientConfig;
  /** Where generated beat clips are downloaded / staged. */
  workDir: string;
  /** Max concurrent Wan generations (default 4). */
  concurrency?: number;
}

export interface AigcBeatOutcome {
  beatId: string;
  index: number;
  source: 'real_clip' | 'generated' | 'fallback' | 'failed';
  clipPath?: string;
  error?: string;
}

export interface AigcRenderResult {
  outputPath: string;
  rendered: boolean;
  beats: AigcBeatOutcome[];
  warnings: string[];
}

export async function renderAigcTimeline(input: AigcRenderInput, deps: AigcRenderDeps = {}): Promise<AigcRenderResult> {
  const generate = deps.generate ?? generateClip;
  const download = deps.download ?? downloadVideo;
  const runFfmpeg = deps.runFfmpeg ?? defaultFfmpeg;
  const concurrency = Math.max(1, input.concurrency ?? 4);
  await mkdir(input.workDir, { recursive: true });

  const outcomes: AigcBeatOutcome[] = new Array(input.plans.length);

  // 1) real_clip beats resolve immediately.
  for (const plan of input.plans) {
    if (plan.kind === 'real_clip') {
      outcomes[plan.index] = { beatId: plan.beatId, index: plan.index, source: 'real_clip', clipPath: plan.clipUrl };
    }
  }

  // 2) generate beats via a bounded worker pool.
  const genPlans = input.plans.filter((p): p is Extract<AigcBeatPlan, { kind: 'generate' }> => p.kind === 'generate');
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < genPlans.length) {
      const plan = genPlans[cursor++]!;
      let outcome: AigcBeatOutcome;
      const res = await generate(input.cfg, plan.job);
      if (res.status === 'SUCCEEDED' && res.videoUrl) {
        const dest = path.join(input.workDir, `beat_${plan.index}.mp4`);
        try {
          await download(res.videoUrl, dest);
          outcome = { beatId: plan.beatId, index: plan.index, source: 'generated', clipPath: dest };
        } catch (error) {
          outcome = fallbackOrFail(plan, `download: ${errMsg(error)}`);
        }
      } else {
        outcome = fallbackOrFail(plan, res.error ?? res.status);
      }
      outcomes[plan.index] = outcome;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, genPlans.length)) }, () => worker()));

  // 3) stitch resolved clips in timeline order; failed beats are dropped (logged).
  const warnings = outcomes
    .filter((o) => o && o.source === 'failed')
    .map((o) => `beat ${o.index} (${o.beatId}) failed: ${o.error ?? 'unknown'}`);
  const ordered = outcomes.filter((o): o is AigcBeatOutcome => Boolean(o?.clipPath)).sort((a, b) => a.index - b.index);

  if (ordered.length === 0) {
    return { outputPath: input.outputPath, rendered: false, beats: outcomes, warnings: [...warnings, 'no resolvable beats to stitch'] };
  }

  await mkdir(path.dirname(input.outputPath), { recursive: true });
  const ff = await runFfmpeg(buildConcatArgs(ordered.map((o) => o.clipPath!), input.outputPath));
  const rendered = ff.code === 0;
  return {
    outputPath: input.outputPath,
    rendered,
    beats: outcomes,
    warnings: rendered ? warnings : [...warnings, `ffmpeg exited ${ff.code}: ${ff.out.slice(-300)}`]
  };
}

function fallbackOrFail(plan: Extract<AigcBeatPlan, { kind: 'generate' }>, error: string): AigcBeatOutcome {
  if (plan.fallbackClipUrl) {
    return { beatId: plan.beatId, index: plan.index, source: 'fallback', clipPath: plan.fallbackClipUrl, error };
  }
  return { beatId: plan.beatId, index: plan.index, source: 'failed', error };
}

/**
 * Normalize each clip to 720×1280 / 30fps and concat keeping audio (P1). Assumes each clip has an audio track
 * (Wan output + real clips do); a fully-silent clip would need an `anullsrc` track (deferred to P2).
 */
export function buildConcatArgs(clips: string[], outputPath: string): string[] {
  const inputs = clips.flatMap((clip) => ['-i', clip]);
  const filters: string[] = [];
  for (let i = 0; i < clips.length; i += 1) {
    filters.push(
      `[${i}:v]scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
    );
    filters.push(`[${i}:a]aresample=async=1[a${i}]`);
  }
  const concatIn = clips.map((_, i) => `[v${i}][a${i}]`).join('');
  const filter = `${filters.join(';')};${concatIn}concat=n=${clips.length}:v=1:a=1[v][a]`;
  return [
    ...inputs,
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-r', '30',
    '-y', outputPath
  ];
}

function defaultFfmpeg(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (chunk) => (out += String(chunk)));
    proc.stderr.on('data', (chunk) => (out += String(chunk)));
    proc.on('error', (error) => resolve({ code: -1, out: out + String(error) }));
    proc.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
