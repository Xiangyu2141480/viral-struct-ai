import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WanJob } from '@viral-struct/shared';
import { uploadFileForModel } from './dashscopeUpload';

/**
 * Wan2.7 (Aliyun DashScope) async video-generation client.
 *
 * Flow per job: POST create-task (X-DashScope-Async: enable) → poll GET /tasks/{id} until SUCCEEDED/FAILED.
 * IO lives here (apps/api), keeping the video-agent package pure. `fetch`/`sleep`/`readFile` are injectable so
 * tests run with zero network and zero quota.
 *
 * Endpoint note: use the GLOBAL host `https://dashscope.aliyuncs.com/api/v1` + `X-DashScope-WorkSpace` header.
 * Do NOT use the workspace `*.maas.aliyuncs.com` domain (its TLS cert does not cover the video API host).
 */

export interface WanClientConfig {
  apiKey: string;
  baseUrl: string;
  workspaceId: string;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}

export type WanTaskStatus = 'SUCCEEDED' | 'FAILED' | 'TIMEOUT';

export interface WanGenerateResult {
  beatId: string;
  taskId: string | null;
  status: WanTaskStatus;
  videoUrl?: string;
  error?: string;
}

export interface WanClientDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  readFileImpl?: (filePath: string) => Promise<Buffer>;
  /** Upload a local video to a temporary `oss://` URL (DashScope rejects local/base64 video). */
  uploadImpl?: (model: string, localPath: string) => Promise<string>;
}

/** Our internal media-type names → DashScope wire names. videoedit's source clip is `video` on the wire. */
const WIRE_MEDIA_TYPE: Record<string, string> = { video_edit_source: 'video' };
function wireMediaType(type: string): string {
  return WIRE_MEDIA_TYPE[type] ?? type;
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
};
const URL_LIKE = /^(https?:|oss:|data:)/i;
const TERMINAL_FAIL = new Set(['FAILED', 'UNKNOWN', 'CANCELED']);

export function wanConfigFromEnv(): WanClientConfig {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw new Error('DASHSCOPE_API_KEY is required for Wan video generation.');
  }
  return {
    apiKey,
    baseUrl: process.env.WAN_BASE_URL ?? 'https://dashscope.aliyuncs.com/api/v1',
    workspaceId: process.env.WAN_WORKSPACE_ID ?? ''
  };
}

function authHeaders(cfg: WanClientConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.apiKey}`,
    ...(cfg.workspaceId ? { 'X-DashScope-WorkSpace': cfg.workspaceId } : {}),
    ...extra
  };
}

/**
 * Resolve a job's media to request-ready `{type, url}` (with wire-aligned `type`):
 *   - already a url (http/oss/data)  → pass through
 *   - local image (reference/first)  → base64 data URI
 *   - local video (reference/source) → upload to a temporary `oss://` URL (DashScope rejects base64 video)
 */
async function resolveMedia(
  job: WanJob,
  deps: { readFileImpl: (p: string) => Promise<Buffer>; uploadImpl: (model: string, localPath: string) => Promise<string> }
): Promise<Array<{ type: string; url: string }>> {
  const resolved: Array<{ type: string; url: string }> = [];
  for (const m of job.media) {
    const type = wireMediaType(m.type);
    if (URL_LIKE.test(m.url)) {
      resolved.push({ type, url: m.url });
      continue;
    }
    if (m.type === 'reference_image' || m.type === 'first_frame') {
      const buf = await deps.readFileImpl(m.url);
      const mime = IMAGE_MIME[path.extname(m.url).toLowerCase()] ?? 'image/png';
      resolved.push({ type, url: `data:${mime};base64,${buf.toString('base64')}` });
    } else {
      // Local video (reference_video / videoedit source): upload to a temp oss:// URL first.
      resolved.push({ type, url: await deps.uploadImpl(job.model, m.url) });
    }
  }
  return resolved;
}

function buildRequestBody(job: WanJob, media: Array<{ type: string; url: string }>): unknown {
  // videoedit keeps the source clip's aspect (no `ratio`) and its original audio (`audio_setting: origin`).
  // It also OMITS `duration` (default 0 = keep source length): forcing a shorter duration makes the algo
  // trim the source first, and that trim→re-download step fails internally (InternalError.Algo).
  const isVideoEdit = job.model === 'wan2.7-videoedit';
  return {
    model: job.model,
    input: {
      prompt: job.prompt,
      ...(job.negativePrompt ? { negative_prompt: job.negativePrompt } : {}),
      ...(media.length ? { media } : {})
    },
    parameters: {
      resolution: job.parameters.resolution,
      ...(isVideoEdit
        ? { audio_setting: 'origin' }
        : { ratio: job.parameters.ratio, duration: job.parameters.duration }),
      prompt_extend: job.parameters.promptExtend,
      watermark: job.parameters.watermark,
      ...(job.parameters.seed != null ? { seed: job.parameters.seed } : {})
    }
  };
}

/** Submit one WanJob and poll to completion. Never throws — failures come back as a FAILED/TIMEOUT result. */
export async function generateClip(
  cfg: WanClientConfig,
  job: WanJob,
  deps: WanClientDeps = {}
): Promise<WanGenerateResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const readFileImpl = deps.readFileImpl ?? ((filePath: string) => readFile(filePath));
  const uploadImpl =
    deps.uploadImpl ?? ((model: string, localPath: string) => uploadFileForModel(cfg.baseUrl, cfg.apiKey, model, localPath, { fetchImpl }));

  let media: Array<{ type: string; url: string }>;
  try {
    media = await resolveMedia(job, { readFileImpl, uploadImpl });
  } catch (error) {
    return { beatId: job.beatId, taskId: null, status: 'FAILED', error: `media: ${errMsg(error)}` };
  }
  // oss:// media (uploaded videos) need the server to resolve the temp object.
  const ossResolve: Record<string, string> = media.some((m) => m.url.startsWith('oss://'))
    ? { 'X-DashScope-OssResourceResolve': 'enable' }
    : {};

  let taskId: string | null = null;
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/services/aigc/video-generation/video-synthesis`, {
      method: 'POST',
      headers: authHeaders(cfg, { 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable', ...ossResolve }),
      body: JSON.stringify(buildRequestBody(job, media))
    });
    const json = (await res.json()) as { output?: { task_id?: string }; code?: string; message?: string };
    taskId = json.output?.task_id ?? null;
    if (!taskId) {
      return { beatId: job.beatId, taskId: null, status: 'FAILED', error: `create: ${json.code ?? res.status} ${json.message ?? ''}`.trim() };
    }
  } catch (error) {
    return { beatId: job.beatId, taskId: null, status: 'FAILED', error: `create: ${errMsg(error)}` };
  }

  const interval = cfg.pollIntervalMs ?? 15_000;
  const deadline = Date.now() + (cfg.maxWaitMs ?? 8 * 60_000);
  while (Date.now() < deadline) {
    await sleep(interval);
    try {
      const res = await fetchImpl(`${cfg.baseUrl}/tasks/${taskId}`, { headers: authHeaders(cfg) });
      const out = ((await res.json()) as { output?: Record<string, unknown> }).output ?? {};
      const status = String(out.task_status ?? '');
      if (status === 'SUCCEEDED') {
        return { beatId: job.beatId, taskId, status: 'SUCCEEDED', videoUrl: out.video_url as string | undefined };
      }
      if (TERMINAL_FAIL.has(status)) {
        return { beatId: job.beatId, taskId, status: 'FAILED', error: `${out.code ?? ''} ${out.message ?? status}`.trim() };
      }
    } catch {
      // transient poll error → keep polling until the deadline
    }
  }
  return { beatId: job.beatId, taskId, status: 'TIMEOUT' };
}

/** Download a result video_url (24h expiry) to a local path. */
export async function downloadVideo(
  url: string,
  destPath: string,
  deps: Pick<WanClientDeps, 'fetchImpl'> = {}
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, buf);
  return destPath;
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
