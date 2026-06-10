// materials.ts — Screen 02 (素材输入) API calls.

import { structPostForm, structPost } from './client';
import type {
  MatchMaterialsRequest,
  MatchMaterialsResponse,
  UploadMaterialsResponse,
} from './types';
import type { TargetProduct } from '../data';
import type { ContentBrief } from '@viral-struct/shared';

/** Upload product materials; backend auto-classifies + recommends slots. */
export function uploadMaterials(
  files: File[],
  product: TargetProduct,
  context?: { rawProductDescription?: string; contentBrief?: ContentBrief | null }
): Promise<UploadMaterialsResponse> {
  const form = new FormData();
  files.forEach((f) => form.append('assets', f));
  form.append('product', JSON.stringify(product));
  if (context?.rawProductDescription) form.append('rawProductDescription', context.rawProductDescription);
  if (context?.contentBrief) form.append('contentBrief', JSON.stringify(context.contentBrief));
  return structPostForm<UploadMaterialsResponse>('/api/struct/materials/upload', form);
}

/** Persist manual slot assignments (or trigger auto-match when omitted). */
export function matchMaterials(body: MatchMaterialsRequest): Promise<MatchMaterialsResponse> {
  return structPost<MatchMaterialsResponse>('/api/struct/materials/match', body);
}
