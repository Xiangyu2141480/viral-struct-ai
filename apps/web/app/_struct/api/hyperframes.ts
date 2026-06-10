// hyperframes.ts — HyperFrames Agent: render ONE slot (or transition) for preview.
//
// The user picks 「HyperFrames 补全」 in the gap-fill studio; the Director sends that
// slot's brief to the (narrowed) HyperFrames Agent, which edits JUST that beat in the
// background and returns a real preview MP4. Async job — poll getHyperframesStatus.

import { structGet, structPost } from './client';
import type { Material, SourceVideo, TargetProduct } from '../data';

export interface HyperframesSlotRequest {
  sourceVideo: SourceVideo;
  materials: Material[];
  product: TargetProduct;
  slotId: string;
  productImageUrl?: string;
}

export interface HyperframesStartResponse {
  jobId: string;
}

export interface HyperframesStatus {
  status: 'running' | 'done' | 'error';
  stage?: string;
  targetId?: string;
  /** Absolute URL of the rendered beat MP4 (present when status==='done'). */
  previewUrl?: string;
  source?: 'llm' | 'mock';
  warnings?: string[];
  error?: string;
  elapsedSec?: number;
}

export interface HyperframesTransitionRequest {
  sourceVideo: SourceVideo;
  materials: Material[];
  transitionIndex: number;
}

/** Start a HyperFrames render for ONE slot. Returns a jobId to poll. */
export function startHyperframesSlot(body: HyperframesSlotRequest): Promise<HyperframesStartResponse> {
  return structPost<HyperframesStartResponse>('/api/struct/hyperframes/slot', body);
}

/** Composite ONE transition seam (ffmpeg xfade over the adjacent slots' real assets). */
export function startHyperframesTransition(body: HyperframesTransitionRequest): Promise<HyperframesStartResponse> {
  return structPost<HyperframesStartResponse>('/api/struct/hyperframes/transition', body);
}

export function getHyperframesStatus(jobId: string): Promise<HyperframesStatus> {
  return structGet<HyperframesStatus>(`/api/struct/hyperframes/${jobId}`);
}
