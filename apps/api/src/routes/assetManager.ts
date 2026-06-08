import { Router } from 'express';
import { z } from 'zod';
import {
  AssetCardSchema,
  ContentBriefSchema,
  ViralStructureGraphSchema
} from '@viral-struct/shared';
import type { AssetCard, ContentBrief } from '@viral-struct/shared';
import { analyzeAssetCoverage } from '../services/assetManager/assetCoverageAnalyzer';
import { buildAssetSupplyContext } from '../services/assetManager/assetSupplyContextBuilder';
import { generateCategoryPreset, type CategoryPreset } from '../services/motifs/categoryPresetProvider';

export const assetManagerRouter = Router();

/**
 * Asset-parse stage (decision D2): resolve the target category — user-supplied
 * `contentBrief.category` is authoritative, otherwise inferred from productName —
 * and generate the category preset once, grounded in the real available assets.
 * Falls back to a deterministic preset without a key / on LLM failure, so the
 * route never breaks. Returns undefined when there is no brief to anchor on.
 */
async function resolveCategoryPreset(
  contentBrief: ContentBrief | undefined,
  assetCards: AssetCard[]
): Promise<{ preset: CategoryPreset; warnings: string[] } | undefined> {
  if (!contentBrief) return undefined;
  const category = contentBrief.category ?? contentBrief.productName;
  const result = await generateCategoryPreset({
    category,
    availableAssets: availableAssetLabels(assetCards)
  });
  return { preset: result.preset, warnings: result.warning ? [result.warning] : [] };
}

function availableAssetLabels(assetCards: AssetCard[]): string[] {
  return assetCards
    .map((card) => {
      const url = card.url;
      if (url) return url.split(/[\\/]/).pop() || url;
      return card.text ? `${card.id} (text)` : card.id;
    })
    .slice(0, 12);
}

const AnalyzeBatchRequestSchema = z.object({
  assetCards: z.array(AssetCardSchema).default([]),
  contentBrief: ContentBriefSchema.optional(),
  libraryId: z.string().optional(),
  options: z.object({
    includeKeyframes: z.boolean().optional(),
    maxKeyframes: z.number().int().min(0).max(10).optional()
  }).optional()
});

const CoverageRequestSchema = z.object({
  structureGraph: ViralStructureGraphSchema.optional(),
  assetCards: z.array(AssetCardSchema).default([]),
  contentBrief: ContentBriefSchema.optional(),
  libraryId: z.string().optional(),
  options: z.object({
    userCanGenerate: z.boolean().optional()
  }).optional()
});

const AssetSupplyContextRequestSchema = CoverageRequestSchema.passthrough();

assetManagerRouter.post('/analyze-batch', (req, res) => {
  try {
    const body = AnalyzeBatchRequestSchema.parse(req.body ?? {});
    const coverage = analyzeAssetCoverage({
      assetCards: body.assetCards,
      contentBrief: body.contentBrief,
      libraryId: body.libraryId
    });
    res.json({
      assetCards: coverage.assetCards,
      report: coverage.report,
      warnings: [
        ...coverage.warnings,
        'analyze-batch currently normalizes existing AssetCard objects and computes deterministic role-level coverage.'
      ],
      source: 'deterministic_asset_manager',
      protocolVersion: 'asset-manager-v1'
    });
  } catch (error) {
    res.status(400).json({
      error: `Asset batch analysis failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

assetManagerRouter.post('/coverage', async (req, res) => {
  try {
    const body = CoverageRequestSchema.parse(req.body ?? {});
    const result = analyzeAssetCoverage({
      structureGraph: body.structureGraph,
      assetCards: body.assetCards,
      contentBrief: body.contentBrief,
      libraryId: body.libraryId
    });
    const category = await resolveCategoryPreset(body.contentBrief, body.assetCards);
    const supplyContext = buildAssetSupplyContext({
      structureGraph: body.structureGraph,
      assetCards: body.assetCards,
      contentBrief: body.contentBrief,
      libraryId: body.libraryId,
      options: body.options,
      categoryPreset: category?.preset
    });
    res.json({
      ...result,
      contextualCoverage: supplyContext.contextualCoverage,
      assetSupplyContext: supplyContext,
      warnings: Array.from(new Set([...result.warnings, ...supplyContext.warnings, ...(category?.warnings ?? [])]))
    });
  } catch (error) {
    res.status(400).json({
      error: `Asset coverage analysis failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

assetManagerRouter.post('/asset-supply-context', async (req, res) => {
  try {
    const body = AssetSupplyContextRequestSchema.parse(req.body ?? {});
    const category = await resolveCategoryPreset(body.contentBrief, body.assetCards);
    const assetSupplyContext = buildAssetSupplyContext({
      structureGraph: body.structureGraph,
      assetCards: body.assetCards,
      contentBrief: body.contentBrief,
      libraryId: body.libraryId,
      options: body.options,
      categoryPreset: category?.preset
    });
    res.json({
      assetSupplyContext,
      warnings: Array.from(new Set([...assetSupplyContext.warnings, ...(category?.warnings ?? [])]))
    });
  } catch (error) {
    res.status(400).json({
      error: `Asset supply context failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

assetManagerRouter.post('/video-agent-bundle', async (req, res) => {
  try {
    const body = AssetSupplyContextRequestSchema.parse(req.body ?? {});
    const category = await resolveCategoryPreset(body.contentBrief, body.assetCards);
    const assetSupplyContext = buildAssetSupplyContext({
      structureGraph: body.structureGraph,
      assetCards: body.assetCards,
      contentBrief: body.contentBrief,
      libraryId: body.libraryId,
      options: body.options,
      categoryPreset: category?.preset
    });
    res.json({
      assetSupplyContext,
      warnings: Array.from(new Set([...assetSupplyContext.warnings, ...(category?.warnings ?? [])])),
      deprecatedRoute: true,
      message: 'Legacy route name; response uses asset-supply-v1. Asset Manager does not produce fallback cards or repair strategies.'
    });
  } catch (error) {
    res.status(400).json({
      error: `Asset supply context failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});
