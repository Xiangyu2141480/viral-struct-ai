// scan.ts — Screen 01: REAL rough scan as an async job.
// Upload a video → POST /scan returns a jobId → poll GET /scan/:jobId until the
// VLM rough scan finishes and returns the real structure (sourceVideo).

import { structGet, structPostForm } from './client';
import type { AnalyzeSampleResponse } from './types';

export interface ScanStartResponse {
  jobId: string;
}

export interface ScanStatus {
  status: 'running' | 'done' | 'error';
  stage?: string;
  sourceVideo?: AnalyzeSampleResponse['sourceVideo'];
  warnings?: string[];
  error?: string;
  elapsedSec?: number;
}

export function startScan(file: File): Promise<ScanStartResponse> {
  const form = new FormData();
  form.append('video', file);
  return structPostForm<ScanStartResponse>('/api/struct/scan', form);
}

export function getScanStatus(jobId: string): Promise<ScanStatus> {
  return structGet<ScanStatus>(`/api/struct/scan/${jobId}`);
}
