import type { AssetCard } from '@viral-struct/shared';
import {
  analyzeAssetsWithAssetManager,
  type AssetManagerAnalyzeOptions,
  type AssetManagerAnalyzeResult
} from './assetManager/assetManagerService';

export interface AnalyzeOpts {
  files: Express.Multer.File[];
  textBrief?: string;
  ffprobePath?: string;
  ffmpegPath?: string;
  frameDir?: string;
  /** Optional override for tests; forwarded to the optional VLM enrichment. */
  clientFactory?: AssetManagerAnalyzeOptions['clientFactory'];
}

/**
 * Legacy filename-rule mock. Retained only as a last-resort fallback for the
 * upload/demo routes when deterministic local analysis throws (e.g. ffprobe
 * missing). Not a real analyzer — it classifies from the filename only.
 *
 * High-quality asset extraction lives in scripts/analyze_asset_library.py
 * (native-video multimodal). See docs/asset-card-extraction-pipeline.md.
 */
export async function analyzeAssetsMock(
  files: Express.Multer.File[],
  textBrief?: string
): Promise<AssetCard[]> {
  const cards: AssetCard[] = files.map((file, index) => {
    const lower = file.originalname.toLowerCase();
    const isVideo = lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm');
    const isHand = lower.includes('hand') || lower.includes('手');
    const hasPresenter = lower.includes('host') || lower.includes('presenter') || lower.includes('真人') || lower.includes('演示');
    const isSwatchOrTexture = lower.includes('makeup') || lower.includes('beauty') || lower.includes('swatch') || lower.includes('妆') || lower.includes('试色');
    const isBeforeAfter = lower.includes('before') || lower.includes('after') || lower.includes('对比');

    return {
      id: `asset_${index + 1}`,
      type: isVideo ? 'video' : 'image',
      url: file.path,
      spatialDescription: isHand
        ? '手持商品的静态画面，适合表现使用场景，但动作信息不足。'
        : '商品主体清晰，适合做商品特写和 CTA 视觉。',
      temporalDescription: isVideo
        ? '片段包含轻微镜头运动，可用于卖点展示。'
        : '静态图片，无真实动作过程。',
      detectedObjects: ['product'],
      suitableSlots: isHand
        ? ['product_closeup', 'usage_demo', 'cta_visual']
        : ['product_closeup', 'benefit_visual', 'cta_visual'],
      qualityScore: 0.82,
      detectedIngredients: [
        'product_closeup_trait',
        'clean_background',
        ...(isHand ? ['hand_demo' as const] : []),
        ...(hasPresenter ? ['human_presence' as const, 'host_talking' as const] : []),
        ...(isSwatchOrTexture ? ['swatch_demo' as const, 'texture_display' as const] : []),
        ...(isBeforeAfter ? ['before_after_comparison' as const] : [])
      ],
      humanPresence: {
        hasHuman: hasPresenter || isHand,
        role: hasPresenter ? 'host' : isHand ? 'hand_only' : 'unknown',
        framing: hasPresenter ? ['half_body'] : isHand ? ['hands'] : ['product_only'],
        actions: [
          ...(hasPresenter && isVideo ? ['talking' as const] : []),
          ...(isSwatchOrTexture && isVideo ? ['applying_product' as const, 'showing_result' as const] : []),
          ...(isHand ? ['holding_product' as const] : [])
        ]
      },
      visualStyleTags: ['clean_background'],
      analysisSource: 'mock_filename_rules'
    };
  });

  if (textBrief) {
    cards.push({
      id: 'asset_text_brief',
      type: 'text',
      text: textBrief,
      detectedObjects: [],
      suitableSlots: ['benefit_visual', 'cta_visual'],
      qualityScore: 0.75,
      detectedIngredients: ['trust_building'],
      humanPresence: {
        hasHuman: false,
        role: 'unknown',
        framing: [],
        actions: []
      },
      visualStyleTags: [],
      analysisSource: 'manual_text_brief'
    });
  }

  return cards;
}

/**
 * Convenience wrapper used by demo / upload routes: runs deterministic local
 * media/text analysis first so the asset manager does not depend on a VLM key.
 * The legacy filename mock remains as a controlled last-resort fallback.
 */
export async function analyzeAssetsWithFallback(opts: AnalyzeOpts): Promise<AssetCard[]> {
  return (await analyzeAssetsWithFallbackResult(opts)).assetCards;
}

export async function analyzeAssetsWithFallbackResult(opts: AnalyzeOpts): Promise<AssetManagerAnalyzeResult> {
  try {
    return await analyzeAssetsWithAssetManager(opts);
  } catch (err) {
    return {
      assetCards: await analyzeAssetsMock(opts.files, opts.textBrief),
      warnings: [`Deterministic asset analysis failed (${err instanceof Error ? err.message : String(err)}); using filename/text fallback.`],
      vlmStatus: 'fallback'
    };
  }
}
