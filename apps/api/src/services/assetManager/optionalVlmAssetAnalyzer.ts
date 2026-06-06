import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type {
  AssetCard,
  AssetManagerRole,
  AssetVlmAnalysisProfile,
  ContentBrief,
  ShotSlotRole
} from '@viral-struct/shared';
import { AssetCardSchema, AssetManagerRoleSchema } from '@viral-struct/shared';
import { createOpenAICompatibleClient } from '../llmProvider';

const OPTIONAL_VLM_SYSTEM_PROMPT = `You are an optional asset understanding adapter for a short-video structure migration system.

Your job is to describe visible evidence only. Do not invent product efficacy claims, medical claims, ranking claims, sales claims, celebrity identity, brand ownership, or user behavior. If evidence is uncertain, say so in risks.

Return strict JSON only.`;

const OPTIONAL_VLM_RESPONSE_SCHEMA = z.object({
  shortCaption: z.string().min(1),
  sceneType: z.string().min(1),
  productVisible: z.boolean(),
  productVisibilityScore: z.number().min(0).max(100),
  detectedObjects: z.array(z.string()),
  textVisible: z.boolean(),
  suggestedRoles: z.array(AssetManagerRoleSchema),
  rationale: z.string(),
  risks: z.array(z.string())
});

type OptionalVlmResponse = z.infer<typeof OPTIONAL_VLM_RESPONSE_SCHEMA>;
type Client = ReturnType<typeof createOpenAICompatibleClient>;

export interface OptionalVlmAssetAnalyzerOptions {
  assetCards: AssetCard[];
  contentBrief?: ContentBrief;
  enabled?: boolean;
  provider?: 'openai_compatible';
  model?: string;
  maxKeyframes?: number;
  clientFactory?: () => Client;
}

export interface OptionalVlmAssetAnalyzerResult {
  assetCards: AssetCard[];
  warnings: string[];
  vlmStatus: 'disabled' | 'enhanced' | 'fallback';
}

export async function enrichAssetsWithOptionalVlm(
  opts: OptionalVlmAssetAnalyzerOptions
): Promise<OptionalVlmAssetAnalyzerResult> {
  const enabled = opts.enabled ?? process.env.ASSET_VLM_ENABLED === 'true';
  if (!enabled) {
    return { assetCards: opts.assetCards, warnings: [], vlmStatus: 'disabled' };
  }

  const model = opts.model ?? process.env.ASSET_VLM_MODEL;
  if (!model) {
    return fallbackAll(opts.assetCards, 'Optional VLM analyzer enabled but ASSET_VLM_MODEL is empty.');
  }

  let client: Client;
  try {
    client = (opts.clientFactory ?? createOpenAICompatibleClient)();
  } catch (error) {
    return fallbackAll(opts.assetCards, `Optional VLM analyzer could not start: ${errorMessage(error)}`);
  }

  const warnings: string[] = [];
  const enriched: AssetCard[] = [];
  let enhancedCount = 0;
  const provider = opts.provider ?? parseProvider(process.env.ASSET_VLM_PROVIDER);

  for (const asset of opts.assetCards) {
    try {
      const vlm = await analyzeSingleAsset({
        asset,
        contentBrief: opts.contentBrief,
        client,
        model,
        provider,
        maxKeyframes: opts.maxKeyframes ?? parsePositiveInt(process.env.ASSET_VLM_MAX_KEYFRAMES, 5)
      });
      enriched.push(applyVlmProfile(asset, vlm));
      enhancedCount++;
    } catch (error) {
      const warning = `Optional VLM analyzer failed for ${asset.id}: ${errorMessage(error)}`;
      warnings.push(warning);
      enriched.push(addAssetWarning(asset, warning));
    }
  }

  return {
    assetCards: enriched,
    warnings,
    vlmStatus: enhancedCount > 0 ? 'enhanced' : 'fallback'
  };
}

async function analyzeSingleAsset(input: {
  asset: AssetCard;
  contentBrief?: ContentBrief;
  client: Client;
  model: string;
  provider: 'openai_compatible';
  maxKeyframes: number;
}): Promise<AssetVlmAnalysisProfile> {
  const prompt = buildVlmUserPrompt(input.asset, input.contentBrief, input.maxKeyframes);
  const content = [
    { type: 'text' as const, text: prompt },
    ...(await buildMediaContent(input.asset, input.maxKeyframes))
  ];

  const response = await input.client.chat.completions.create({
    model: input.model,
    messages: [
      { role: 'system', content: OPTIONAL_VLM_SYSTEM_PROMPT },
      { role: 'user', content }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  });

  const raw = response.choices[0]?.message?.content ?? '';
  const parsed = OPTIONAL_VLM_RESPONSE_SCHEMA.parse(JSON.parse(stripJsonFence(raw)));
  const claimWarnings = detectUnsupportedClaims(parsed);
  return {
    source: 'optional_vlm',
    provider: input.provider,
    model: input.model,
    analyzedAt: '1970-01-01T00:00:00.000Z',
    ...parsed,
    risks: uniqueStrings([...parsed.risks, ...claimWarnings])
  };
}

function buildVlmUserPrompt(asset: AssetCard, contentBrief: ContentBrief | undefined, maxKeyframes: number): string {
  return JSON.stringify({
    task: 'Optional VLM asset analysis for structure-aware Asset Manager.',
    safety: [
      'Describe visible evidence only.',
      'Do not invent product efficacy claims.',
      'Do not invent medical, ranking, sales, celebrity, or user behavior claims.',
      'Do not copy source video visual identity; focus on this asset only.'
    ],
    outputSchema: {
      shortCaption: 'string, one sentence visible caption',
      sceneType: 'string',
      productVisible: 'boolean',
      productVisibilityScore: '0..100',
      detectedObjects: ['string'],
      textVisible: 'boolean',
      suggestedRoles: [
        'opening_hook',
        'product_closeup',
        'usage_demo',
        'comparison',
        'benefit_proof',
        'lifestyle_scene',
        'background',
        'packaging_card',
        'cta',
        'cover'
      ],
      rationale: 'string, evidence-based role rationale',
      risks: ['string']
    },
    contentBrief: contentBrief
      ? {
          productName: contentBrief.productName,
          scenario: contentBrief.scenario,
          sellingPoints: contentBrief.sellingPoints,
          cta: contentBrief.cta
        }
      : undefined,
    asset: {
      id: asset.id,
      type: asset.type,
      text: asset.text,
      url: asset.url,
      deterministicSummary: asset.analysis?.semantic.summary ?? asset.spatialDescription ?? asset.temporalDescription,
      deterministicObjects: asset.detectedObjects,
      deterministicSlots: asset.suitableSlots,
      keyframes: (asset.analysis?.media.keyframes ?? []).slice(0, maxKeyframes).map((keyframe) => ({
        id: keyframe.id,
        url: keyframe.url,
        description: keyframe.description
      }))
    }
  }, null, 2);
}

async function buildMediaContent(asset: AssetCard, maxKeyframes: number): Promise<Array<{ type: 'image_url'; image_url: { url: string } }>> {
  const urls = [
    asset.type === 'image' ? asset.url : undefined,
    ...(asset.analysis?.media.keyframes ?? []).slice(0, maxKeyframes).map((keyframe) => keyframe.url)
  ].filter((url): url is string => Boolean(url));

  const blocks: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
  for (const url of urls.slice(0, maxKeyframes)) {
    const imageUrl = await resolveImageUrl(url);
    if (imageUrl) {
      blocks.push({ type: 'image_url', image_url: { url: imageUrl } });
    }
  }
  return blocks;
}

async function resolveImageUrl(url: string): Promise<string | undefined> {
  if (/^(https?:|data:image\/)/i.test(url)) return url;
  if (!isSupportedImagePath(url)) return undefined;
  try {
    await access(url);
    const buffer = await readFile(url);
    return `data:${mimeFromPath(url)};base64,${buffer.toString('base64')}`;
  } catch {
    return undefined;
  }
}

function applyVlmProfile(asset: AssetCard, vlm: AssetVlmAnalysisProfile): AssetCard {
  const analysis = asset.analysis;
  if (!analysis) return AssetCardSchema.parse(asset);

  const claimWarnings = detectUnsupportedClaims(vlm);
  const summary = claimWarnings.length ? analysis.semantic.summary : vlm.shortCaption;
  const mappedSlots = vlm.suggestedRoles.flatMap(mapAssetManagerRoleToShotSlotRole);
  const enriched: AssetCard = {
    ...asset,
    detectedObjects: uniqueStrings([...asset.detectedObjects, ...vlm.detectedObjects]),
    suitableSlots: uniqueRoles([...asset.suitableSlots, ...mappedSlots]),
    analysis: {
      ...analysis,
      warnings: uniqueStrings([...analysis.warnings, ...claimWarnings]),
      semantic: {
        ...analysis.semantic,
        summary,
        detectedObjects: uniqueStrings([...analysis.semantic.detectedObjects, ...vlm.detectedObjects])
      },
      quality: {
        ...analysis.quality,
        productFocus: Math.max(analysis.quality.productFocus, Number((vlm.productVisibilityScore / 100).toFixed(3))),
        subjectProminence: Math.max(analysis.quality.subjectProminence, Number((vlm.productVisibilityScore / 100).toFixed(3)))
      },
      slotAffordance: {
        ...analysis.slotAffordance,
        suitableSlots: uniqueRoles([...analysis.slotAffordance.suitableSlots, ...mappedSlots]),
        rationale: `${analysis.slotAffordance.rationale} Optional VLM evidence: ${vlm.rationale}`
      },
      search: {
        ...analysis.search,
        tags: uniqueStrings([...analysis.search.tags, ...vlm.detectedObjects, ...vlm.suggestedRoles]),
        keywords: uniqueStrings([...analysis.search.keywords, vlm.shortCaption, vlm.sceneType, vlm.rationale]),
        embeddingText: `${analysis.search.embeddingText} | ${vlm.shortCaption} | ${vlm.sceneType} | ${vlm.rationale}`
      },
      vlm: {
        ...vlm,
        risks: uniqueStrings([...vlm.risks, ...claimWarnings])
      }
    }
  };
  return AssetCardSchema.parse(enriched);
}

function fallbackAll(assetCards: AssetCard[], warning: string): OptionalVlmAssetAnalyzerResult {
  return {
    assetCards: assetCards.map((asset) => addAssetWarning(asset, warning)),
    warnings: [warning],
    vlmStatus: 'fallback'
  };
}

function addAssetWarning(asset: AssetCard, warning: string): AssetCard {
  if (!asset.analysis) return asset;
  return AssetCardSchema.parse({
    ...asset,
    analysis: {
      ...asset.analysis,
      warnings: uniqueStrings([...asset.analysis.warnings, warning]),
      fallbackUsed: true
    }
  });
}

function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  }
  return trimmed;
}

function detectUnsupportedClaims(value: OptionalVlmResponse | AssetVlmAnalysisProfile): string[] {
  const text = [
    value.shortCaption,
    value.rationale,
    ...value.risks
  ].join(' ');
  const unsafePatterns = [/100%/, /guarantee/i, /cure/i, /best/i, /销量第一/, /第一/, /最好/, /保证/, /治愈/, /立刻见效/];
  return unsafePatterns.some((pattern) => pattern.test(text))
    ? ['Optional VLM output contained unsupported product/efficacy claim language; semantic caption was not used as product proof.']
    : [];
}

function mapAssetManagerRoleToShotSlotRole(role: AssetManagerRole): ShotSlotRole[] {
  const map: Record<AssetManagerRole, ShotSlotRole[]> = {
    opening_hook: ['opening_attention'],
    product_closeup: ['product_closeup'],
    usage_demo: ['usage_demo'],
    comparison: ['comparison'],
    benefit_proof: ['benefit_visual', 'testimonial'],
    lifestyle_scene: ['benefit_visual'],
    background: ['benefit_visual'],
    packaging_card: ['benefit_visual', 'cta_visual'],
    cta: ['cta_visual'],
    cover: ['opening_attention', 'cta_visual']
  };
  return map[role];
}

function isSupportedImagePath(filePath: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(filePath).toLowerCase());
}

function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseProvider(value: string | undefined): 'openai_compatible' {
  return value === 'openai_compatible' ? 'openai_compatible' : 'openai_compatible';
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function uniqueRoles(values: ShotSlotRole[]): ShotSlotRole[] {
  return Array.from(new Set(values));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
