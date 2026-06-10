// scan.ts — Screen 01: REAL rough scan as an async job.
// Upload a video → POST /scan returns a jobId → poll GET /scan/:jobId until the
// VLM rough scan finishes and returns the real structure (sourceVideo).

import { structGet, structPost, structPostForm } from './client';
import type { AnalyzeSampleResponse } from './types';

export interface ScanStartResponse {
  jobId: string;
}

/* ── Fine scan (deep per-segment detail) ───────────────────────────── */

export interface FineTextElement { type?: string; content?: string; positionGrid?: number; animationIn?: string; relativePositionBucket?: string }
export interface FineActionBeat { beatId?: string; semanticAction?: string; actionType?: string; beforeState?: string; afterState?: string }
export interface FineMotif { motifType?: string; description?: string; transferability?: string }
export interface FineAsset { assetType?: string; purpose?: string; criticality?: string }

export interface FineBlockDetail {
  blockId?: string;
  roleConfirmation?: { role?: string; confidence?: number; coarseRoleWas?: string; correctionFromCoarse?: boolean };
  dominantTone?: string;
  textOverlayBehavior?: { textElements?: FineTextElement[] };
  productPresentation?: { revealMode?: string; salesPointOrdering?: string };
  transitionOut?: { type?: string; incomingHintForNextBlock?: string };
  requiredAssetType?: FineAsset[];
  transferableMotifs?: FineMotif[];
  actionBeats?: FineActionBeat[];
  peakDetectionStats?: { candidatePeakCount?: number; selectedPeakCount?: number; regimeBoundaryCount?: number; hardCutCount?: number };
  sourceTimeRangeMs?: { start?: number; end?: number };
}

export interface FineScanStatus {
  status: 'running' | 'done' | 'error';
  stage?: string;
  segmentIndex?: number;
  detail?: FineBlockDetail;
  error?: string;
  elapsedSec?: number;
}

export function startFineScan(videoId: string, segmentIndex: number): Promise<ScanStartResponse> {
  return structPost<ScanStartResponse>(`/api/struct/scan/${encodeURIComponent(videoId)}/fine`, { segmentIndex });
}

export function getFineScanStatus(jobId: string): Promise<FineScanStatus> {
  return structGet<FineScanStatus>(`/api/struct/scan/fine/${jobId}`);
}

export interface ScanStatus {
  status: 'running' | 'done' | 'error';
  stage?: string;
  sourceVideo?: AnalyzeSampleResponse['sourceVideo'];
  warnings?: string[];
  error?: string;
  elapsedSec?: number;
}

/**
 * Start a rough scan by uploading the video (multipart). Wrapped in a small
 * bounded retry (3 attempts, 1s/2s/4s backoff) so a flaky upload connection
 * retries before failing. Same signature — callers see no new surface; it just
 * becomes resilient. After attempts are exhausted it re-throws (fail-fast).
 */
export async function startScan(file: File): Promise<ScanStartResponse> {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      // 1s, 2s, 4s backoff before each retry.
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
    }
    try {
      // Rebuild the FormData each attempt so the body is fresh on retry.
      const form = new FormData();
      form.append('video', file);
      return await structPostForm<ScanStartResponse>('/api/struct/scan', form);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export function getScanStatus(jobId: string): Promise<ScanStatus> {
  return structGet<ScanStatus>(`/api/struct/scan/${jobId}`);
}
