import path from 'node:path';
import type {
  AssetAnalysisProfile,
  AssetCard,
  AssetCandidateSlotRole,
  AssetMediaProfile,
  AssetMotionPotential,
  AssetVideoSegment,
  AssetVisualContent,
  CreativeIngredientType,
  ShotSlotRole,
  VisualSegmentationProfile,
  VisualStyleTag
} from '@viral-struct/shared';
import { AssetCardSchema } from '@viral-struct/shared';
import { scoreAssetQuality } from './assetQualityScorer';
import { extractAssetKeyframes } from './keyframeExtractor';
import { probeImage, probeVideo } from './mediaProbeService';
import { sliceVideoIntoSegments } from './videoSegmentSlicer';
import { scanVisualSegments } from './visualSegmentScanner';

const ANALYZED_AT = '1970-01-01T00:00:00.000Z';

export interface DeterministicAnalyzeOptions {
  files: Express.Multer.File[];
  textBrief?: string;
  ffprobePath?: string;
  ffmpegPath?: string;
  frameDir?: string;
  visualSegmentation?: VisualSegmentationProfile;
}

export async function analyzeAssetsDeterministic(opts: DeterministicAnalyzeOptions): Promise<AssetCard[]> {
  const cards: AssetCard[] = [];

  for (let index = 0; index < opts.files.length; index++) {
    cards.push(...await analyzeFileAsset(opts.files[index], index, opts));
  }

  if (opts.textBrief?.trim()) {
    cards.push(analyzeTextAsset(opts.textBrief.trim()));
  }

  return cards.map((card) => AssetCardSchema.parse(card));
}

async function analyzeFileAsset(file: Express.Multer.File, index: number, opts: DeterministicAnalyzeOptions): Promise<AssetCard[]> {
  const assetId = `asset_${(index + 1).toString().padStart(3, '0')}`;
  const fileKind = classifyFileKind(file.originalname);
  if (fileKind === 'video') {
    return analyzeVideoAsset(file, assetId, opts);
  }
  return [await analyzeImageAsset(file, assetId)];
}

async function analyzeImageAsset(file: Express.Multer.File, assetId: string): Promise<AssetCard> {
  const probe = await probeImage(file.path, { originalName: file.originalname });
  const semantic = inferSemanticFromNameAndText(file.originalname);
  const qualityResult = scoreAssetQuality(probe.media, {
    hasProductCue: semantic.detectedObjects.includes('product') || semantic.detectedObjects.includes('beverage bottle')
  });
  const warnings = [...probe.warnings, ...qualityResult.warnings];
  const fallbackUsed = probe.fallbackUsed || qualityResult.warnings.length > 0;
  const qualityScore = qualityResult.quality.overallScore;
  const analysis = buildAnalysisProfile({
    media: probe.media,
    semantic,
    quality: qualityResult.quality,
    fallbackUsed,
    warnings
  });

  return {
    id: assetId,
    type: 'image',
    url: file.path,
    spatialDescription: semantic.summary,
    detectedObjects: semantic.detectedObjects,
    suitableSlots: semantic.suitableSlots,
    qualityScore,
    detectedIngredients: semantic.detectedIngredients,
    humanPresence: { hasHuman: semantic.detectedIngredients.includes('human_presence') },
    visualStyleTags: semantic.visualStyleTags,
    visualContent: semantic.visualContent,
    motionPotential: semantic.motionPotential,
    candidateSlotRoles: semantic.candidateSlotRoles,
    analysisSource: 'deterministic',
    analysis
  };
}

async function analyzeVideoAsset(file: Express.Multer.File, assetId: string, opts: DeterministicAnalyzeOptions): Promise<AssetCard[]> {
  const probe = await probeVideo(file.path, { ffprobePath: opts.ffprobePath, originalName: file.originalname });
  const semantic = inferSemanticFromNameAndText(`${file.originalname} video motion usage demo`);
  const visualSegmentation = opts.visualSegmentation ?? await scanVisualSegments({
    filePath: file.path,
    durationSec: probe.media.durationSec,
    ffmpegPath: opts.ffmpegPath
  });
  const roughSegments = sliceVideoIntoSegments({
    assetId,
    media: { ...probe.media, keyframes: [] },
    semanticSummary: `${file.originalname} ${semantic.summary}`,
    suitableSlots: semantic.suitableSlots,
    qualityScore: 0.65,
    segmentation: visualSegmentation
  });
  const frameResult = await extractAssetKeyframes({
    filePath: file.path,
    assetId,
    durationSec: probe.media.durationSec,
    frameDir: opts.frameDir,
    ffmpegPath: opts.ffmpegPath,
    maxFrames: Math.max(roughSegments.length, 5),
    sampleTimesSec: roughSegments.map(segmentMidpoint)
  });
  const media: AssetMediaProfile = {
    ...probe.media,
    keyframes: frameResult.keyframes
  };
  const qualityResult = scoreAssetQuality(media, {
    hasProductCue: semantic.detectedObjects.includes('product') || semantic.detectedObjects.includes('beverage bottle')
  });
  const warnings = [...probe.warnings, ...frameResult.warnings, ...qualityResult.warnings];
  const fallbackUsed = probe.fallbackUsed || frameResult.fallbackUsed || qualityResult.warnings.length > 0;
  const qualityScore = qualityResult.quality.overallScore;
  const segments = sliceVideoIntoSegments({
    assetId,
    media,
    semanticSummary: `${file.originalname} ${semantic.summary}`,
    suitableSlots: semantic.suitableSlots,
    qualityScore,
    segmentation: visualSegmentation
  });
  const analysis = buildAnalysisProfile({
    media,
    semantic,
    quality: qualityResult.quality,
    fallbackUsed,
    warnings: [...warnings, ...visualSegmentation.warnings],
    visualSegmentation,
    videoSegments: segments
  });

  const parentCard: AssetCard = {
    id: assetId,
    type: 'video',
    url: file.path,
    spatialDescription: semantic.summary,
    temporalDescription: media.durationSec
      ? `Video asset, ${media.durationSec}s at ${media.fps ?? 0}fps; ${frameResult.keyframes.length} keyframes sampled.`
      : 'Video asset; metadata unavailable, using deterministic fallback.',
    detectedObjects: semantic.detectedObjects,
    suitableSlots: semantic.suitableSlots,
    qualityScore,
    detectedIngredients: semantic.detectedIngredients,
    humanPresence: { hasHuman: semantic.detectedIngredients.includes('human_presence') },
    visualStyleTags: semantic.visualStyleTags,
    visualContent: semantic.visualContent,
    motionPotential: {
      ...semantic.motionPotential,
      isStill: false,
      implicitMotion: media.durationSec ? 'medium' : semantic.motionPotential.implicitMotion
    },
    candidateSlotRoles: semantic.candidateSlotRoles,
    analysisSource: 'deterministic',
    analysis
  };
  return segments.map((segment, index) => buildVideoSegmentAssetCard(parentCard, segment, index));
}

function segmentMidpoint(segment: AssetVideoSegment): number {
  return Number((segment.startSec + segment.durationSec / 2).toFixed(3));
}

function analyzeTextAsset(text: string): AssetCard {
  const semantic = inferTextSemantic(text);
  const media: AssetMediaProfile = {
    kind: 'text',
    textLength: text.length,
    format: 'plain_text',
    keyframes: []
  };
  const qualityResult = scoreAssetQuality(media, {
    hasProductCue: true,
    isTextCta: semantic.detectedObjects.includes('cta_copy')
  });
  const analysis = buildAnalysisProfile({
    media,
    semantic,
    quality: qualityResult.quality,
    fallbackUsed: false,
    warnings: []
  });

  return {
    id: 'asset_text_brief',
    type: 'text',
    text,
    detectedObjects: semantic.detectedObjects,
    suitableSlots: semantic.suitableSlots,
    qualityScore: qualityResult.quality.overallScore,
    detectedIngredients: semantic.detectedIngredients,
    humanPresence: { hasHuman: false },
    visualStyleTags: semantic.visualStyleTags,
    motionPotential: semantic.motionPotential,
    candidateSlotRoles: semantic.candidateSlotRoles,
    analysisSource: 'deterministic',
    analysis
  };
}

interface SemanticFallback {
  summary: string;
  detectedObjects: string[];
  suitableSlots: ShotSlotRole[];
  detectedIngredients: CreativeIngredientType[];
  visualStyleTags: VisualStyleTag[];
  visualContent?: AssetVisualContent;
  motionPotential: AssetMotionPotential;
  candidateSlotRoles: AssetCandidateSlotRole[];
}

function inferSemanticFromNameAndText(value: string): SemanticFallback {
  const lower = value.toLowerCase();
  const hasProductCue = /product|bottle|pack|label|tea|drink|beverage|商品|产品|瓶|包装|标签|饮料|茶/.test(lower);
  const hasBenefitCue = /splash|ice|cold|lemon|refresh|condensation|pour|drink|冰|冰爽|冷饮|飞溅|柠檬|解腻|倒|喝/.test(lower);
  const hasUsageCue = /usage|demo|hand|pickup|pick_up|open|cap|drink|pour|cup|use|手|拿起|开盖|杯|饮用/.test(lower);
  const hasComparisonCue = /compare|comparison|lineup|series|before_after|before-after|multi[-_ ]?pack|多瓶|多规格|对比|陈列|系列/.test(lower);
  const hasCtaSurfaceCue = /cta|clean[-_ ]?end|end[-_ ]?frame|negative[-_ ]?space|copy[-_ ]?ready|留白|结尾|收尾|购买|立即/.test(lower);
  const hasOpeningCue = /hook|opening|splash|ice|cold|motion|action|开头|吸引|冰爽|飞溅|动作/.test(lower);
  const detectedObjects = unique([
    hasProductCue ? 'beverage bottle' : 'visual asset',
    ...(hasBenefitCue ? ['benefit cue'] : []),
    ...(hasComparisonCue ? ['product lineup'] : []),
    ...(hasUsageCue ? ['hand', 'usage scene'] : []),
    ...(hasCtaSurfaceCue ? ['copy-ready surface'] : [])
  ]);
  const suitableSlots: ShotSlotRole[] = uniqueRoles([
    ...(hasOpeningCue ? ['opening_attention' as const] : []),
    ...(hasBenefitCue ? ['benefit_visual' as const] : []),
    ...(hasUsageCue ? ['usage_demo' as const] : []),
    ...(hasComparisonCue ? ['comparison' as const] : []),
    ...(hasProductCue ? ['product_closeup' as const] : []),
    ...(hasCtaSurfaceCue || (hasProductCue && !hasUsageCue) ? ['cta_visual' as const] : []),
    ...(!hasProductCue && !hasBenefitCue && !hasUsageCue && !hasComparisonCue && !hasCtaSurfaceCue ? ['product_closeup' as const] : [])
  ]);
  const detectedIngredients: CreativeIngredientType[] = uniqueIngredients([
    ...(hasProductCue ? ['product_closeup_trait' as const] : []),
    ...(hasBenefitCue ? ['lifestyle_context' as const, 'premium_visual' as const] : ['clean_background' as const]),
    ...(hasUsageCue ? ['hand_demo' as const] : [])
  ]);
  const visualStyleTags: VisualStyleTag[] = uniqueStyleTags([
    ...(hasBenefitCue ? ['lifestyle_context' as const, 'premium_visual' as const] : ['clean_background' as const])
  ]);
  const motionPotential: AssetMotionPotential = {
    isStill: true,
    implicitMotion: hasBenefitCue || lower.includes('video') ? 'high' : 'medium',
    canSimulateMotion: hasBenefitCue ? ['zoom_in_on_splash', 'quick_push_in'] : ['crop_zoom', 'ken_burns_push_in'],
    canSimulateDurationMs: [800, 2400]
  };
  return {
    summary: buildSummary(detectedObjects, suitableSlots),
    detectedObjects,
    suitableSlots,
    detectedIngredients,
    visualStyleTags,
    visualContent: {
      primarySubject: detectedObjects[0] ?? 'product',
      subjectPosition: 'center_composition_fallback',
      negativeSpace: 'unknown',
      kinematicElements: detectedObjects.filter((object) => object.includes('splash') || object.includes('ice')),
      lighting: visualStyleTags.includes('premium_visual') ? 'high_contrast_studio_fallback' : 'clean_light_fallback',
      colorPalette: []
    },
    motionPotential,
    candidateSlotRoles: suitableSlots.map((role, index) => ({
      role,
      confidence: Number(Math.max(0.55, 0.82 - index * 0.06).toFixed(2)),
      caveat: 'Deterministic filename/profile inference.'
    }))
  };
}

function inferTextSemantic(text: string): SemanticFallback {
  const hasCta = /下单|购买|点击|立即|马上|来一瓶|带走|领取|咨询|入手/i.test(text);
  const hasTitle = /标题|hook|开头|第一句|吸引/i.test(text);
  const hasSellingPoint = /卖点|冰爽|解腻|香|大瓶|保温|便携|口感|优势|特点/i.test(text);
  const detectedObjects = unique([
    'text_copy',
    ...(hasCta ? ['cta_copy'] : []),
    ...(hasTitle ? ['title_copy'] : []),
    ...(hasSellingPoint ? ['selling_point_copy'] : []),
    ...(/字幕|包装|标题条|卡片/i.test(text) ? ['packaging_copy'] : [])
  ]);
  const suitableSlots = uniqueRoles([
    ...(hasTitle ? ['opening_attention' as const] : []),
    ...(hasSellingPoint ? ['benefit_visual' as const] : []),
    ...(hasCta ? ['cta_visual' as const] : []),
    'benefit_visual'
  ]);
  const detectedIngredients = uniqueIngredients([
    'trust_building',
    ...(hasSellingPoint ? ['product_closeup_trait' as const] : []),
    ...(hasCta ? ['social_proof' as const] : [])
  ]);
  const motionPotential: AssetMotionPotential = {
    isStill: true,
    implicitMotion: 'low',
    canSimulateMotion: ['type_on_caption', 'card_reveal'],
    canSimulateDurationMs: [800, 1800]
  };

  return {
    summary: 'Text brief with deterministic CTA/title/selling-point classification.',
    detectedObjects,
    suitableSlots,
    detectedIngredients,
    visualStyleTags: [],
    motionPotential,
    candidateSlotRoles: suitableSlots.map((role, index) => ({
      role,
      confidence: Number(Math.max(0.6, 0.88 - index * 0.08).toFixed(2)),
      caveat: 'Derived from text keywords.'
    }))
  };
}

function buildAnalysisProfile(input: {
  media: AssetMediaProfile;
  semantic: SemanticFallback;
  quality: AssetAnalysisProfile['quality'];
  fallbackUsed: boolean;
  warnings: string[];
  visualSegmentation?: VisualSegmentationProfile;
  videoSegments?: AssetVideoSegment[];
}): AssetAnalysisProfile {
  return {
    profileVersion: 'asset_analysis_v1',
    analyzedAt: ANALYZED_AT,
    source: 'deterministic',
    fallbackUsed: input.fallbackUsed,
    warnings: unique(input.warnings),
    media: input.media,
    semantic: {
      summary: input.semantic.summary,
      detectedObjects: input.semantic.detectedObjects,
      detectedIngredients: input.semantic.detectedIngredients,
      visualStyleTags: input.semantic.visualStyleTags,
      visualContent: input.semantic.visualContent,
      motionPotential: input.semantic.motionPotential
    },
    quality: input.quality,
    visualSegmentation: input.visualSegmentation,
    videoSegments: input.videoSegments,
    slotAffordance: {
      suitableSlots: input.semantic.suitableSlots,
      primaryRoles: input.semantic.candidateSlotRoles,
      missingRoles: (['opening_attention', 'product_closeup', 'usage_demo', 'benefit_visual', 'comparison', 'testimonial', 'cta_visual'] as ShotSlotRole[])
        .filter((role) => !input.semantic.suitableSlots.includes(role)),
      rationale: 'Deterministic analysis from file metadata, filename/text cues and safe fallback heuristics.'
    },
    editability: {
      canCropZoom: input.media.kind !== 'text',
      canUseAsBackground: input.media.kind !== 'text' && input.quality.overallScore >= 0.5,
      canLoop: input.media.kind === 'video',
      canExtendWithCards: true,
      suggestedEdits: input.media.kind === 'text'
        ? ['turn_into_caption_card', 'use_as_cta_copy']
        : input.media.kind === 'video'
          ? ['trim_to_highlight', 'sample_keyframes', 'add_caption_overlay']
          : ['crop_zoom', 'ken_burns_motion', 'add_caption_overlay']
    },
    safety: {
      status: 'passed',
      brandRisk: 'low',
      ipRisk: 'low',
      claimRisk: 'low',
      reasons: []
    },
    search: {
      tags: unique([
        input.media.kind,
        ...input.semantic.detectedObjects,
        ...input.semantic.detectedIngredients,
        ...input.semantic.visualStyleTags,
        ...input.semantic.suitableSlots
      ]),
      keywords: unique([
        input.semantic.summary,
        ...input.semantic.detectedObjects,
        ...input.semantic.suitableSlots
      ]),
      embeddingText: [
        input.semantic.summary,
        input.semantic.detectedObjects.join(' '),
        input.semantic.suitableSlots.join(' '),
        input.semantic.detectedIngredients.join(' ')
      ].filter(Boolean).join(' | ')
    }
  };
}

function buildVideoSegmentAssetCard(parent: AssetCard, segment: AssetVideoSegment, index: number): AssetCard {
  const parentAnalysis = parent.analysis!;
  const segmentMedia: AssetMediaProfile = {
    ...parentAnalysis.media,
    durationSec: segment.durationSec,
    keyframes: parentAnalysis.media.keyframes.filter((keyframe) => segment.keyframeIds.includes(keyframe.id))
  };
  const segmentAnalysis: AssetAnalysisProfile = {
    ...parentAnalysis,
    media: segmentMedia,
    semantic: {
      ...parentAnalysis.semantic,
      summary: segment.visualSummary
    },
    slotAffordance: {
      ...parentAnalysis.slotAffordance,
      suitableSlots: segment.roleHints,
      primaryRoles: segment.roleHints.map((role) => ({
        role,
        confidence: segment.confidence,
        caveat: 'Derived from long-video semantic segment slicing.'
      })),
      missingRoles: parentAnalysis.slotAffordance.missingRoles.filter((role) => !segment.roleHints.includes(role)),
      rationale: `${parentAnalysis.slotAffordance.rationale} Segment ${index + 1}: ${segment.label}.`
    },
    search: {
      ...parentAnalysis.search,
      tags: unique([...parentAnalysis.search.tags, ...segment.roleHints, ...segment.actionTags]),
      keywords: unique([...parentAnalysis.search.keywords, segment.label, segment.visualSummary, ...segment.actionTags]),
      embeddingText: `${parentAnalysis.search.embeddingText} | ${segment.label} | ${segment.visualSummary} | ${segment.actionTags.join(' ')}`
    },
    videoSegments: [segment]
  };

  return {
    ...parent,
    id: segment.id,
    spatialDescription: segment.visualSummary,
    temporalDescription: `Segment ${index + 1} of ${segment.parentAssetId}: ${segment.startSec}s-${segment.endSec}s. ${segment.label}`,
    suitableSlots: segment.roleHints,
    qualityScore: segment.qualityScore,
    candidateSlotRoles: segment.roleHints.map((role) => ({
      role,
      confidence: segment.confidence,
      caveat: 'Derived from long-video semantic segment slicing.'
    })),
    segmentSource: {
      parentAssetId: segment.parentAssetId,
      startSec: segment.startSec,
      endSec: segment.endSec,
      durationSec: segment.durationSec,
      segmentIndex: index,
      label: segment.label,
      visualSummary: segment.visualSummary,
      roleHints: segment.roleHints,
      actionTags: segment.actionTags,
      confidence: segment.confidence,
      source: segment.source,
      boundaryEvidence: segment.boundaryEvidence,
      warnings: segment.warnings ?? []
    },
    analysis: segmentAnalysis
  };
}

function classifyFileKind(filename: string): 'image' | 'video' {
  const ext = path.extname(filename).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.webm'].includes(ext)) return 'video';
  return 'image';
}

function buildSummary(objects: string[], slots: ShotSlotRole[]): string {
  return `Deterministic asset profile: ${objects.slice(0, 3).join(', ') || 'visual asset'}; suitable for ${slots.slice(0, 3).join(' / ')}.`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function uniqueRoles(values: ShotSlotRole[]): ShotSlotRole[] {
  return Array.from(new Set(values));
}

function uniqueIngredients(values: CreativeIngredientType[]): CreativeIngredientType[] {
  return Array.from(new Set(values));
}

function uniqueStyleTags(values: VisualStyleTag[]): VisualStyleTag[] {
  return Array.from(new Set(values));
}
