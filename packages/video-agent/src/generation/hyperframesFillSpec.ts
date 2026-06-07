export interface HyperFramesFillSpec {
  slotId: string;
  repairType:
    | 'title_card'
    | 'selling_point_card'
    | 'comparison_card'
    | 'cta_card'
    | 'subtitle_patch'
    | 'product_layout'
    | 'transition_bridge';
  durationMs: number;
  copy: {
    headline?: string;
    subline?: string;
    bullets?: string[];
    cta?: string;
  };
  referencedAssets: string[];
  layoutIntent: string;
  motionIntent: string;
  styleTokens: string[];
  verificationCriteria: string[];
}
