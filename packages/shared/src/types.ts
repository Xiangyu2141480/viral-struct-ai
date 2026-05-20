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
  | 'aigc_background';

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
  fallbackStrategies: GapRepairStrategy[];
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
}

export interface SlotMatch {
  slotId: string;
  assetId?: string;
  score: number;
  status: 'matched' | 'partial' | 'missing';
  reason: string;
}

export interface MaterialGap {
  slotId: string;
  role: ShotSlotRole;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  impact: string;
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
