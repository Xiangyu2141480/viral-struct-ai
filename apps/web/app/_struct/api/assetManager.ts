import type {
  AssetCard,
  AssetSupplyContext,
  ContentBrief,
  CreativeIngredientType,
  ShotSlotNode,
  ShotSlotRole,
  ViralStructureGraph,
} from '@viral-struct/shared';
import type { Material, RoleKey, SourceSegment, SourceVideo, TargetProduct } from '../data';
import { structPost } from './client';

export interface StructAssetManagerRequest {
  libraryId: string;
  structureGraph: ViralStructureGraph;
  assetCards: AssetCard[];
  contentBrief: ContentBrief;
}

export interface StructAssetManagerCoverageResponse {
  assetSupplyContext?: AssetSupplyContext;
  warnings?: string[];
}

export interface BuildStructAssetManagerRequestInput {
  sourceVideo: SourceVideo;
  materials: Material[];
  product: TargetProduct;
  contentBrief?: ContentBrief | null;
}

export function mapStructRoleToShotSlotRole(role: RoleKey): ShotSlotRole {
  const map: Record<RoleKey, ShotSlotRole> = {
    hook: 'opening_attention',
    pain: 'benefit_visual',
    emotion: 'usage_demo',
    product: 'product_closeup',
    compare: 'comparison',
    social: 'testimonial',
    cta: 'cta_visual',
  };
  return map[role];
}

export function buildStructAssetManagerRequest(input: BuildStructAssetManagerRequestInput): StructAssetManagerRequest {
  const contentBrief = input.contentBrief ?? buildContentBrief(input.product, input.sourceVideo);
  return {
    libraryId: 'struct_ui_input_assets',
    structureGraph: buildStructureGraph(input.sourceVideo),
    assetCards: input.materials.map((material) => materialToAssetCard(material, input.sourceVideo, input.product)),
    contentBrief,
  };
}

export async function analyzeStructAssetManagerCoverage(
  input: BuildStructAssetManagerRequestInput,
): Promise<StructAssetManagerCoverageResponse> {
  return structPost<StructAssetManagerCoverageResponse>('/api/assets/manager/coverage', buildStructAssetManagerRequest(input));
}

function buildContentBrief(product: TargetProduct, sourceVideo: SourceVideo): ContentBrief {
  const sellingPoints =
    Array.isArray(product.sellingPoints) && product.sellingPoints.length
      ? product.sellingPoints
      : [
          product.category,
          product.price,
          product.industry,
          product.stock > 0 ? `${product.stock.toLocaleString()} 件库存可用于限时转化` : '',
        ].filter(Boolean);

  return {
    productName: product.name,
    targetAudience: product.industry,
    scenario: product.category,
    sellingPoints,
    cta: product.cta?.trim() || `${product.name} · 立即了解`,
    stylePreference: product.stylePreference?.trim() || `${sourceVideo.packaging.captions} · ${sourceVideo.packaging.cover}`,
  };
}

function buildStructureGraph(sourceVideo: SourceVideo): ViralStructureGraph {
  return {
    schemaVersion: 'v1',
    meta: {
      duration: sourceVideo.duration,
      aspectRatio: '9:16',
      videoType: 'ecommerce',
      style: 'high_conversion',
    },
    structureSummary: `${sourceVideo.title} · ${sourceVideo.protocol_version}`,
    segments: sourceVideo.segments.map((segment) => ({
      id: segment.id,
      role: mapSegmentRole(segment.role),
      start: segment.start,
      end: segment.end,
      duration: round01(segment.end - segment.start),
      purpose: segment.label,
      caption: segment.caption,
      transferRule: segment.shot,
      importance: importanceForRole(segment.role),
    })),
    shotSlots: sourceVideo.segments.map(segmentToShotSlot),
    rhythm: {
      avgShotDuration: sourceVideo.rhythm.avg_shot,
      cutFrequency: sourceVideo.rhythm.cuts >= 16 ? 'high' : sourceVideo.rhythm.cuts >= 9 ? 'medium' : 'low',
      peakAt: sourceVideo.segments[0]?.end,
      pattern: `${sourceVideo.rhythm.hook_density} hook density · ${sourceVideo.rhythm.bgm_bpm} BPM`,
    },
    packaging: {
      captionDensity: sourceVideo.rhythm.caption_density === '高' ? 'high' : 'medium',
      captionPosition: 'bottom_center',
      titleStyle: sourceVideo.packaging.title_template,
      cardTypes: ['hook_title', 'benefit_card', 'cta_card'],
      transitions: ['cut', 'fade'],
      coverStyle: sourceVideo.packaging.cover,
    },
    creativeIngredients: [],
    edges: sourceVideo.segments.slice(1).map((segment, index) => ({
      from: sourceVideo.segments[index].id,
      to: segment.id,
      type: 'sequence',
      explanation: 'Source StructMigrate segment order.',
    })),
  };
}

function segmentToShotSlot(segment: SourceSegment): ShotSlotNode {
  const role = mapStructRoleToShotSlotRole(segment.role);
  return {
    id: segment.id,
    segmentId: segment.id,
    role,
    requiredAsset: requiredAssetForSegment(segment, role),
    fallbackStrategies: fallbackStrategiesForRole(role),
    importance: importanceForRole(segment.role),
    intent: {
      purpose: segment.label,
      energyLevel: segment.role === 'hook' || segment.role === 'cta' ? 'high' : 'medium',
      motionPattern: motionForRole(segment.role),
      compositionPrincipal: segment.shot,
      durationMs: [Math.round((segment.end - segment.start) * 800), Math.round((segment.end - segment.start) * 1200)],
      soundDesignHint: 'Follow the source rhythm but migrate content, not product identity.',
    },
    sourceInstance: {
      productInSource: 'source video object',
      specificAction: segment.shot,
      colorSignature: 'derived from source packaging',
    },
    acceptanceCriteria: {
      anyOf: [{
        motionType: motionForRole(segment.role),
        compositionType: cameraForRole(segment.role),
        examples: [segment.shot, segment.caption],
      }],
      rejectIf: ['copies the source product literally', 'uses unrelated asset with no product or story evidence'],
    },
  };
}

function requiredAssetForSegment(segment: SourceSegment, role: ShotSlotRole): ShotSlotNode['requiredAsset'] {
  return {
    type: role === 'usage_demo' ? 'video' : role === 'benefit_visual' ? 'text' : 'image',
    subject: segment.shot,
    camera: cameraForRole(segment.role),
    motion: role === 'usage_demo' ? 'hand_operation' : motionForRole(segment.role),
    minDuration: round01(segment.end - segment.start),
  };
}

function fallbackStrategiesForRole(role: ShotSlotRole): ShotSlotNode['fallbackStrategies'] {
  if (role === 'cta_visual') return ['cta_card', 'text_card', 'reuse_asset'];
  if (role === 'product_closeup') return ['crop_zoom', 'product_closeup_replacement', 'selling_point_card'];
  if (role === 'usage_demo') return ['reuse_asset', 'caption_rewrite', 'aigc_background'];
  if (role === 'comparison') return ['comparison_card', 'text_card', 'reuse_asset'];
  return ['text_card', 'selling_point_card', 'reuse_asset'];
}

function materialToAssetCard(material: Material, sourceVideo: SourceVideo, product: TargetProduct): AssetCard {
  const assignedSegment = material.slot ? sourceVideo.segments.find((segment) => segment.id === material.slot) : undefined;
  const primaryRole = assignedSegment ? mapStructRoleToShotSlotRole(assignedSegment.role) : inferRoleFromMaterial(material);
  const suitableSlots = Array.from(new Set([primaryRole, inferRoleFromMaterial(material)].filter(Boolean))) as ShotSlotRole[];
  const description = [material.subject, assignedSegment?.label, product.name, product.category].filter(Boolean).join(' · ');
  // Mirror the server-side fix (structAdapter.ts materialToAssetCard): map all
  // three kinds, carry the real url, and re-emit clip provenance so the coverage
  // panel stays clip-aware.
  const cardType: AssetCard['type'] = material.kind === 'video' ? 'video' : material.kind === 'photo' ? 'image' : 'text';
  const isVisual = material.kind === 'photo' || material.kind === 'video';
  const card: AssetCard = {
    id: material.id,
    type: cardType,
    // Round-trip the real file/asset url so the coverage panel resolves real clips.
    url: material.url,
    text: material.kind === 'text' ? material.subject : undefined,
    spatialDescription: isVisual ? description : undefined,
    detectedObjects: tokenizeSubject(material.subject),
    suitableSlots,
    qualityScore: clamp01(material.quality),
    detectedIngredients: ingredientsForMaterial(material, primaryRole),
    visualStyleTags: isVisual ? ['clean_background', 'premium_visual'] : ['professional_review'],
    candidateSlotRoles: suitableSlots.map((role) => ({
      role,
      confidence: clamp01(material.quality),
      caveat: material.slot ? `User assigned to ${material.slot}.` : 'Inferred from StructMigrate material subject.',
    })),
    analysisSource: 'deterministic',
  };
  // Re-emit clip provenance when this Material was a sliced video segment, so the
  // Material → AssetCard round-trip preserves segmentSource (real-clip resolution).
  if (material.parentAssetId !== undefined && material.segmentIndex !== undefined) {
    card.segmentSource = {
      parentAssetId: material.parentAssetId,
      startSec: material.startSec ?? 0,
      endSec: material.endSec ?? material.startSec ?? 0,
      durationSec: material.durationSec ?? Math.max(0, (material.endSec ?? 0) - (material.startSec ?? 0)),
      segmentIndex: material.segmentIndex,
      label: material.label ?? material.subject,
      roleHints: (material.roleHints as ShotSlotRole[] | undefined) ?? suitableSlots,
      actionTags: [],
      source: material.source ?? 'deterministic',
    };
  }
  return card;
}

function inferRoleFromMaterial(material: Material): ShotSlotRole {
  const text = material.subject.toLowerCase();
  if (/cta|下单|购买|倒计时|礼盒|链接/.test(text)) return 'cta_visual';
  if (/证书|鉴定|评价|评分|买家|口碑|信任/.test(text)) return 'testimonial';
  if (/对比|价格|价值|同款|竞品/.test(text)) return 'comparison';
  if (/上手|佩戴|使用|过程|场景/.test(text)) return 'usage_demo';
  if (/特写|正面|产品|工艺|包装/.test(text)) return 'product_closeup';
  if (/标题|卖点|文案/.test(text)) return 'benefit_visual';
  return 'benefit_visual';
}

function ingredientsForMaterial(material: Material, role: ShotSlotRole): CreativeIngredientType[] {
  const ingredients = new Set<CreativeIngredientType>();
  if (role === 'product_closeup') ingredients.add('product_closeup_trait');
  if (role === 'usage_demo') ingredients.add('lifestyle_context');
  if (role === 'comparison') ingredients.add('before_after_comparison');
  if (role === 'testimonial') ingredients.add('social_proof');
  if (role === 'benefit_visual' || role === 'cta_visual') ingredients.add('trust_building');
  if (material.kind === 'text') ingredients.add('unknown');
  return Array.from(ingredients);
}

function tokenizeSubject(subject: string): string[] {
  const tokens = subject
    .split(/[\/\s·,，+]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
  return tokens.length ? tokens : [subject];
}

function mapSegmentRole(role: RoleKey): ViralStructureGraph['segments'][number]['role'] {
  const map: Record<RoleKey, ViralStructureGraph['segments'][number]['role']> = {
    hook: 'hook',
    pain: 'pain_point',
    emotion: 'usage',
    product: 'selling_point',
    compare: 'comparison',
    social: 'proof',
    cta: 'cta',
  };
  return map[role];
}

function cameraForRole(role: RoleKey): NonNullable<ShotSlotNode['requiredAsset']['camera']> {
  if (role === 'hook' || role === 'product') return 'closeup';
  if (role === 'emotion') return 'medium';
  if (role === 'compare' || role === 'social') return 'wide';
  if (role === 'pain') return 'macro';
  return 'unknown';
}

function motionForRole(role: RoleKey): NonNullable<ShotSlotNode['requiredAsset']['motion']> {
  if (role === 'hook') return 'fast_cut';
  if (role === 'emotion') return 'hand_operation';
  if (role === 'product') return 'push_in';
  if (role === 'cta') return 'static';
  return 'unknown';
}

function importanceForRole(role: RoleKey): 1 | 2 | 3 | 4 | 5 {
  if (role === 'hook' || role === 'product' || role === 'cta') return 5;
  if (role === 'pain' || role === 'social') return 4;
  return 3;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function round01(value: number): number {
  return Math.max(0, Number(value.toFixed(1)));
}
