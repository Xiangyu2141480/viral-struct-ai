import { Router } from 'express';
import { z } from 'zod';
import {
  AssetCardSchema,
  ContentBriefSchema,
  ViralStructureGraphSchema
} from '@viral-struct/shared';
import { analyzeAssetCoverage } from '../services/assetManager/assetCoverageAnalyzer';
import { buildAssetSupplyContext } from '../services/assetManager/assetSupplyContextBuilder';

export const assetManagerRouter = Router();

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
  libraryId: z.string().optional()
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

assetManagerRouter.post('/coverage', (req, res) => {
  try {
    const body = CoverageRequestSchema.parse(req.body ?? {});
    const result = analyzeAssetCoverage({
      structureGraph: body.structureGraph,
      assetCards: body.assetCards,
      contentBrief: body.contentBrief,
      libraryId: body.libraryId
    });
    const supplyContext = buildAssetSupplyContext({
      structureGraph: body.structureGraph,
      assetCards: body.assetCards,
      contentBrief: body.contentBrief,
      libraryId: body.libraryId
    });
    res.json({
      ...result,
      contextualCoverage: supplyContext.contextualCoverage,
      assetSupplyContext: supplyContext,
      warnings: Array.from(new Set([...result.warnings, ...supplyContext.warnings]))
    });
  } catch (error) {
    res.status(400).json({
      error: `Asset coverage analysis failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

assetManagerRouter.post('/asset-supply-context', (req, res) => {
  try {
    const body = AssetSupplyContextRequestSchema.parse(req.body ?? {});
    const assetSupplyContext = buildAssetSupplyContext({
      structureGraph: body.structureGraph,
      assetCards: body.assetCards,
      contentBrief: body.contentBrief,
      libraryId: body.libraryId
    });
    res.json({
      assetSupplyContext,
      warnings: assetSupplyContext.warnings
    });
  } catch (error) {
    res.status(400).json({
      error: `Asset supply context failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

assetManagerRouter.post('/video-agent-bundle', (req, res) => {
  try {
    const body = AssetSupplyContextRequestSchema.parse(req.body ?? {});
    const assetSupplyContext = buildAssetSupplyContext({
      structureGraph: body.structureGraph,
      assetCards: body.assetCards,
      contentBrief: body.contentBrief,
      libraryId: body.libraryId
    });
    res.json({
      assetSupplyContext,
      warnings: assetSupplyContext.warnings,
      deprecatedRoute: true,
      message: 'Legacy route name; response uses asset-supply-v1. Asset Manager does not produce fallback cards or repair strategies.'
    });
  } catch (error) {
    res.status(400).json({
      error: `Asset supply context failed: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});
