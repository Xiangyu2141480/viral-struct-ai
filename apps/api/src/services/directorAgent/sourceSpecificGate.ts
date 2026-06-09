import type { ShotSlotNode, ViralMotifAnnotation, ViralStructureGraph } from '@viral-struct/shared';

/**
 * §5.4 source-specific gate (decision 3: assemble from existing signals).
 *
 * Purpose: a slot whose KEY ELEMENT is genuinely source-product-specific (e.g. "open/unfold the laptop",
 * "screen interaction") must NOT be judged `matched` — a beverage cannot perform it, so the Director
 * must fall back to a target-native alternative (partial/gap).
 *
 * Calibration note (important): the discriminating signal is `IngredientTransferability` — whether the
 * slot's required creative ingredient is intrinsically transferable. We deliberately do NOT gate on a
 * blanket source-term blacklist scan of the slot text: for any single-product source video EVERY slot
 * mentions the source product, so a blacklist scan fires on every slot and makes `matched` unreachable.
 * Distinguishing a transferable usage action from a source-specific interaction is a semantic judgement —
 * that is exactly the job of the LLM matcher (`matchSlotsLLM`, "只看 intent，不被 sourceInstance 带跑"),
 * not of a keyword scan. This gate only adds the authoritative not-transferable override on top of it.
 *
 * (Output leakage protection — sanitizing prompts / evidence so source terms never reach a downstream
 * prompt — is handled separately in the timeline builder; it is independent of this matching gate.)
 */
export interface SourceSpecificGateResult {
  blocked: boolean;
  reasons: string[];
}

export function evaluateSourceSpecificGate(args: {
  slot: ShotSlotNode;
  structureGraph: ViralStructureGraph;
  motif?: ViralMotifAnnotation;
}): SourceSpecificGateResult {
  const reasons: string[] = [];

  // A creative ingredient this slot requires is intrinsically not transferable to a new category.
  const requiredIngredients = args.structureGraph.creativeIngredients.filter((ingredient) =>
    ingredient.requiredForSlotIds.includes(args.slot.id)
  );
  for (const ingredient of requiredIngredients) {
    if (ingredient.transferability === 'not_transferable') {
      // Use the ingredient TYPE (a safe enum), never its free-text name (which can carry source terms).
      reasons.push(`required ${ingredient.type} element is not transferable to the target category`);
    }
  }

  return { blocked: reasons.length > 0, reasons: dedupe(reasons) };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
