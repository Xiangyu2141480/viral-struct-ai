import type {
  CreativeIngredientType,
  SegmentRole,
  ShotSlotAcceptanceCriteria,
  ShotSlotIntent,
  ShotSlotRole
} from '@viral-struct/shared';
import type { AssetGenerationRequest } from '../generation/AssetGenerationRequest';
import type { HyperFramesFillSpec } from '../generation/hyperframesFillSpec';

export type GapEvidenceType =
  | 'none'
  | 'product_identity'
  | 'social_proof'
  | 'factual_claim'
  | 'usage_demo';

export type GapEmotionalFunction =
  | 'curiosity'
  | 'desire'
  | 'trust'
  | 'urgency';

export interface GapReport {
  id: string;
  slotId: string;
  segmentId: string;
  segmentRole?: SegmentRole;
  slotRole: ShotSlotRole;
  visualType: 'image' | 'video' | 'text' | 'generated';
  durationMs: number;
  evidenceType: GapEvidenceType;
  requiresRealProof: boolean;
  emotionalFunction: GapEmotionalFunction;
  whyUnmatched: string;
  missingIngredients: CreativeIngredientType[];
  sourceIntent?: ShotSlotIntent;
  acceptanceCriteria?: ShotSlotAcceptanceCriteria;
}

export type GapFillMethod =
  | 'aigc_fill'
  | 'deterministic_editing_fill'
  | 'ask_user_for_asset';

export type GapFillRiskLevel = 'low' | 'medium' | 'high';

export type GapFillResolutionStatus = 'planned' | 'unresolved';

/**
 * Honest record of what could NOT be delivered when a gap is degraded to a communication substitute.
 * Its presence is what lets the system avoid silently overclaiming (invariant: Honesty).
 */
export interface QualityImpact {
  dimension: 'visual_fidelity';
  severity: 'reduced' | 'lost';
  originalEvidenceType: GapEvidenceType;
  note: string;
}

export interface ReuseAssetSpec {
  assetId: string;
  treatment: 'crop_zoom' | 'loop' | 'reorder' | 'still_to_motion';
  durationMs: number;
  motionIntent?: string;
}

export interface UserAssetRequest {
  reason: string;
  whyRequired: string;
  idealShot: string;
  minimalAcceptableShot: string;
  shootingTips: string[];
  durationMs: [number, number];
  framing: 'closeup' | 'medium' | 'wide' | 'macro';
  motion: 'static' | 'push_in' | 'hand_operation' | 'fast_cut';
  examplesToAvoid: string[];
  fallbackIfUserCannotProvide: 'hyperframes_attributed_card' | 'leave_unresolved';
}

export interface ScriptRepairSpec {
  scriptIntent: string;
  subtitleLines: string[];
  voiceoverHint?: string;
}

export interface GapFillVerifierCheck {
  id: string;
  type:
    | 'slot_reference'
    | 'asset_reference'
    | 'duration'
    | 'safe_area'
    | 'claim_supported'
    | 'product_identity'
    | 'style_match'
    | 'no_unapproved_human_generation'
    | 'structure_fidelity'
    | 'emotional_function';
  description: string;
  level: 'local' | 'global';
  /**
   * Tri-state verdict. 'pending' = not measurable until the executor produces pixels/timeline;
   * it is never reported as a fake 'pass' nor a false 'fail'.
   */
  status?: 'pass' | 'fail' | 'pending';
}

export interface GapFillPlan {
  id: string;
  gapReportId: string;
  slotId: string;
  segmentId: string;
  inheritedContext: {
    slotRole: ShotSlotRole;
    segmentRole?: SegmentRole;
    sourceIntent?: ShotSlotIntent;
    acceptanceCriteria?: ShotSlotAcceptanceCriteria;
    missingIngredients?: CreativeIngredientType[];
    matchStatus: 'partial' | 'missing';
    matchScore?: number;
  };
  method: GapFillMethod;
  reason: string;
  riskLevel: GapFillRiskLevel;
  resolutionStatus: GapFillResolutionStatus;
  qualityImpact?: QualityImpact;
  safetyGate: {
    requiresRealProof: boolean;
    aigcAllowed: boolean;
    userAssetRequired: boolean;
  };
  reuseSpec?: ReuseAssetSpec;
  editingSpec?: HyperFramesFillSpec;
  aigcRequest?: AssetGenerationRequest;
  userAssetRequest?: UserAssetRequest;
  scriptRepairSpec?: ScriptRepairSpec;
  verifierChecks: GapFillVerifierCheck[];
}
