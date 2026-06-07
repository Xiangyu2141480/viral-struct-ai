import type { AssetCard, MaterialGap, SlotMatch, ViralStructureGraph } from '@viral-struct/shared';
import type { VideoEditContext } from '../context/VideoEditContext';
import type { AssetGenerationRequest } from '../generation/AssetGenerationRequest';
import type { HyperFramesFillSpec } from '../generation/hyperframesFillSpec';
import {
  type GapEmotionalFunction,
  type GapEvidenceType,
  type GapFillPlan,
  type GapReport,
  type QualityImpact,
  type ReuseAssetSpec,
  type ScriptRepairSpec,
  type UserAssetRequest
} from './GapFillPlan';
import { chooseGapFillPolicy } from './gapFillPolicy';
import { GapFillPlanSchema, GapReportSchema } from './gapFillSchemas';

export function buildGapReports(context: VideoEditContext): GapReport[] {
  const slotIndex = new Map(context.structureGraph.shotSlots.map((slot) => [slot.id, slot]));
  const segmentIndex = new Map(context.structureGraph.segments.map((segment) => [segment.id, segment]));
  const matchIndex = new Map(context.slotMatches.map((match) => [match.slotId, match]));

  return context.materialGaps.map((gap, index) => {
    const slot = slotIndex.get(gap.slotId);
    const segment = slot ? segmentIndex.get(slot.segmentId) : undefined;
    const match = matchIndex.get(gap.slotId);
    const evidenceType = inferEvidenceType(gap, slot);
    const durationMs = inferDurationMs(gap, slot, context.structureGraph);

    const report: GapReport = {
      id: `${gap.slotId}_gap_report_${index + 1}`,
      slotId: gap.slotId,
      segmentId: gap.affectedSegmentId ?? slot?.segmentId ?? 'unknown_segment',
      segmentRole: segment?.role,
      slotRole: gap.role,
      visualType: slot?.requiredAsset.type ?? 'generated',
      durationMs,
      evidenceType,
      requiresRealProof: requiresRealProof(evidenceType, gap),
      emotionalFunction: inferEmotionalFunction(gap, segment?.role),
      whyUnmatched: gap.reason || match?.reason || 'The inherited slot could not be satisfied by the available assets.',
      missingIngredients: gap.missingIngredients ?? match?.missingIngredients ?? [],
      sourceIntent: slot?.intent,
      acceptanceCriteria: slot?.acceptanceCriteria
    };

    return GapReportSchema.parse(report) as GapReport;
  });
}

export function planGapFills(context: VideoEditContext): GapFillPlan[] {
  const slotIndex = new Map(context.structureGraph.shotSlots.map((slot) => [slot.id, slot]));
  const segmentIndex = new Map(context.structureGraph.segments.map((segment) => [segment.id, segment]));
  const matchIndex = new Map(context.slotMatches.map((match) => [match.slotId, match]));
  const assetIndex = new Map(context.assetCards.map((asset) => [asset.id, asset]));
  const reportIndex = new Map(buildGapReports(context).map((report) => [report.slotId, report]));

  return context.materialGaps.map((gap, index) => {
    const report = reportIndex.get(gap.slotId);
    if (!report) {
      throw new Error(`Gap report missing for slot ${gap.slotId}`);
    }

    const slot = slotIndex.get(gap.slotId);
    const segment = slot ? segmentIndex.get(slot.segmentId) : undefined;
    const match = matchIndex.get(gap.slotId);
    const matchedAsset = match?.assetId ? assetIndex.get(match.assetId) : undefined;
    const userUnprovidable = context.userUnprovidableSlotIds?.includes(gap.slotId) ?? false;
    const policy = chooseGapFillPolicy(report, gap, context.constraints, userUnprovidable);

    const basePlan: GapFillPlan = {
      id: `gap_fill_${index + 1}`,
      gapReportId: report.id,
      slotId: gap.slotId,
      segmentId: report.segmentId,
      inheritedContext: {
        slotRole: gap.role,
        segmentRole: segment?.role,
        sourceIntent: slot?.intent,
        acceptanceCriteria: slot?.acceptanceCriteria,
        missingIngredients: report.missingIngredients,
        matchStatus: normalizeMatchStatus(match),
        matchScore: match?.score
      },
      method: policy.method,
      reason: policy.reason,
      riskLevel: policy.riskLevel,
      resolutionStatus: 'planned',
      safetyGate: {
        requiresRealProof: report.requiresRealProof,
        aigcAllowed: policy.aigcAllowed,
        userAssetRequired: policy.userAssetRequired
      },
      verifierChecks: buildVerifierChecks(report, match, context.structureGraph)
    };

    if (policy.method === 'ask_user_for_asset') {
      return validatePlan({
        ...basePlan,
        userAssetRequest: buildUserAssetRequest(report, gap)
      });
    }

    if (policy.method === 'aigc_fill') {
      return validatePlan({
        ...basePlan,
        aigcRequest: buildAssetGenerationRequest(report, context, matchedAsset)
      });
    }

    const degraded = policy.degraded;
    return validatePlan({
      ...basePlan,
      resolutionStatus: degraded ? 'unresolved' : 'planned',
      qualityImpact: degraded ? buildQualityImpact(report) : undefined,
      reuseSpec: buildReuseSpec(report, matchedAsset),
      editingSpec: buildDeterministicEditingSpec(report, context, matchedAsset, degraded),
      scriptRepairSpec: buildScriptRepairSpec(report, context)
    });
  });
}

function validatePlan(plan: GapFillPlan): GapFillPlan {
  return GapFillPlanSchema.parse(plan) as GapFillPlan;
}

function normalizeMatchStatus(match: SlotMatch | undefined): 'partial' | 'missing' {
  return match?.status === 'partial' ? 'partial' : 'missing';
}

function inferDurationMs(
  gap: MaterialGap,
  slot: ViralStructureGraph['shotSlots'][number] | undefined,
  graph: ViralStructureGraph
): number {
  if (slot?.requiredAsset.minDuration) return Math.round(slot.requiredAsset.minDuration * 1000);
  const segment = graph.segments.find((s) => s.id === (gap.affectedSegmentId ?? slot?.segmentId));
  if (segment) return Math.round(Math.max(0.5, segment.end - segment.start) * 1000);
  return 2000;
}

function inferEvidenceType(
  gap: MaterialGap,
  slot: ViralStructureGraph['shotSlots'][number] | undefined
): GapEvidenceType {
  if (
    gap.type === 'missing_human_host'
    || gap.type === 'missing_usage_action'
    || gap.type === 'missing_usage_demo'
    || gap.type === 'missing_face_closeup'
    || gap.type === 'missing_beauty_demo'
  ) return 'usage_demo';
  if (gap.type === 'missing_before_after' || gap.type === 'missing_trust_element') return 'social_proof';
  if (slot?.humanRequirement?.required) return 'usage_demo';
  if (gap.type === 'missing_product_closeup') return 'product_identity';
  return 'none';
}

function requiresRealProof(evidenceType: GapEvidenceType, gap: MaterialGap): boolean {
  if (gap.type === 'missing_human_host' || gap.type === 'missing_usage_action') return true;
  return evidenceType === 'product_identity'
    || evidenceType === 'social_proof'
    || evidenceType === 'factual_claim'
    || evidenceType === 'usage_demo';
}

function inferEmotionalFunction(
  gap: MaterialGap,
  segmentRole: GapReport['segmentRole']
): GapEmotionalFunction {
  if (gap.type === 'missing_trust_element' || gap.type === 'missing_human_host') return 'trust';
  if (segmentRole === 'hook') return 'curiosity';
  if (segmentRole === 'cta') return 'urgency';
  if (segmentRole === 'proof' || segmentRole === 'comparison') return 'trust';
  return 'desire';
}

function buildUserAssetRequest(report: GapReport, gap: MaterialGap): UserAssetRequest {
  const durationSec = Math.max(1, Math.round(report.durationMs / 1000));
  return {
    reason: gap.reason,
    whyRequired: `This slot needs real evidence (${report.evidenceType}) to preserve the source structure without fabricating proof.`,
    idealShot: `Record ${durationSec}-${durationSec + 1}s of authorized real footage that satisfies ${report.slotRole}.`,
    minimalAcceptableShot: `Provide at least one clear ${report.visualType === 'video' ? 'short clip' : 'image'} showing the missing proof for this slot.`,
    shootingTips: [
      'Keep the product visible and well lit.',
      'Avoid unreadable labels, watermarks, or unsupported claims.',
      'Frame the action clearly enough that the verifier can match it to the slot.'
    ],
    durationMs: [Math.max(1000, report.durationMs - 500), report.durationMs + 1000],
    framing: report.slotRole === 'product_closeup' ? 'closeup' : 'medium',
    motion: report.evidenceType === 'usage_demo' ? 'hand_operation' : 'static',
    examplesToAvoid: [
      'synthetic people or unapproved models',
      'claims not present in the product brief',
      'fake testimonials or invented proof'
    ],
    fallbackIfUserCannotProvide: report.evidenceType === 'social_proof'
      ? 'hyperframes_attributed_card'
      : 'leave_unresolved'
  };
}

function buildAssetGenerationRequest(
  report: GapReport,
  context: VideoEditContext,
  matchedAsset: AssetCard | undefined
): AssetGenerationRequest {
  return {
    slotId: report.slotId,
    generationMode: 'text_to_image',
    semanticRole: `${report.slotRole} atmosphere fill`,
    positivePrompt: [
      `Vertical ${context.constraints.aspectRatio} advertising background.`,
      `Clean visual atmosphere for ${context.contentBrief.productName}.`,
      `Support the emotional function: ${report.emotionalFunction}.`,
      'No readable text or factual proof.'
    ].join(' '),
    negativePrompt: 'people, faces, logos, readable text, claims, rankings, fake product labels, watermark',
    referenceAssetIds: matchedAsset ? [matchedAsset.id] : [],
    durationMs: report.durationMs,
    aspectRatio: context.constraints.aspectRatio,
    forbiddenElements: [
      'people',
      'faces',
      'logos',
      'readable text',
      'on-screen claims',
      'prices',
      'rankings',
      'fake proof'
    ],
    riskFlags: ['aigc_visual_coherence', 'no_claims_in_pixels'],
    fallbackRepair: 'deterministic_editing_fill',
    maxRegenerations: 2,
    verificationCriteria: [
      'no readable text',
      'no invented human or proof',
      'style matches neighboring assets',
      'safe area compatible'
    ]
  };
}

function buildReuseSpec(report: GapReport, matchedAsset: AssetCard | undefined): ReuseAssetSpec | undefined {
  if (!matchedAsset || matchedAsset.type === 'text') return undefined;

  return {
    assetId: matchedAsset.id,
    treatment: matchedAsset.type === 'image' ? 'still_to_motion' : 'crop_zoom',
    durationMs: report.durationMs,
    motionIntent: matchedAsset.type === 'image'
      ? `Animate the real asset with a deterministic crop/zoom to preserve ${report.emotionalFunction}.`
      : `Reuse the real clip with crop/zoom timing to preserve ${report.emotionalFunction}.`
  };
}

function buildQualityImpact(report: GapReport): QualityImpact {
  // NOTE: degrade currently fires only on real-proof gaps (chooseGapFillPolicy), whose evidenceType is
  // always a proof type, so severity resolves to 'lost' today. 'reduced' is reserved for a future
  // non-proof degraded path and remains schema-valid; it is intentionally not yet reachable.
  const proofEvidence = report.evidenceType === 'product_identity'
    || report.evidenceType === 'social_proof'
    || report.evidenceType === 'usage_demo'
    || report.evidenceType === 'factual_claim';
  const severity: QualityImpact['severity'] = proofEvidence ? 'lost' : 'reduced';
  return {
    dimension: 'visual_fidelity',
    severity,
    originalEvidenceType: report.evidenceType,
    note: `Original ${report.slotRole} evidence (${report.evidenceType}) could not be reproduced; represented as an attributed communication substitute. Visual proof fidelity ${severity}; structural and emotional role preserved as far as honestly possible.`
  };
}

function buildDeterministicEditingSpec(
  report: GapReport,
  context: VideoEditContext,
  matchedAsset: AssetCard | undefined,
  degraded: boolean
): HyperFramesFillSpec {
  return {
    slotId: report.slotId,
    repairType: repairTypeForReport(report),
    durationMs: report.durationMs,
    copy: {
      headline: headlineForReport(report, context),
      subline: degraded
        ? `The original ${report.slotRole} footage is unavailable and was not recreated; this segment is shown as an attributed ${context.contentBrief.productName} card.`
        : report.whyUnmatched,
      bullets: context.contentBrief.sellingPoints.slice(0, 2),
      cta: context.contentBrief.cta
    },
    referencedAssets: matchedAsset ? [matchedAsset.id] : [],
    layoutIntent: `Use deterministic composition to preserve ${report.emotionalFunction}.`,
    motionIntent: 'Use crop, push-in, card reveal, or subtitle emphasis without inventing footage.',
    styleTokens: ['vertical_safe_area', 'claim_attributed_text', context.structureGraph.meta.style],
    verificationCriteria: [
      'duration within slot tolerance',
      'text is readable',
      'claims are supported',
      'layout fits safe area'
    ]
  };
}

function buildScriptRepairSpec(report: GapReport, context: VideoEditContext): ScriptRepairSpec {
  return {
    scriptIntent: `Preserve ${report.emotionalFunction} while explaining the missing visual evidence honestly.`,
    subtitleLines: [
      context.contentBrief.productName,
      ...context.contentBrief.sellingPoints.slice(0, 2)
    ],
    voiceoverHint: 'Use only content brief facts and avoid unsupported proof claims.'
  };
}

function repairTypeForReport(report: GapReport): HyperFramesFillSpec['repairType'] {
  if (report.slotRole === 'opening_attention') return 'title_card';
  if (report.slotRole === 'comparison') return 'comparison_card';
  if (report.slotRole === 'cta_visual') return 'cta_card';
  if (report.visualType === 'text') return 'subtitle_patch';
  return 'selling_point_card';
}

function headlineForReport(report: GapReport, context: VideoEditContext): string {
  if (report.slotRole === 'opening_attention') return context.contentBrief.productName;
  if (report.slotRole === 'comparison') return 'Compare the difference';
  if (report.slotRole === 'cta_visual') return context.contentBrief.cta;
  return context.contentBrief.sellingPoints[0] ?? context.contentBrief.productName;
}

function buildVerifierChecks(
  report: GapReport,
  match: SlotMatch | undefined,
  graph: ViralStructureGraph
): GapFillPlan['verifierChecks'] {
  const checks: GapFillPlan['verifierChecks'] = [
    {
      id: `${report.slotId}_slot_reference`,
      type: 'slot_reference',
      level: 'local',
      description: 'The gap fill must reference an existing shot slot from the inherited structure graph.'
    },
    {
      id: `${report.slotId}_duration`,
      type: 'duration',
      level: 'local',
      description: 'The fill duration must preserve the inherited slot timing within tolerance.'
    },
    {
      id: `${report.slotId}_claim_supported`,
      type: 'claim_supported',
      level: 'local',
      description: 'Any generated copy must be supported by the content brief or inherited evidence.'
    },
    {
      id: `${report.slotId}_structure_fidelity`,
      type: 'structure_fidelity',
      level: 'global',
      description: 'The repaired timeline must preserve role sequence, pacing, and beat alignment after the full repair batch.'
    },
    {
      id: `${report.slotId}_emotional_function`,
      type: 'emotional_function',
      level: 'global',
      description: `The repaired timeline must preserve the slot emotional function: ${report.emotionalFunction}.`
    }
  ];

  if (match?.assetId) {
    checks.push({
      id: `${report.slotId}_asset_reference`,
      type: 'asset_reference',
      level: 'local',
      description: 'The repair may only reference asset IDs present in the inherited asset library.'
    });
  }

  if (graph.meta.aspectRatio === '9:16') {
    checks.push({
      id: `${report.slotId}_safe_area`,
      type: 'safe_area',
      level: 'local',
      description: 'Generated packaging must fit the vertical-video safe area.'
    });
  }

  if (report.requiresRealProof) {
    checks.push({
      id: `${report.slotId}_no_unapproved_human_generation`,
      type: 'no_unapproved_human_generation',
      level: 'local',
      description: 'Real-proof gaps must not be filled with unapproved generated humans or fake evidence.'
    });
  }

  if (report.evidenceType === 'product_identity') {
    checks.push({
      id: `${report.slotId}_product_identity`,
      type: 'product_identity',
      level: 'local',
      description: 'The result must show the real product identity rather than invented packaging.'
    });
  }

  if (report.evidenceType === 'none') {
    checks.push({
      id: `${report.slotId}_style_match`,
      type: 'style_match',
      level: 'local',
      description: 'Atmosphere or background fills must visually cohere with neighboring real assets.'
    });
  }

  return checks;
}
