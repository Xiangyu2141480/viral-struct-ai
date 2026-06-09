// client.ts — thin fetch layer for the StructMigrate demo (Screens 01–04).
//
// These calls target the dedicated `/api/struct/*` endpoints documented in
// docs/API_CONTRACT.md (§10). Every helper THROWS a rich StructApiError on any
// failure (network/backend-down, non-2xx) carrying the method, path, status and
// response body — so the store can FAIL FAST and surface exactly what broke,
// instead of silently swapping in mock data.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';

export function structApiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/**
 * Error carrying structured detail about a failed `/api/struct/*` call.
 * `status === null` means the request never reached the backend (network error,
 * CORS, or the API isn't running) — the most common "I don't know what's wrong"
 * case, so we say so explicitly.
 */
export class StructApiError extends Error {
  readonly method: string;
  readonly path: string;
  readonly status: number | null;
  readonly detail: string;

  constructor(method: string, path: string, status: number | null, detail: string) {
    const where = `${method} ${path}`;
    const what = status === null
      ? `后端无法连接（${detail || '网络错误'}）· 确认 API 是否运行在 ${API_BASE}`
      : `HTTP ${status}${detail ? ` · ${detail}` : ''}`;
    super(`${where} → ${what}`);
    this.name = 'StructApiError';
    this.method = method;
    this.path = path;
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(method: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(structApiUrl(path), init);
  } catch (e) {
    // fetch itself rejected: backend down / network / CORS — never reached the server.
    throw new StructApiError(method, path, null, e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) {
    let body = '';
    try {
      body = (await res.text()).trim().slice(0, 400);
    } catch {
      /* ignore body read failure */
    }
    throw new StructApiError(method, path, res.status, body || res.statusText);
  }
  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new StructApiError(method, path, res.status, `响应不是合法 JSON（${e instanceof Error ? e.message : String(e)}）`);
  }
}

export function structGet<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

export function structPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>('POST', path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function structPostForm<T>(path: string, body: FormData): Promise<T> {
  return request<T>('POST', path, { method: 'POST', body });
}
