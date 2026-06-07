import type { VideoEditContext } from '../context/VideoEditContext';
import type { GapFillPlan, GapFillVerifierCheck } from './GapFillPlan';
import { summarizeTimelineStructure } from '../verifier/structureFidelity';

export type GapFillCheckStatus = 'pass' | 'fail' | 'pending';

export interface GapFillVerificationIssue {
  planId: string;
  checkId: string;
  message: string;
}

export interface GapFillBatchVerificationResult {
  ok: boolean;
  /** ok AND nothing pending — every measurable AND render-time check has actually passed. */
  fullyVerified: boolean;
  localChecks: GapFillVerifierCheck[];
  globalChecks: GapFillVerifierCheck[];
  issues: GapFillVerificationIssue[];
  /** Checks that are honestly not yet measurable (await the render executor / a planned timeline). */
  pendingCount: number;
}

export function verifyGapFillBatch(
  context: VideoEditContext,
  plans: GapFillPlan[]
): GapFillBatchVerificationResult {
  const slotIds = new Set(context.structureGraph.shotSlots.map((slot) => slot.id));
  const assetIds = new Set(context.assetCards.map((asset) => asset.id));
  const issues: GapFillVerificationIssue[] = [];
  const localChecks: GapFillVerifierCheck[] = [];
  const globalChecks: GapFillVerifierCheck[] = [];

  for (const plan of plans) {
    for (const check of plan.verifierChecks) {
      const status = evaluateCheck(check, plan, context);
      const evaluated: GapFillVerifierCheck = { ...check, status };
      if (check.level === 'global') globalChecks.push(evaluated);
      else localChecks.push(evaluated);

      // Reference-existence and real-proof routing are owned by the dedicated rules below (single source,
      // no double-reporting). Everything else that genuinely FAILED becomes an issue. 'pending' never does.
      if (
        status === 'fail'
        && check.type !== 'slot_reference'
        && check.type !== 'asset_reference'
        && check.type !== 'no_unapproved_human_generation'
      ) {
        issues.push({ planId: plan.id, checkId: check.type, message: failureMessageForCheck(check, plan) });
      }
    }

    if (!slotIds.has(plan.slotId)) {
      issues.push({
        planId: plan.id,
        checkId: 'slot_reference',
        message: `Gap fill plan references unknown slotId "${plan.slotId}".`
      });
    }

    for (const assetId of referencedAssetIds(plan)) {
      if (!assetIds.has(assetId)) {
        issues.push({
          planId: plan.id,
          checkId: 'asset_reference',
          message: `Gap fill plan references unknown assetId "${assetId}".`
        });
      }
    }

    if (plan.method === 'aigc_fill' && !context.constraints.allowAigc) {
      issues.push({
        planId: plan.id,
        checkId: 'aigc_policy',
        message: 'AIGC asset generation is disabled by edit constraints.'
      });
    }

    // The verifier is the INDEPENDENT judge: recompute whether this gap needs real proof from the
    // structure graph + gap type, and never trust a (possibly downgraded) declared flag on its own.
    const independentRealProof = recomputeRequiresRealProof(plan, context);
    const requiresRealProof = plan.safetyGate.requiresRealProof || independentRealProof;

    if (independentRealProof && !plan.safetyGate.requiresRealProof) {
      issues.push({
        planId: plan.id,
        checkId: 'no_unapproved_human_generation',
        message: 'Plan under-declares real-proof need: the slot/gap inherently requires real-world evidence but safetyGate.requiresRealProof is false. The verifier (independent judge) re-asserts it.'
      });
    }

    // Honesty + Safety invariant: a real-proof gap must be routed to the user OR honestly degraded
    // (resolutionStatus 'unresolved' + qualityImpact). It must never be silently substituted as if the evidence existed.
    if (requiresRealProof && plan.method !== 'ask_user_for_asset' && !isHonestlyDegraded(plan)) {
      issues.push({
        planId: plan.id,
        checkId: 'no_unapproved_human_generation',
        message: 'Real-proof gap must be routed to a user asset request, or honestly degraded (resolutionStatus="unresolved" + qualityImpact). It must never be presented as if the real evidence existed.'
      });
    }

    // Honesty invariant on the COPY: a degraded substitute must say so and must not imply the real evidence exists.
    if (isHonestlyDegraded(plan)) {
      const subline = plan.editingSpec?.copy.subline ?? '';
      const hasHonestyMarker = /unavailable|not recreated|attributed|substitute/i.test(subline);
      const impliesProof = /\breal (customer|demo|footage|proof|testimonial)\b/i.test(subline);
      if (!hasHonestyMarker || impliesProof) {
        issues.push({
          planId: plan.id,
          checkId: 'honest_substitute_copy',
          message: 'A degraded substitute must carry honest copy (unavailable / not recreated / an attributed substitute) and must not imply the missing real evidence exists.'
        });
      }
    }

    if (plan.method === 'aigc_fill' && plan.aigcRequest?.forbiddenElements.includes('on-screen claims') !== true) {
      issues.push({
        planId: plan.id,
        checkId: 'claim_supported',
        message: 'AIGC fills must forbid on-screen claims in generated pixels.'
      });
    }

    if (plan.method === 'aigc_fill' && (plan.aigcRequest?.maxRegenerations ?? 0) > 2) {
      issues.push({
        planId: plan.id,
        checkId: 'aigc_retry_cap',
        message: 'AIGC fills must cap regenerations before falling back to a non-generative path.'
      });
    }
  }

  const pendingCount = [...localChecks, ...globalChecks].filter((check) => check.status === 'pending').length;

  return {
    ok: issues.length === 0,
    fullyVerified: issues.length === 0 && pendingCount === 0,
    localChecks,
    globalChecks,
    issues,
    pendingCount
  };
}

export const verifyGapFillPlans = verifyGapFillBatch;

function isHonestlyDegraded(plan: GapFillPlan): boolean {
  return plan.method === 'deterministic_editing_fill'
    && plan.resolutionStatus === 'unresolved'
    && Boolean(plan.qualityImpact);
}

// Gap types that inherently require real-world evidence. Recomputed here (independently of the planner's
// declared flag) so the verifier can act as a true independent judge per the operating contract.
const REAL_PROOF_GAP_TYPES = new Set<string>([
  'missing_human_host',
  'missing_usage_action',
  'missing_usage_demo',
  'missing_face_closeup',
  'missing_beauty_demo',
  'missing_before_after',
  'missing_trust_element',
  'missing_product_closeup'
]);

function recomputeRequiresRealProof(plan: GapFillPlan, context: VideoEditContext): boolean {
  const gap = context.materialGaps.find((candidate) => candidate.slotId === plan.slotId);
  if (gap?.type && REAL_PROOF_GAP_TYPES.has(gap.type)) return true;
  const slot = context.structureGraph.shotSlots.find((candidate) => candidate.id === plan.slotId);
  return Boolean(slot?.humanRequirement?.required);
}

function referencedAssetIds(plan: GapFillPlan): string[] {
  return [
    ...(plan.reuseSpec ? [plan.reuseSpec.assetId] : []),
    ...(plan.editingSpec?.referencedAssets ?? []),
    ...(plan.aigcRequest?.referenceAssetIds ?? [])
  ];
}

function evaluateCheck(
  check: GapFillVerifierCheck,
  plan: GapFillPlan,
  context: VideoEditContext
): GapFillCheckStatus {
  switch (check.type) {
    case 'slot_reference':
      return context.structureGraph.shotSlots.some((slot) => slot.id === plan.slotId) ? 'pass' : 'fail';
    case 'asset_reference': {
      const assetIds = new Set(context.assetCards.map((asset) => asset.id));
      return referencedAssetIds(plan).every((assetId) => assetIds.has(assetId)) ? 'pass' : 'fail';
    }
    case 'duration':
      return hasPositiveFillDuration(plan) ? 'pass' : 'fail';
    case 'no_unapproved_human_generation': {
      const requiresRealProof = plan.safetyGate.requiresRealProof || recomputeRequiresRealProof(plan, context);
      return (!requiresRealProof || plan.method === 'ask_user_for_asset' || isHonestlyDegraded(plan)) ? 'pass' : 'fail';
    }
    case 'structure_fidelity':
      if (!context.timeline?.length) return 'pending';
      return hasTimelineStructureEvidence(plan, context) ? 'pass' : 'fail';
    case 'emotional_function':
      if (!context.timeline?.length) return 'pending';
      return hasTimelineStructureEvidence(plan, context) && hasRepairArtifact(plan) ? 'pass' : 'fail';
    case 'claim_supported':
    case 'product_identity':
    case 'safe_area':
    case 'style_match':
      // Render-dependent: not measurable until the executor produces pixels. Honest 'pending', never a fake pass.
      return 'pending';
    default:
      return 'pending';
  }
}

function hasPositiveFillDuration(plan: GapFillPlan): boolean {
  const duration = plan.reuseSpec?.durationMs
    ?? plan.editingSpec?.durationMs
    ?? plan.aigcRequest?.durationMs
    ?? plan.userAssetRequest?.durationMs[0]
    ?? 0;

  return duration > 0;
}

function hasTimelineStructureEvidence(plan: GapFillPlan, context: VideoEditContext): boolean {
  if (!context.timeline?.length) return false;

  const summary = summarizeTimelineStructure(context.timeline);
  const timelineItem = context.timeline.find((item) => item.slotId === plan.slotId);
  if (!timelineItem || summary.itemCount === 0 || summary.totalDurationMs <= 0) return false;
  if (plan.inheritedContext.segmentRole && timelineItem.segmentRole !== plan.inheritedContext.segmentRole) return false;

  const itemDurationMs = Math.max(0, timelineItem.end - timelineItem.start) * 1000;
  const expectedDurationMs = plan.reuseSpec?.durationMs
    ?? plan.editingSpec?.durationMs
    ?? plan.aigcRequest?.durationMs
    ?? plan.userAssetRequest?.durationMs[0]
    ?? itemDurationMs;

  return Math.abs(itemDurationMs - expectedDurationMs) <= 500;
}

function hasRepairArtifact(plan: GapFillPlan): boolean {
  return Boolean(
    plan.reuseSpec || plan.editingSpec || plan.aigcRequest || plan.userAssetRequest || plan.scriptRepairSpec
  );
}

function failureMessageForCheck(check: GapFillVerifierCheck, plan: GapFillPlan): string {
  if (check.type === 'structure_fidelity') {
    return `Structure fidelity check failed for plan "${plan.id}": the planned timeline item for slot "${plan.slotId}" does not preserve the inherited role/duration within tolerance.`;
  }
  if (check.type === 'emotional_function') {
    return `Emotional-function preservation could not be confirmed for plan "${plan.id}".`;
  }
  return `Verifier check "${check.type}" failed for gap fill plan "${plan.id}".`;
}
