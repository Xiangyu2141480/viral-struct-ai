import path from 'node:path';
import type {
  AssetAnalysisProfile,
  AssetCard,
  AssetCandidateSlotRole,
  AssetMediaProfile,
  AssetMotionPotential,
  AssetVisualContent,
  CreativeIngredientType,
  ShotSlotRole,
  VisualStyleTag
} from '@viral-struct/shared';
import { AssetCardSchema } from '@viral-struct/shared';
import { scoreAssetQuality } from './assetQualityScorer';
import { extractAssetKeyframes } from './keyframeExtractor';
import { probeImage, probeVideo } from './mediaProbeService';

const ANALYZED_AT = '1970-01-01T00:00:00.000Z';

export interface DeterministicAnalyzeOptions {
  files: Express.Multer.File[];
  textBrief?: string;
  ffprobePath?: string;
  ffmpegPath?: string;
  frameDir?: string;
}

export async function analyzeAssetsDeterministic(opts: DeterministicAnalyzeOptions): Promise<AssetCard[]> {
  const cards: AssetCard[] = [];

  for (let index = 0; index < opts.files.length; index++) {
    cards.push(await analyzeFileAsset(opts.files[index], index, opts));
  }

  if (opts.textBrief?.trim()) {
    cards.push(analyzeTextAsset(opts.textBrief.trim()));
  }

  return cards.map((card) => AssetCardSchema.parse(card));
}

async function analyzeFileAsset(file: Express.Multer.File, index: number, opts: DeterministicAnalyzeOptions): Promise<AssetCard> {
  const assetId = `asset_${(index + 1).toString().padStart(3, '0')}`;
  const fileKind = classifyFileKind(file.originalname);
  if (fileKind === 'video') {
    return analyzeVideoAsset(file, assetId, opts);
  }
  return analyzeImageAsset(file, assetId);
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

async function analyzeVideoAsset(file: Express.Multer.File, assetId: string, opts: DeterministicAnalyzeOptions): Promise<AssetCard> {
  const probe = await probeVideo(file.path, { ffprobePath: opts.ffprobePath, originalName: file.originalname });
  const frameResult = await extractAssetKeyframes({
    filePath: file.path,
    assetId,
    durationSec: probe.media.durationSec,
    frameDir: opts.frameDir,
    ffmpegPath: opts.ffmpegPath
  });
  const media: AssetMediaProfile = {
    ...probe.media,
    keyframes: frameResult.keyframes
  };
  const semantic = inferSemanticFromNameAndText(`${file.originalname} video motion usage demo`);
  const qualityResult = scoreAssetQuality(media, {
    hasProductCue: semantic.detectedObjects.includes('product') || semantic.detectedObjects.includes('beverage bottle')
  });
  const warnings = [...probe.warnings, ...frameResult.warnings, ...qualityResult.warnings];
  const fallbackUsed = probe.fallbackUsed || frameResult.fallbackUsed || qualityResult.warnings.length > 0;
  const qualityScore = qualityResult.quality.overallScore;
  const analysis = buildAnalysisProfile({
    media,
    semantic,
    quality: qualityResult.quality,
    fallbackUsed,
    warnings
  });

  return {
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
  const detectedObjects = unique([
    lower.includes('bottle') || lower.includes('tea') || lower.includes('drink') || lower.includes('product') || lower.includes('kangshifu') ? 'beverage bottle' : 'product',
    ...(lower.includes('ice') || lower.includes('splash') ? ['ice cubes', 'liquid splash'] : []),
    ...(lower.includes('lineup') || lower.includes('pack') ? ['product lineup'] : []),
    ...(lower.includes('hand') || lower.includes('usage') || lower.includes('demo') ? ['hand', 'usage scene'] : [])
  ]);
  const suitableSlots: ShotSlotRole[] = uniqueRoles([
    ...(lower.includes('splash') || lower.includes('ice') || lower.includes('hook') ? ['opening_attention' as const, 'benefit_visual' as const] : []),
    ...(lower.includes('usage') || lower.includes('demo') || lower.includes('hand') ? ['usage_demo' as const] : []),
    ...(lower.includes('compare') || lower.includes('comparison') || lower.includes('lineup') ? ['comparison' as const] : []),
    'product_closeup',
    'cta_visual'
  ]);
  const detectedIngredients: CreativeIngredientType[] = uniqueIngredients([
    'product_closeup_trait',
    ...(lower.includes('splash') || lower.includes('ice') ? ['lifestyle_context' as const, 'premium_visual' as const] : ['clean_background' as const]),
    ...(lower.includes('hand') || lower.includes('usage') ? ['hand_demo' as const] : [])
  ]);
  const visualStyleTags: VisualStyleTag[] = uniqueStyleTags([
    ...(lower.includes('splash') || lower.includes('ice') ? ['lifestyle_context' as const, 'premium_visual' as const] : ['clean_background' as const])
  ]);
  const motionPotential: AssetMotionPotential = {
    isStill: true,
    implicitMotion: lower.includes('splash') || lower.includes('ice') || lower.includes('video') ? 'high' : 'medium',
    canSimulateMotion: lower.includes('splash') ? ['zoom_in_on_splash', 'quick_push_in'] : ['crop_zoom', 'ken_burns_push_in'],
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
