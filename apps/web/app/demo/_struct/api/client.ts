// client.ts — thin fetch layer for the StructMigrate demo (Screens 01–04).
//
// These calls target the dedicated `/api/struct/*` endpoints documented in
// docs/API_CONTRACT.md (§10). Every helper THROWS on any failure (network
// error, non-2xx) so the store can catch it and fall back to local mock data —
// this keeps the demo fully renderable even before the backend ships the routes.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';

export function structApiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export async function structGet<T>(path: string): Promise<T> {
  const res = await fetch(structApiUrl(path));
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function structPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(structApiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function structPostForm<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(structApiUrl(path), { method: 'POST', body });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}
