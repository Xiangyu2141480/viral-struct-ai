import type { MaterialGap } from '@viral-struct/shared';
import type { EditConstraints } from '../context/VideoEditContext';
import type { GapFillMethod, GapFillRiskLevel, GapReport } from './GapFillPlan';

export interface GapFillPolicyDecision {
  method: GapFillMethod;
  riskLevel: GapFillRiskLevel;
  reason: string;
  aigcAllowed: boolean;
  userAssetRequired: boolean;
  /** True when a real-proof gap was honestly degraded to a communication substitute (evidence not reproduced). */
  degraded: boolean;
}

export function chooseGapFillPolicy(
  report: GapReport,
  gap: MaterialGap,
  constraints: EditConstraints,
  userUnprovidable: boolean
): GapFillPolicyDecision {
  if (report.requiresRealProof) {
    // Real proof can NEVER be satisfied by AIGC, so the AIGC flag is irrelevant here. If the user has
    // confirmed they cannot provide the asset, honestly degrade instead of re-asking for what they cannot give.
    if (userUnprovidable) {
      return {
        method: 'deterministic_editing_fill',
        riskLevel: 'high',
        reason: 'Real evidence is unavailable (user cannot provide) and AIGC can never satisfy a real-proof slot. Preserve the communication function with an attributed HyperFrames substitute; the original evidence stays unresolved and is never presented as proof.',
        aigcAllowed: false,
        userAssetRequired: false,
        degraded: true
      };
    }
    return {
      method: 'ask_user_for_asset',
      riskLevel: 'high',
      reason: 'The missing slot requires real-world evidence; AIGC is forbidden as the first answer.',
      aigcAllowed: false,
      userAssetRequired: true,
      degraded: false
    };
  }

  if (constraints.allowAigc && gap.type === 'missing_scene_style') {
    return {
      method: 'aigc_fill',
      riskLevel: 'medium',
      reason: 'A style or atmosphere gap can use bounded AIGC because it does not carry proof or claims.',
      aigcAllowed: true,
      userAssetRequired: false,
      degraded: false
    };
  }

  return {
    method: 'deterministic_editing_fill',
    riskLevel: gap.severity === 'high' ? 'medium' : 'low',
    reason: 'The gap can be repaired by transforming existing assets, cards, subtitles, or deterministic packaging.',
    aigcAllowed: false,
    userAssetRequired: false,
    degraded: false
  };
}
