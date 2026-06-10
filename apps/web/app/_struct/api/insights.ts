// insights.ts — Screen-04 "evaluation & generation" API calls + one-click demo.
//
// These surface the remaining backend capabilities (quality self-check, offline
// performance estimate, brand-safety guardrail, storyboard planning, AIGC
// generation specs, prebuilt library loading, full demo run) to UI buttons,
// via the /api/struct/* adapter. Every helper THROWS on failure so the store
// can surface a warning without breaking the flow.

import { structGet, structPost } from './client';
import type { CompileVersion, Diagnosis, Material, SourceVideo, TargetProduct } from '../data';
import type { TimelineSeg } from './types';
import type {
  DemoEstimate,
  MissingMaterialGenerationJob,
  QualityReport,
  SafetyStatus,
  StoryboardFrame,
} from '@viral-struct/shared';

/** Shared request body for the evaluation/generation capability routes. */
export interface InsightRequest {
  sourceVideo: SourceVideo;
  materials: Material[];
  product: TargetProduct;
  timeline?: TimelineSeg[];
  versionId?: string;
}

export function evaluateQuality(body: InsightRequest): Promise<{ qualityReport: QualityReport; warnings?: string[] }> {
  return structPost('/api/struct/quality', body);
}

export function estimatePerformance(body: InsightRequest): Promise<{ demoEstimate: DemoEstimate; warnings?: string[] }> {
  return structPost('/api/struct/estimate', body);
}

export function checkSafety(body: InsightRequest): Promise<{ safetyStatus: SafetyStatus; disclaimer: string }> {
  return structPost('/api/struct/safety', body);
}

export function planStoryboard(body: InsightRequest): Promise<{ frames: StoryboardFrame[]; warnings?: string[] }> {
  return structPost('/api/struct/storyboard', body);
}

export function planMaterialJobs(body: InsightRequest): Promise<{ jobs: MissingMaterialGenerationJob[]; warnings?: string[] }> {
  return structPost('/api/struct/material-jobs', body);
}

export function loadLibraryMaterials(libraryId: string): Promise<{ materials: Material[]; warnings?: string[] }> {
  return structGet(`/api/struct/materials/library/${encodeURIComponent(libraryId)}`);
}

/** Full one-click demo bundle: real data for all four screens. */
export interface DemoBundle {
  sourceVideo: SourceVideo;
  product: TargetProduct;
  materials: Material[];
  diagnosis: Record<string, Diagnosis>;
  version: CompileVersion;
  timeline: TimelineSeg[];
  showcaseTitle?: string;
  warnings?: string[];
}

export function runDemo(): Promise<DemoBundle> {
  return structGet('/api/struct/demo');
}
