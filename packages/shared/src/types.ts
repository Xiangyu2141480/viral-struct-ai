export type SegmentRole =
  | 'hook'
  | 'pain_point'
  | 'selling_point'
  | 'proof'
  | 'usage'
  | 'comparison'
  | 'cta'
  // instructional roles (course/tutorial genre)
  | 'explanation'
  | 'demonstration'
  | 'technique_step'
  | 'context';

export type ShotSlotRole =
  | 'opening_attention'
  | 'product_closeup'
  | 'usage_demo'
  | 'benefit_visual'
  | 'comparison'
  | 'testimonial'
  | 'cta_visual'
  // instructional slot roles (course/tutorial genre)
  | 'instruction_card'
  | 'example_clip'
  | 'technique_demo';

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
  analysisSource?: 'real_ffmpeg' | 'mock_fallback';
  warnings?: string[];
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

export interface ShotSlotIntent {
  purpose: string;
  energyLevel: 'low' | 'medium' | 'high';
  motionPattern: string;
  compositionPrincipal: string;
  durationMs: [number, number];
  soundDesignHint?: string;
}

export interface ShotSlotSourceInstance {
  productInSource: string;
  specificAction?: string;
  colorSignature?: string;
}

export interface ShotSlotAcceptanceCriterion {
  motionType?: string;
  compositionType?: string;
  examples: string[];
}

export interface ShotSlotAcceptanceCriteria {
  anyOf: ShotSlotAcceptanceCriterion[];
  rejectIf?: string[];
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
  intent?: ShotSlotIntent;
  sourceInstance?: ShotSlotSourceInstance;
  acceptanceCriteria?: ShotSlotAcceptanceCriteria;
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

export interface BoundaryMicroShot {
  id: string;
  role: 'pre_transition' | 'transition_peak' | 'post_transition' | 'unknown';
  durationMs?: number;  // milliseconds
  description?: string;
}

export interface Boundary {
  id: string;
  from: string;
  to: string;
  transitionType: 'cut' | 'fade' | 'morph' | 'wipe' | 'dissolve' | 'unknown';
  intensity?: 'weak' | 'medium' | 'strong';
  alignedToBeat?: boolean;
  microShots?: BoundaryMicroShot[];
  evidence?: string;
}

export interface ViralStructureGraph {
  schemaVersion?: 'v0' | 'v1';
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
  boundaries?: Boundary[];
}

export interface ContentBrief {
  productName: string;
  targetAudience: string;
  scenario: string;
  sellingPoints: string[];
  cta: string;
  stylePreference?: string;
}

export interface AssetVisualContent {
  primarySubject: string;
  subjectPosition: string;
  negativeSpace?: string;
  kinematicElements: string[];
  lighting?: string;
  colorPalette?: string[];
}

export interface AssetMotionPotential {
  isStill: boolean;
  implicitMotion: 'low' | 'medium' | 'high';
  canSimulateMotion?: string[];
  canSimulateDurationMs?: [number, number];
}

export interface AssetCandidateSlotRole {
  role: ShotSlotRole;
  confidence: number;
  caveat?: string;
}

export type AssetManagerRole =
  | 'opening_hook'
  | 'product_closeup'
  | 'usage_demo'
  | 'comparison'
  | 'benefit_proof'
  | 'lifestyle_scene'
  | 'background'
  | 'packaging_card'
  | 'cta'
  | 'cover';

export interface RoleAffordanceComponents {
  semanticFit: number;
  visualSignalFit: number;
  productVisibilityFit: number;
  qualityFit: number;
  formatFit: number;
  editabilityFit: number;
  safetyFit: number;
}

export interface RoleAffordanceScore {
  role: AssetManagerRole;
  score: number;
  confidence?: number;
  components: RoleAffordanceComponents;
  rationale: string;
  reasons?: string[];
  evidence?: string[];
}

export type AssetRole = AssetManagerRole | ShotSlotRole | 'title_card' | 'text_brief' | 'unknown';

export interface AssetKeyframe {
  id: string;
  timeSec?: number;
  url?: string;
  description?: string;
  source: 'uploaded_video' | 'sampled_frame' | 'placeholder' | 'manual';
}

export interface AssetMediaProfile {
  kind: 'image' | 'video' | 'text';
  sourceUrl?: string;
  textLength?: number;
  fileSizeBytes?: number;
  format?: string;
  durationSec?: number;
  fps?: number;
  width?: number;
  height?: number;
  aspectRatio?: '9:16' | '16:9' | '1:1' | 'unknown';
  keyframes: AssetKeyframe[];
  hasAudio?: boolean;
  fileExtension?: string;
}

export interface AssetSemanticProfile {
  summary: string;
  detectedObjects: string[];
  detectedIngredients: CreativeIngredientType[];
  visualStyleTags: VisualStyleTag[];
  humanPresence?: AssetCard['humanPresence'];
  visualContent?: AssetVisualContent;
  motionPotential?: AssetMotionPotential;
}

export interface AssetIssue {
  type:
    | 'missing_metadata'
    | 'low_quality'
    | 'low_resolution'
    | 'no_motion_evidence'
    | 'unsafe_claim'
    | 'unknown';
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export interface AssetQualityProfile {
  overallScore: number;
  resolution: number;
  sharpness: number;
  brightness: number;
  contrast: number;
  clarity: number;
  composition: number;
  lighting: number;
  subjectProminence: number;
  productFocus: number;
  textSafeArea: number;
  formatFit?: number;
  issues: AssetIssue[];
}

export interface SlotAffordanceProfile {
  suitableSlots: ShotSlotRole[];
  primaryRoles: Array<{
    role: ShotSlotRole;
    confidence: number;
    caveat?: string;
  }>;
  missingRoles: ShotSlotRole[];
  rationale: string;
}

export interface AssetEditabilityProfile {
  canCropZoom: boolean;
  canUseAsBackground: boolean;
  canLoop: boolean;
  canExtendWithCards: boolean;
  suggestedEdits: string[];
}

export interface AssetSafetyProfile {
  status: 'passed' | 'needs_review' | 'blocked';
  brandRisk: 'low' | 'medium' | 'high';
  ipRisk: 'low' | 'medium' | 'high';
  claimRisk: 'low' | 'medium' | 'high';
  reasons: string[];
}

export interface AssetSearchProfile {
  tags: string[];
  keywords: string[];
  embeddingText: string;
}

export interface AssetVlmAnalysisProfile {
  source: 'optional_vlm';
  provider: 'openai_compatible';
  model: string;
  analyzedAt: string;
  shortCaption: string;
  sceneType: string;
  productVisible: boolean;
  productVisibilityScore: number;
  detectedObjects: string[];
  textVisible: boolean;
  suggestedRoles: AssetManagerRole[];
  rationale: string;
  risks: string[];
}

export type AssetAnalysisSource =
  | 'static_library'
  | 'mock_filename_rules'
  | 'llm_multimodal'
  | 'manual_text_brief'
  | 'deterministic'
  | 'generated_external'
  | 'planned_generation'
  | 'aigc';

export interface AssetAnalysisProfile {
  profileVersion: 'asset_analysis_v1';
  analyzedAt: string;
  source?: AssetAnalysisSource;
  fallbackUsed: boolean;
  warnings: string[];
  media: AssetMediaProfile;
  semantic: AssetSemanticProfile;
  quality: AssetQualityProfile;
  slotAffordance: SlotAffordanceProfile;
  editability: AssetEditabilityProfile;
  safety: AssetSafetyProfile;
  search: AssetSearchProfile;
  roleAffordance?: RoleAffordanceScore[];
  vlm?: AssetVlmAnalysisProfile;
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
  visualContent?: AssetVisualContent;
  motionPotential?: AssetMotionPotential;
  candidateSlotRoles?: AssetCandidateSlotRole[];
  analysisSource?: AssetAnalysisSource;
  analysis?: AssetAnalysisProfile;
}

export type TransitionGrammarId =
  | 'dynamic_entry'
  | 'impact_beat'
  | 'assembly_reveal'
  | 'activation_moment'
  | 'lockup_transition';

export type TargetTransitionEquivalent =
  | 'ice_cube_drop'
  | 'open_cap'
  | 'pour_to_cup'
  | 'drink_neck_down'
  | 'bottle_rotation'
  | 'lineup_sweep'
  | 'clean_cta_end_frame'
  | 'hyperframes_benefit_card_drop';

export interface TransitionIngredient {
  id: string;
  grammarId: TransitionGrammarId;
  label: string;
  sourcePattern: string;
  targetEquivalent: TargetTransitionEquivalent;
  requiredEvidence: string[];
  acceptableAssetRoles: AssetManagerRole[];
  avoidCopyingSource: string[];
}

export interface TransitionNeed {
  id: string;
  grammarId: TransitionGrammarId;
  sourceMotif: string;
  transferableIntent: string;
  targetEquivalent: TargetTransitionEquivalent;
  targetSlots: string[];
  importance: 'low' | 'medium' | 'high';
  ingredients: TransitionIngredient[];
}

export interface AssetTransitionAffordance {
  assetId: string;
  supportsGrammar: TransitionGrammarId[];
  supportedIngredients: string[];
  confidence: number;
  evidence: string[];
  limitations: string[];
}

export interface TransitionCoverageObservation {
  id: string;
  transitionNeedId: string;
  grammarId: TransitionGrammarId;
  coverageStatus: 'covered' | 'weak' | 'insufficient';
  candidateAssetIds: string[];
  missingIngredientIds: string[];
  potentialImpact: string[];
  confidence: 'low' | 'medium' | 'high';
  ownership: 'asset_manager_transition_observation_only';
}

export interface TransitionHandoffBrief {
  id: string;
  owner: 'video_agent' | 'gap_repair' | 'hyperframes' | 'aigc' | 'manual_shoot';
  transitionNeedIds: string[];
  brief: string;
  prompt?: string;
  negativePrompt?: string;
  safetyNotes: string[];
  notRenderedOutput: boolean;
}

export interface TransitionMotionGrammarHandoff {
  protocolVersion: 'transition-handoff-v1';
  patternId: 'kinetic_assembly';
  sourceExample: string;
  targetProduct: string;
  designLanguage: string;
  boundary: string[];
  transitionNeeds: TransitionNeed[];
  assetAffordances: AssetTransitionAffordance[];
  coverageObservations: TransitionCoverageObservation[];
  downstreamHandoff: TransitionHandoffBrief[];
  warnings: string[];
}

export interface RoleCoverageSummary {
  role: AssetManagerRole;
  status: 'covered' | 'weak' | 'missing';
  bestAssetId?: string;
  bestScore: number;
  assetIds: string[];
}

export interface SlotCandidateAsset {
  assetId: string;
  assetType: AssetCard['type'];
  score: number;
  roleAffordance: number;
  intentSemanticMatch: number;
  acceptanceCriteriaMatch: number;
  assetQuality: number;
  editabilityFit: number;
  rationale: string;
}

export interface SlotCoverageRow {
  slotId: string;
  segmentId?: string;
  slotRole?: ShotSlotRole;
  mappedRole: AssetManagerRole;
  requiredAssetType?: ShotSlotNode['requiredAsset']['type'];
  status: 'covered' | 'weak' | 'missing';
  bestAssetId?: string;
  bestScore: number;
  candidates: SlotCandidateAsset[];
  gapReason?: string;
}

export interface AssetLibraryReport {
  libraryId: string;
  assetCount: number;
  byType: Record<AssetCard['type'], number>;
  avgQualityScore: number;
  qualitySummary?: {
    avgQualityScore: number;
    lowQualityAssetIds: string[];
    warningCount: number;
  };
  coveredSlots: ShotSlotRole[];
  missingSlots: ShotSlotRole[];
  roleCoverage: Record<AssetManagerRole, RoleCoverageSummary>;
  missingRoles: AssetManagerRole[];
  weakRoles: AssetManagerRole[];
  topAssetsByRole: Record<AssetManagerRole, SlotCandidateAsset[]>;
  recommendations: string[];
  warnings: string[];
  generatedAt: string;
}

export interface SlotCoverageMatrix {
  slots: Array<{
    role: ShotSlotRole | AssetManagerRole;
    slotId?: string;
    mappedRole?: AssetManagerRole;
    assetIds: string[];
    bestAssetId?: string;
    bestScore: number;
    coverage: 'covered' | 'weak' | 'partial' | 'missing';
    candidates?: SlotCandidateAsset[];
  }>;
  slotRows: SlotCoverageRow[];
  coveredSlotCount: number;
  totalSlotCount: number;
  coverageRatio: number;
}

export type NormalizedAssetCard = AssetCard & { analysis: AssetAnalysisProfile };

export type AssetLibraryProfile = AssetLibraryReport;

export type MaterialScenarioType =
  | 'empty_assets'
  | 'single_image_only'
  | 'partial_real_footage'
  | 'aigc_ready'
  | 'mixed_real_and_aigc';

export interface MaterialScenarioProfile {
  scenarioType: MaterialScenarioType;
  assetCount: number;
  imageCount: number;
  videoCount: number;
  textCount: number;
  generatedAssetCount: number;
  realFootageCount: number;
  evidenceCoverageScore: number;
  completionFeasibilityScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendedDownstreamMode:
    | 'structure_cards_only'
    | 'single_image_motion_reuse'
    | 'real_footage_editing'
    | 'aigc_missing_material_generation'
    | 'mixed_repair_workflow';
  warnings: string[];
}

export interface CompletionChannelEligibility {
  channel:
    | 'manual_shoot'
    | 'aigc_video_prompt'
    | 'aigc_image_prompt'
    | 'hyperframes_card_animation'
    | 'reuse_crop_zoom'
    | 'copy_packaging_card'
    | 'video_agent_fallback_rendering';
  eligible: boolean;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  requiredInputs: string[];
  providedInputs: string[];
  missingInputs: string[];
  ownership:
    | 'gap_repair_planner'
    | 'video_agent'
    | 'hyperframes_renderer'
    | 'external_generation_adapter'
    | 'human_shooting';
}

export interface ManualShootBrief {
  title: string;
  objective: string;
  shotDescription: string;
  durationSec: number;
  framing: string;
  requiredProps: string[];
  mustCapture: string[];
  avoid: string[];
}

export interface AigcGenerationBrief {
  providerHint: 'gemini' | 'seedance' | 'generic';
  prompt: string;
  negativePrompt: string;
  referenceAssetIds: string[];
  expectedDurationSec: number;
  aspectRatio: '9:16' | '16:9' | '1:1';
  safetyNotes: string[];
}

export interface HyperframesFallbackBrief {
  title: string;
  cardType:
    | 'hook_card'
    | 'benefit_card'
    | 'usage_placeholder_card'
    | 'comparison_card'
    | 'cta_card'
    | 'timeline_bridge_card';
  copyIntent: string;
  visualElements: string[];
  animationHints: string[];
  durationSec: number;
  inputAssets: string[];
}

export interface MissingMaterialBrief {
  id: string;
  affectedSegmentId?: string;
  affectedSlotId: string;
  slotRole: AssetRole;
  slotIntent: string;
  missingIngredients: MissingIngredient[];
  potentialImpact: CoverageImpact[];
  manualShootBrief?: ManualShootBrief;
  aigcGenerationBrief?: AigcGenerationBrief;
  hyperframesBrief?: HyperframesFallbackBrief;
  channelEligibility: CompletionChannelEligibility[];
  ownership: 'asset_manager_handoff_brief_only';
}

export interface AssetSupplyContext {
  protocolVersion: 'asset-supply-v1';
  libraryId: string;
  generatedAt: string;
  assets: NormalizedAssetCard[];
  libraryProfile: AssetLibraryProfile;
  contextualCoverage?: ContextualAssetCoverageReport;
  materialScenario?: MaterialScenarioProfile;
  missingMaterialBriefs?: MissingMaterialBrief[];
  warnings: string[];
}

export interface ContextualAssetCoverageReport {
  graphId: string;
  briefId?: string;
  libraryId: string;
  coverageSummary: {
    totalSlots: number;
    coveredSlots: number;
    weakSlots: number;
    insufficientSlots: number;
    coverageScore: number;
  };
  slotCoverages: ContextualSlotCoverage[];
  observations: MaterialCoverageObservation[];
  warnings: string[];
}

export interface ContextualSlotCoverage {
  slotId: string;
  affectedSegmentId?: string;
  slotRole: AssetRole;
  slotIntent: string;
  sourceInstance?: string;
  acceptanceCriteria?: string[];
  requiredIngredients: RequiredIngredient[];
  availableIngredients: AvailableIngredient[];
  missingIngredients: MissingIngredient[];
  weakIngredients: MissingIngredient[];
  candidateAssets: SlotAssetCandidate[];
  coverageStatus: 'covered' | 'weak' | 'insufficient';
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  limitations: string[];
}

export interface MaterialCoverageObservation {
  id: string;
  affectedSegmentId?: string;
  affectedSlotId: string;
  slotRole: AssetRole;
  slotIntent: string;
  observationType:
    | 'missing_required_ingredient'
    | 'weak_candidate_quality'
    | 'weak_semantic_fit'
    | 'format_mismatch'
    | 'duration_mismatch'
    | 'missing_motion_evidence'
    | 'missing_product_evidence'
    | 'missing_usage_evidence'
    | 'missing_comparison_evidence'
    | 'missing_cta_surface'
    | 'missing_text_safe_area';
  requiredIngredients: RequiredIngredient[];
  missingIngredients: MissingIngredient[];
  availableButWeakIngredients: MissingIngredient[];
  bestCandidateAssetIds: string[];
  potentialImpact: CoverageImpact[];
  severityEstimate: 'low' | 'medium' | 'high';
  confidence: 'high' | 'medium' | 'low';
  evidence: string[];
  ownership: 'asset_manager_observation_only';
}

export interface RequiredIngredient {
  id: string;
  kind:
    | 'visual_subject'
    | 'shot_type'
    | 'motion'
    | 'product_evidence'
    | 'usage_evidence'
    | 'comparison_evidence'
    | 'cta_surface'
    | 'text_safe_area'
    | 'duration'
    | 'aspect_ratio'
    | 'packaging_surface';
  label: string;
  requiredBy: {
    segmentId?: string;
    slotId: string;
    acceptanceCriteria?: string;
  };
  importance: 'low' | 'medium' | 'high';
}

export interface AvailableIngredient {
  requiredIngredientId: string;
  assetId: string;
  score: number;
  evidence: string[];
}

export interface MissingIngredient {
  requiredIngredientId: string;
  label: string;
  reason: string;
  evidence: string[];
}

export interface CoverageImpact {
  type:
    | 'hook_strength_reduced'
    | 'product_clarity_reduced'
    | 'usage_proof_missing'
    | 'comparison_weakened'
    | 'cta_clarity_reduced'
    | 'rhythm_disrupted'
    | 'packaging_overload_risk';
  description: string;
  affectedMetric?:
    | 'hookStrength'
    | 'slotCoverage'
    | 'visualScriptAlignment'
    | 'ctaClarity'
    | 'transitionFidelity';
  severity: 'low' | 'medium' | 'high';
}

export type SlotAssetUsableAs =
  | 'video_clip'
  | 'image_clip'
  | 'poster_frame'
  | 'background_plate'
  | 'overlay_support'
  | 'reference_only';

export interface SlotAssetCandidate {
  assetId: string;
  score: number;
  fitStatus: 'strong' | 'usable' | 'weak';
  usableAs: SlotAssetUsableAs;
  mediaReadiness: {
    hasUsableUrl: boolean;
    hasLocalPath: boolean;
    hasThumbnail: boolean;
    hasKeyframe: boolean;
    hasDuration: boolean;
  };
  constraints: {
    maxRecommendedDurationSec?: number;
    needsCrop?: boolean;
    needsOverlaySupport?: boolean;
    notEnoughForStandaloneShot?: boolean;
    textSafeAreaRisk?: boolean;
  };
  evidence: {
    affordanceScore: number;
    qualityScore: number;
    semanticSignals: string[];
    keyframeIds?: string[];
    reasons: string[];
    warnings: string[];
  };
}

export interface SlotTreatmentSpec {
  motion?: string;
  durationMs?: number;
  syncPoint?: string;
  captionOverlay?: string;
}

export type SlotAlignmentSource = 'llm_judge' | 'rule_based';

export interface AssetMatchEvidence {
  assetId: string;
  qualityScore: number;
  topAffordanceRole?: AssetManagerRole;
  topAffordanceScore?: number;
  productVisibilityScore?: number;
  keyframeIds: string[];
  keyframeCaptions?: string[];
  reasons: string[];
  warnings: string[];
}

export interface SlotMatch {
  slotId: string;
  assetId?: string;
  score: number;
  ingredientMatchScore?: number;
  missingIngredients?: CreativeIngredientType[];
  status: 'matched' | 'partial' | 'missing';
  reason: string;
  quality?: number;
  matchedCriteria?: string[];
  missingDescription?: string;
  treatmentSpec?: SlotTreatmentSpec;
  alignmentSource?: SlotAlignmentSource;
  assetEvidence?: AssetMatchEvidence;
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

export interface GapShootSpec {
  ideal?: string;
  minimalAcceptable?: string;
  alternativeIfNoShoot?: string;
}

export type GapSpecSource = 'llm_generated' | 'rule_based';

export interface MaterialGap {
  slotId: string;
  role: ShotSlotRole;
  type?: MaterialGapType;
  severity: 'low' | 'medium' | 'high';
  reason: string;
  impact: string;
  affectedSegmentId?: string;
  missingIngredients?: CreativeIngredientType[];
  gapSpec?: GapShootSpec;
  gapSpecSource?: GapSpecSource;
}

export interface GapRepair {
  slotId: string;
  strategy: GapRepairStrategy;
  explanation: string;
  generatedAssetHint?: string;
  gapSpec?: GapShootSpec;
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

export type ScriptSource = 'llm_generated' | 'template';

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
  scriptSource?: ScriptSource;
  treatmentSpec?: SlotTreatmentSpec;
}

export interface QualityReport {
  structureMatch: number;
  slotCoverage: number;
  visualScriptAlignment: number;
  factuality: number;
  coherence: number;
  subtitleReadability: number;
  warnings: string[];
  transitionFidelity?: number;  // 0..1; only populated when source boundaries exist
}

export type SafetyStatusLevel = 'passed' | 'needs_review' | 'blocked';
export type SafetyRiskLevel = 'low' | 'medium' | 'high';

export interface SafetyStatus {
  status: SafetyStatusLevel;
  ipRisk: SafetyRiskLevel;
  brandRisk: SafetyRiskLevel;
  claimRisk: SafetyRiskLevel;
  reasons: string[];
}

export type StoryboardFrameType =
  | 'opening_hook'
  | 'product_closeup'
  | 'benefit_usage'
  | 'gap_repair'
  | 'cta_cover';

export interface StoryboardImagePrompt {
  positivePrompt: string;
  negativePrompt: string;
  aspectRatio: '9:16' | '16:9' | '1:1' | 'unknown';
  styleHints: string[];
  promptSource: 'storyboard_prompt_planner';
}

export interface GeneratedVisualAsset {
  id: string;
  type: 'placeholder_svg' | 'external_image';
  url: string;
  mimeType: 'image/svg+xml' | 'image/png' | 'image/jpeg';
  generationSource: 'placeholder' | 'image_api';
  promptId: string;
  label: string;
}

export interface StoryboardFrame {
  id: string;
  frameIndex: number;
  frameType: StoryboardFrameType;
  title: string;
  timelineItemId: string;
  slotId?: string;
  structureIntent: string;
  sourceInstance: string;
  acceptanceCriteria: string[];
  matchedAsset?: Pick<AssetCard, 'id' | 'type' | 'url' | 'text' | 'spatialDescription' | 'temporalDescription' | 'qualityScore'>;
  slotMatch?: Pick<SlotMatch, 'slotId' | 'assetId' | 'score' | 'status' | 'reason' | 'alignmentSource'>;
  materialGap?: Pick<MaterialGap, 'slotId' | 'role' | 'type' | 'severity' | 'reason' | 'impact' | 'gapSpecSource'>;
  repair?: GapRepair;
  imagePrompt: StoryboardImagePrompt;
  generatedVisualAsset?: GeneratedVisualAsset;
  safetyStatus: SafetyStatus;
  rationale: string;
}

export type GenerationProvider = 'mock' | 'seedance_2_0';
export type MissingMaterialGenerationMode = 'image_to_video' | 'text_to_video';
export type MissingMaterialGenerationStatus = 'planned' | 'ready' | 'blocked';

export interface MissingMaterialPromptMetadata {
  source: 'prompt_compactor';
  originalPositivePromptLength: number;
  compactPositivePromptLength: number;
  targetMaxCharacters: number;
  shotSpecPreserved: boolean;
  warnings: string[];
}

export interface MissingMaterialGenerationRequest {
  materialGaps: MaterialGap[];
  repairs?: GapRepair[];
  storyboardFrames?: StoryboardFrame[];
  timeline?: TimelineItem[];
  contentBrief?: ContentBrief;
  aspectRatio?: '9:16' | '16:9' | '1:1' | 'unknown';
  provider?: GenerationProvider;
}

export interface MissingMaterialGenerationJob {
  id: string;
  gapId: string;
  repairId?: string;
  timelineItemId?: string;
  provider: GenerationProvider;
  providerLabel: string;
  mode: MissingMaterialGenerationMode;
  status: MissingMaterialGenerationStatus;
  durationSec: number;
  aspectRatio: '9:16' | '16:9' | '1:1' | 'unknown';
  positivePrompt: string;
  negativePrompt: string;
  shotSpec: string;
  gapType?: MaterialGapType;
  gapSeverity: MaterialGap['severity'];
  repairStrategy?: GapRepairStrategy;
  storyboardFrameId?: string;
  promptMetadata?: MissingMaterialPromptMetadata;
  safetyStatus: SafetyStatus;
  blockedReason?: string;
  disclaimer: string;
}

export interface DemoEstimateMetric {
  score: number;
  label: string;
  explanation: string;
  formula?: string;
  simulated?: boolean;
}

export interface DemoEstimate {
  disclaimer: 'Offline heuristic estimate. Not based on real user behavior.';
  generatedAt: string;
  metrics: {
    viralPotential: DemoEstimateMetric;
    templateFit: DemoEstimateMetric;
    gapRepairCoverage: DemoEstimateMetric;
    evidenceConfidence: DemoEstimateMetric;
    variantDistinctiveness: DemoEstimateMetric;
    estimatedCtrLift: DemoEstimateMetric;
  };
  components: Record<string, number>;
  warnings: string[];
}
