// diagnose.ts — Screen 03 (缺口诊断) API calls.

import { structPost } from './client';
import type {
  ApplyStrategyRequest,
  ApplyStrategyResponse,
  DiagnoseRequest,
  DiagnoseResponse,
} from './types';

/** Diagnose every slot into a four-state match (filled/weakly/missing/critical). */
export function diagnose(body: DiagnoseRequest): Promise<DiagnoseResponse> {
  return structPost<DiagnoseResponse>('/api/struct/diagnose', body);
}

/** Apply the recommended repair strategy for a single slot. */
export function applyStrategy(body: ApplyStrategyRequest): Promise<ApplyStrategyResponse> {
  return structPost<ApplyStrategyResponse>('/api/struct/strategy/apply', body);
}
