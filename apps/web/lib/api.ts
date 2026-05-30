import type { DemoEstimate, MissingMaterialGenerationJob, StoryboardFrame } from '@viral-struct/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';

export interface StoryboardPlanResponse {
  frames: StoryboardFrame[];
  source: 'storyboard_prompt_planner';
  warnings: string[];
}

export interface MissingMaterialGenerationPlanResponse {
  jobs: MissingMaterialGenerationJob[];
  source: 'missing_material_generation_planner';
  warnings: string[];
}

export interface DemoEstimateResponse {
  demoEstimate: DemoEstimate;
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function mediaUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  return path.startsWith('/media') ? `${API_BASE}${path}` : path;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path));

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export async function apiPostForm<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    body
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export function planStoryboardFrames(body: unknown): Promise<StoryboardPlanResponse> {
  return apiPost<StoryboardPlanResponse>('/api/storyboard/plan', body);
}

export function planMissingMaterialGeneration(body: unknown): Promise<MissingMaterialGenerationPlanResponse> {
  return apiPost<MissingMaterialGenerationPlanResponse>('/api/material-generation/plan', body);
}

export function estimateDemoAnalytics(body: unknown): Promise<DemoEstimateResponse> {
  return apiPost<DemoEstimateResponse>('/api/analytics/demo-estimate', body);
}
