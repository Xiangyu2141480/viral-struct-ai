// sample.ts — Screen 01 (样例解析) API calls.

import { structPostForm, structPost } from './client';
import type { AnalyzeSampleResponse } from './types';

/**
 * Analyze a source viral video into a transferable StructureIR (SourceVideo).
 * Pass a `file` to upload-and-analyze, or a `sampleId` to analyze a seed video.
 */
export function analyzeSample(input: { file?: File; sampleId?: string }): Promise<AnalyzeSampleResponse> {
  if (input.file) {
    const form = new FormData();
    form.append('video', input.file);
    return structPostForm<AnalyzeSampleResponse>('/api/struct/sample/analyze', form);
  }
  return structPost<AnalyzeSampleResponse>('/api/struct/sample/analyze', { sampleId: input.sampleId });
}
