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

/**
 * Apply a repair strategy for a single slot. The request body carries the chosen
 * `method` ('reshoot' | 'hyperframes' | 'aigc') and optional `payload`; when
 * `method` is omitted the backend falls back to the slot's recommended/strategy.
 * The response echoes the `method` the backend actually applied.
 */
export function applyStrategy(body: ApplyStrategyRequest): Promise<ApplyStrategyResponse> {
  return structPost<ApplyStrategyResponse>('/api/struct/strategy/apply', body);
}
