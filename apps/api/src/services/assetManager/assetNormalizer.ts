import path from 'node:path';
import type {
  AssetAnalysisProfile,
  AssetCard,
  AssetCandidateSlotRole,
  AssetIssue,
  ShotSlotRole
} from '@viral-struct/shared';
import { AssetCardSchema } from '@viral-struct/shared';

const DEFAULT_ANALYZED_AT = '1970-01-01T00:00:00.000Z';
const ALL_SLOT_ROLES: ShotSlotRole[] = [
  'opening_attention',
  'product_closeup',
  'usage_demo',
  'benefit_visual',
  'comparison',
  'testimonial',
  'cta_visual'
];

export function normalizeAssetCard(card: AssetCard): AssetCard {
  const defaults = buildDefaultAnalysis(card);
  const existing = card.analysis;
  const normalized: AssetCard = {
    ...card,
    analysis: existing
      ? {
          ...defaults,
          ...existing,
          media: { ...defaults.media, ...existing.media },
          semantic: { ...defaults.semantic, ...existing.semantic },
          quality: { ...defaults.quality, ...existing.quality },
          slotAffordance: { ...defaults.slotAffordance, ...existing.slotAffordance },
          editability: { ...defaults.editability, ...existing.editability },
          safety: { ...defaults.safety, ...existing.safety },
          search: { ...defaults.search, ...existing.search }
        }
      : defaults
  };

  return AssetCardSchema.parse(normalized);
}

export function normalizeAssetCards(cards: AssetCard[]): AssetCard[] {
  return cards.map(normalizeAssetCard);
}

function buildDefaultAnalysis(card: AssetCard): AssetAnalysisProfile {
  const issues = buildIssues(card);
  return {
    profileVersion: 'asset_analysis_v1',
    analyzedAt: DEFAULT_ANALYZED_AT,
    source: card.analysisSource,
    fallbackUsed: card.analysisSource !== 'llm_multimodal',
    warnings: [],
    media: {
      kind: card.type,
      sourceUrl: card.url,
      textLength: card.text?.length,
      keyframes: [],
      fileExtension: card.url ? path.extname(card.url).replace('.', '').toLowerCase() || undefined : undefined
    },
    semantic: {
      summary: card.spatialDescription ?? card.temporalDescription ?? card.text ?? `${card.type} asset`,
      detectedObjects: card.detectedObjects,
      detectedIngredients: card.detectedIngredients ?? [],
      visualStyleTags: card.visualStyleTags ?? [],
      humanPresence: card.humanPresence,
      visualContent: card.visualContent,
      motionPotential: card.motionPotential
    },
    quality: {
      overallScore: clamp01(card.qualityScore),
      resolution: clamp01(card.qualityScore),
      sharpness: clamp01(card.qualityScore),
      brightness: clamp01(card.qualityScore),
      contrast: clamp01(card.qualityScore),
      clarity: clamp01(card.qualityScore),
      composition: clamp01(card.qualityScore),
      lighting: clamp01(card.qualityScore),
      subjectProminence: clamp01(card.qualityScore),
      productFocus: clamp01(card.qualityScore),
      textSafeArea: 0.7,
      formatFit: card.type === 'text' ? 0.86 : 0.78,
      issues
    },
    slotAffordance: {
      suitableSlots: card.suitableSlots,
      primaryRoles: buildPrimaryRoles(card),
      missingRoles: ALL_SLOT_ROLES.filter((role) => !card.suitableSlots.includes(role)),
      rationale: buildAffordanceRationale(card)
    },
    editability: {
      canCropZoom: card.type === 'image' || card.type === 'video',
      canUseAsBackground: card.type !== 'text' && card.qualityScore >= 0.6,
      canLoop: card.type === 'video',
      canExtendWithCards: true,
      suggestedEdits: buildSuggestedEdits(card)
    },
    safety: {
      status: 'passed',
      brandRisk: 'low',
      ipRisk: 'low',
      claimRisk: 'low',
      reasons: []
    },
    search: {
      tags: uniqueStrings([
        card.type,
        ...card.detectedObjects,
        ...(card.detectedIngredients ?? []),
        ...(card.visualStyleTags ?? []),
        ...card.suitableSlots
      ]),
      keywords: uniqueStrings([
        ...card.detectedObjects,
        ...(card.spatialDescription ? [card.spatialDescription] : []),
        ...(card.temporalDescription ? [card.temporalDescription] : []),
        ...(card.text ? [card.text] : [])
      ]),
      embeddingText: [
        card.spatialDescription,
        card.temporalDescription,
        card.text,
        card.detectedObjects.join(' '),
        card.suitableSlots.join(' ')
      ].filter(Boolean).join(' | ')
    }
  };
}

function buildPrimaryRoles(card: AssetCard): AssetCandidateSlotRole[] {
  if (card.candidateSlotRoles?.length) {
    return card.candidateSlotRoles;
  }
  const confidence = clamp01(0.2 + card.qualityScore * 0.7);
  return card.suitableSlots.map((role) => ({ role, confidence }));
}

function buildIssues(card: AssetCard): AssetIssue[] {
  const issues: AssetIssue[] = [];
  if (!card.spatialDescription && !card.temporalDescription && !card.text) {
    issues.push({
      type: 'missing_metadata',
      severity: 'low',
      message: 'Asset has no human-readable visual or text description.'
    });
  }
  if (card.qualityScore < 0.5) {
    issues.push({
      type: 'low_quality',
      severity: 'medium',
      message: 'Asset quality score is below the recommended threshold.'
    });
  }
  if (card.type === 'video' && !card.temporalDescription) {
    issues.push({
      type: 'no_motion_evidence',
      severity: 'low',
      message: 'Video asset has no temporal description or sampled motion evidence yet.'
    });
  }
  return issues;
}

function buildAffordanceRationale(card: AssetCard): string {
  if (card.candidateSlotRoles?.length) {
    return 'Candidate slot roles came from the asset analysis profile.';
  }
  if (card.suitableSlots.length) {
    return `Derived from existing suitableSlots and qualityScore=${card.qualityScore.toFixed(2)}.`;
  }
  return 'No suitableSlots were provided; downstream matching should treat this asset as weak coverage.';
}

function buildSuggestedEdits(card: AssetCard): string[] {
  if (card.type === 'text') {
    return ['turn_into_caption_card', 'use_as_cta_copy'];
  }
  const edits = ['crop_zoom'];
  if (card.type === 'image') {
    edits.push('ken_burns_motion');
  }
  if (card.type === 'video') {
    edits.push('trim_to_highlight', 'loop_short_clip');
  }
  if (card.suitableSlots.includes('cta_visual')) {
    edits.push('add_cta_overlay');
  }
  return uniqueStrings(edits);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}
