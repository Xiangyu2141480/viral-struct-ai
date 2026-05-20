export type SegmentRole =
  | 'hook'
  | 'pain_point'
  | 'selling_point'
  | 'proof'
  | 'usage'
  | 'comparison'
  | 'cta';

export type ShotSlotRole =
  | 'opening_attention'
  | 'product_closeup'
  | 'usage_demo'
  | 'benefit_visual'
  | 'comparison'
  | 'testimonial'
  | 'cta_visual';

export type GapRepairStrategy =
  | 'structure_reorder'
  | 'caption_rewrite'
  | 'text_card'
  | 'selling_point_card'
  | 'comparison_card'
  | 'cta_card'
  | 'crop_zoom'
  | 'reuse_asset'
  | 'aigc_background'
  | 'aigc_voiceover'
  | 'hand_demo'
  | 'product_closeup_replacement'
  | 'texture_card'
  | 'swatch_card'
  | 'before_after_card'
  | 'trust_card'
  | 'style_filter_suggestion'
  | 'ask_user_for_human_demo';

export type CreativeIngredientType =
  | 'human_presence'
  | 'face_closeup'
  | 'host_talking'
  | 'hand_demo'
  | 'beauty_demo'
  | 'makeup_application'
  | 'skin_texture_display'
  | 'before_after_comparison'
  | 'product_closeup_trait'
  | 'texture_display'
  | 'swatch_demo'
  | 'scene_style'
  | 'soft_light'
  | 'clean_background'
  | 'premium_visual'
  | 'trust_building'
  | 'social_proof'
  | 'professional_review'
  | 'lifestyle_context'
  | 'unknown';

export type IngredientTransferability =
  | 'directly_transferable'
  | 'requires_user_asset'
  | 'can_be_recreated_by_packaging'
  | 'can_be_replaced_by_repair'
  | 'not_transferable';

export type HumanRole = 'host' | 'model' | 'user' | 'hand_only' | 'none';

export type AssetHumanRole = Exclude<HumanRole, 'none'> | 'unknown';

export type HumanFraming =
  | 'face_closeup'
  | 'half_body'
  | 'full_body'
  | 'hands'
  | 'skin_macro'
  | 'product_only';

export type HumanAction =
  | 'talking'
  | 'applying_product'
  | 'showing_result'
  | 'swatching'
  | 'holding_product'
  | 'none';

export type AssetHumanAction = Exclude<HumanAction, 'none'>;

export type VisualStyleTag =
  | 'soft_light'
  | 'clean_background'
  | 'premium_visual'
  | 'lifestyle_context'
  | 'beauty_style'
  | 'professional_review';

export type CreativeIngredientEvidence = {
  type: 'frame' | 'timestamp' | 'transcript' | 'model_observation';
  value: string;
};

export interface CreativeIngredient {
  id: string;
  type: CreativeIngredientType;
  name: string;
  description: string;
  segmentIds: string[];
  requiredForSlotIds: string[];
  transferability: IngredientTransferability;
  requiredAssets?: string[];
  fallbackStrategies: GapRepairStrategy[];
  evidence: CreativeIngredientEvidence[];
  confidence: number;
}

export interface VideoMetadata {
  videoId: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  aspectRatio: '9:16' | '16:9' | '1:1' | 'unknown';
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Shot {
  id: string;
  start: number;
  end: number;
  keyframeUrl?: string;
  description?: string;
}

export interface Keyframe {
  time: number;
  url: string;
  description?: string;
}

export interface VideoAnalysis {
  metadata: VideoMetadata;
  shots: Shot[];
  keyframes: Keyframe[];
  transcript: TranscriptSegment[];
}

export interface SegmentNode {
  id: string;
  role: SegmentRole;
  start: number;
  end: number;
  duration: number;
  purpose: string;
  narration?: string;
  caption?: string;
  transferRule: string;
  importance: 1 | 2 | 3 | 4 | 5;
}

export interface ShotSlotNode {
  id: string;
  segmentId: string;
  role: ShotSlotRole;
  requiredAsset: {
    type: 'image' | 'video' | 'text' | 'generated';
    subject: string;
    camera?: 'closeup' | 'medium' | 'wide' | 'macro' | 'unknown';
    motion?: 'static' | 'push_in' | 'pan' | 'fast_cut' | 'hand_operation' | 'unknown';
    minDuration?: number;
  };
  visualIngredientRequirements?: CreativeIngredientType[];
  humanRequirement?: {
    required: boolean;
    role?: HumanRole;
    framing?: HumanFraming;
    action?: HumanAction;
  };
  fallbackStrategies: GapRepairStrategy[];
  importance?: 1 | 2 | 3 | 4 | 5;
}

export interface RhythmStructure {
  avgShotDuration: number;
  cutFrequency: 'low' | 'medium' | 'high';
  peakAt?: number;
  pattern: string;
}

export interface PackagingStructure {
  captionDensity: 'low' | 'medium' | 'high';
  captionPosition: 'bottom_center' | 'center' | 'top' | 'mixed';
  titleStyle: string;
  cardTypes: string[];
  transitions: string[];
  coverStyle: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'sequence' | 'requires' | 'maps_to' | 'fallback';
  explanation?: string;
}

export interface ViralStructureGraph {
  meta: {
    duration: number;
    aspectRatio: '9:16' | '16:9' | '1:1' | 'unknown';
    videoType: 'ecommerce' | 'local_service' | 'course' | 'brand' | 'unknown';
    style: 'high_click' | 'high_conversion' | 'premium' | 'fast_pace' | 'unknown';
  };
  structureSummary: string;
  segments: SegmentNode[];
  shotSlots: ShotSlotNode[];
  rhythm: RhythmStructure;
  packaging: PackagingStructure;
  creativeIngredients: CreativeIngredient[];
  edges: GraphEdge[];
}

export interface ContentBrief {
  productName: string;
  targetAudience: string;
  scenario: string;
  sellingPoints: string[];
  cta: string;
  stylePreference?: string;
}

export interface AssetCard {
  id: string;
  type: 'image' | 'video' | 'text';
  url?: string;
  text?: string;
  spatialDescription?: string;
  temporalDescription?: string;
  detectedObjects: string[];
  suitableSlots: ShotSlotRole[];
  qualityScore: number;
  detectedIngredients?: CreativeIngredientType[];
  humanPresence?: {
    hasHuman: boolean;
    role?: AssetHumanRole;
    framing?: HumanFraming[];
    actions?: AssetHumanAction[];
  };
  visualStyleTags?: VisualStyleTag[];
}

export interface SlotMatch {
  slotId: string;
  assetId?: string;
  score: number;
  ingredientMatchScore?: number;
  missingIngredients?: CreativeIngredientType[];
  status: 'matched' | 'partial' | 'missing';
  reason: string;
}

export type MaterialGapType =
  | 'missing_opening_visual'
  | 'missing_product_closeup'
  | 'missing_usage_demo'
  | 'missing_comparison'
  | 'missing_cta_visual'
  | 'missing_human_host'
  | 'missing_face_closeup'
  | 'missing_usage_action'
  | 'missing_beauty_demo'
  | 'missing_before_after'
  | 'missing_trust_element'
  | 'missing_scene_style'
  | 'missing_visual_ingredient';

export interface MaterialGap {
  slotId: string;
  role: ShotSlotRole;
  type?: MaterialGapType;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  impact: string;
  affectedSegmentId?: string;
  missingIngredients?: CreativeIngredientType[];
}

export interface GapRepair {
  slotId: string;
  strategy: GapRepairStrategy;
  explanation: string;
  generatedAssetHint?: string;
}

export interface ScriptSegment {
  segmentId: string;
  role: SegmentRole;
  start: number;
  end: number;
  text: string;
  evidence: string[];
}

export interface StoryboardShot {
  id: string;
  start: number;
  end: number;
  visual: string;
  narration: string;
  packaging: string;
}

export interface TimelineItem {
  id: string;
  start: number;
  end: number;
  segmentRole: SegmentRole;
  sourceSegmentId: string;
  slotId: string;
  assetId?: string;
  script: string;
  subtitles: string[];
  visualAction: string;
  packaging: {
    captionStyle: string;
    cardType?: 'title_card' | 'selling_point_card' | 'comparison_card' | 'cta_card';
    transition?: 'quick_cut' | 'zoom_in' | 'push' | 'fade';
    motion?: 'crop_zoom' | 'pan' | 'static' | 'push_in';
  };
  repair?: GapRepair;
}

export interface QualityReport {
  structureMatch: number;
  slotCoverage: number;
  visualScriptAlignment: number;
  factuality: number;
  coherence: number;
  subtitleReadability: number;
  warnings: string[];
}
