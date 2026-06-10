import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * DashScope temporary file upload — turns a LOCAL file into an `oss://dashscope-instant/...` URL that the
 * Wan2.7 video API accepts as `media.url` (videoedit source video / r2v reference video cannot be base64).
 *
 * Flow (https://help.aliyun.com/zh/model-studio/get-temporary-file-url):
 *   1. GET  {baseUrl}/uploads?action=getPolicy&model={model}     → an OSS POST policy
 *   2. POST {upload_host}  (multipart/form-data, file LAST)       → stores the object
 *   3. URL = `oss://{key}`  ; pass header `X-DashScope-OssResourceResolve: enable` when calling the model.
 *
 * The uploaded object lives ~48h — long enough for one generation run.
 */

export interface UploadPolicy {
  policy: string;
  signature: string;
  upload_dir: string;
  upload_host: string;
  oss_access_key_id: string;
  x_oss_object_acl: string;
  x_oss_forbid_overwrite: string;
}

export interface DashScopeUploadDeps {
  fetchImpl?: typeof fetch;
  readFileImpl?: (filePath: string) => Promise<Buffer>;
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

async function getUploadPolicy(
  baseUrl: string,
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch
): Promise<UploadPolicy> {
  const url = `${baseUrl}/uploads?action=getPolicy&model=${encodeURIComponent(model)}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
  const json = (await res.json()) as { data?: UploadPolicy; code?: string; message?: string };
  if (!json.data?.upload_host) {
    throw new Error(`getPolicy failed: ${json.code ?? res.status} ${json.message ?? ''}`.trim());
  }
  return json.data;
}

async function attemptUpload(
  baseUrl: string,
  apiKey: string,
  model: string,
  filename: string,
  buf: Buffer,
  contentType: string,
  fetchImpl: typeof fetch
): Promise<string> {
  const policy = await getUploadPolicy(baseUrl, apiKey, model, fetchImpl);
  const key = `${policy.upload_dir}/${filename}`;

  // OSS POST policy form — order matters: every policy field first, `file` LAST.
  const form = new FormData();
  form.append('OSSAccessKeyId', policy.oss_access_key_id);
  form.append('Signature', policy.signature);
  form.append('policy', policy.policy);
  form.append('x-oss-object-acl', policy.x_oss_object_acl);
  form.append('x-oss-forbid-overwrite', policy.x_oss_forbid_overwrite);
  form.append('key', key);
  form.append('success_action_status', '200');
  form.append('file', new Blob([new Uint8Array(buf)], { type: contentType }), filename);

  const res = await fetchImpl(policy.upload_host, { method: 'POST', body: form });
  if (res.status !== 200 && res.status !== 204) {
    const text = await res.text().catch(() => '');
    throw new Error(`OSS upload failed: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return `oss://${key}`;
}

/**
 * Upload a local file and return its `oss://...` URL. Retries the upload a few times — the OSS upload host is
 * a cn-beijing endpoint that intermittently fails (`fetch failed`) from far regions. Throws after the last
 * attempt (callers decide fallback).
 */
export async function uploadFileForModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  localPath: string,
  deps: DashScopeUploadDeps & { attempts?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<string> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const readFileImpl = deps.readFileImpl ?? ((p: string) => readFile(p));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = deps.attempts ?? 3;

  const buf = await readFileImpl(localPath);
  const filename = path.basename(localPath);
  const contentType = MIME[path.extname(localPath).toLowerCase()] ?? 'application/octet-stream';

  let lastErr: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await attemptUpload(baseUrl, apiKey, model, filename, buf, contentType, fetchImpl);
    } catch (error) {
      lastErr = error;
      if (i < attempts - 1) await sleep(2000 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
