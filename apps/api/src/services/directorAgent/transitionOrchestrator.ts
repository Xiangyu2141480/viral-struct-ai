import type {
  AssetCard,
  ContentBrief,
  OrchestratedSlot,
  OrchestratedTransition
} from '@viral-struct/shared';
import { planTransition } from './transitionPlanner';

export interface BuildOrchestratedTransitionsArgs {
  slots: OrchestratedSlot[];
  assetCards: AssetCard[];
  contentBrief: ContentBrief;
  /** Kept for backwards compatibility; the evidence-aware planner no longer uses a global HyperFrames quota. */
  hyperframesWeight?: number;
  projectId?: string;
  sourceVideoId?: string;
  targetCategory?: string;
}

export function buildOrchestratedTransitions(args: BuildOrchestratedTransitionsArgs): OrchestratedTransition[] {
  const slots = [...args.slots].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (slots.length < 2) {
    return [];
  }

  return slots.slice(0, -1).map((from, index) => {
    const to = slots[index + 1];
    return planTransition({
      projectId: args.projectId ?? 'director_agent',
      sourceVideoId: args.sourceVideoId,
      targetCategory: args.targetCategory ?? args.contentBrief.category ?? 'generic',
      targetBrief: args.contentBrief,
      fromSlot: from,
      toSlot: to,
      fromFillStatus: from.fillStatus,
      toFillStatus: to.fillStatus,
      fromAssetIds: assetIdsFromSlot(from),
      toAssetIds: assetIdsFromSlot(to),
      assetCards: args.assetCards,
      missingIngredients: unique([
        ...(from.fill.evidence.missingIngredients ?? []),
        ...(to.fill.evidence.missingIngredients ?? [])
      ])
    });
  });
}

function assetIdsFromSlot(slot: OrchestratedSlot): string[] {
  return slot.fill.kind === 'matched' ? [slot.fill.assetId] : [];
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}
