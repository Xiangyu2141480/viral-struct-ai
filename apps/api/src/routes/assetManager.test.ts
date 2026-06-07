import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import type { ContentBrief, ViralStructureGraph } from '@viral-struct/shared';
import { AssetSupplyContextSchema } from '@viral-struct/shared';
import { loadAssetLibrary } from '../services/assetLibraryLoader';
import { assetManagerRouter } from './assetManager';

let server: Server;
let baseUrl = '';

const brief: ContentBrief = {
  productName: '康师傅冰红茶',
  targetAudience: '夏日饮料用户',
  scenario: '午后高温',
  sellingPoints: ['冰爽解腻', '柠檬茶香'],
  cta: '来一瓶康师傅冰红茶。'
};

const structureGraph: ViralStructureGraph = {
  meta: {
    duration: 8,
    aspectRatio: '9:16',
    videoType: 'ecommerce',
    style: 'high_click'
  },
  structureSummary: 'Product closeup plus usage proof.',
  segments: [
    {
      id: 'seg_product',
      role: 'selling_point',
      start: 0,
      end: 3,
      duration: 3,
      purpose: '商品确认',
      transferRule: '迁移商品近景',
      importance: 5
    },
    {
      id: 'seg_usage',
      role: 'usage',
      start: 3,
      end: 8,
      duration: 5,
      purpose: '使用证明',
      transferRule: '迁移使用过程',
      importance: 4
    }
  ],
  shotSlots: [
    {
      id: 'slot_product',
      segmentId: 'seg_product',
      role: 'product_closeup',
      requiredAsset: { type: 'image', subject: '瓶身和标签', camera: 'closeup', motion: 'static' },
      visualIngredientRequirements: ['product_closeup_trait', 'clean_background'],
      fallbackStrategies: ['crop_zoom'],
      importance: 5
    },
    {
      id: 'slot_usage',
      segmentId: 'seg_usage',
      role: 'usage_demo',
      requiredAsset: { type: 'video', subject: '手持饮用', camera: 'medium', motion: 'hand_operation' },
      visualIngredientRequirements: ['hand_demo'],
      humanRequirement: { required: true, framing: 'hands', action: 'holding_product' },
      fallbackStrategies: ['ask_user_for_human_demo'],
      importance: 4
    }
  ],
  rhythm: { avgShotDuration: 2, cutFrequency: 'medium', pattern: 'simple proof' },
  packaging: {
    captionDensity: 'medium',
    captionPosition: 'bottom_center',
    titleStyle: 'bold',
    cardTypes: ['selling_point_card'],
    transitions: ['quick_cut'],
    coverStyle: 'product'
  },
  creativeIngredients: [],
  edges: []
};

before(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/assets/manager', assetManagerRouter);

  await new Promise<void>((resolveServer) => {
    server = app.listen(0, () => {
      const address = server.address();
      assert.notEqual(address, null);
      assert.notEqual(typeof address, 'string');
      baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolveServer();
    });
  });
});

after(async () => {
  await new Promise<void>((resolveServer, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolveServer();
    });
  });
});

test('POST /api/assets/manager/coverage returns matrix, report, normalized assets and warnings', async () => {
  const assetCards = await loadAssetLibrary('kangshifu_demo');

  const response = await fetch(`${baseUrl}/api/assets/manager/coverage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structureGraph, assetCards, contentBrief: brief })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.matrix.slotRows.length, 2);
  assert.equal(body.matrix.slotRows[0].slotId, 'slot_product');
  assert.equal(body.report.roleCoverage.product_closeup.status, 'covered');
  assert.equal(body.report.roleCoverage.usage_demo.status !== 'covered', true);
  assert.equal(body.assetCards.length, 3);
  assert.equal(body.assetCards.every((asset: { analysis?: unknown }) => Boolean(asset.analysis)), true);
  assert.ok(Array.isArray(body.warnings));
});

test('POST /api/assets/manager/analyze-batch normalizes legacy cards and returns a report', async () => {
  const assetCards = await loadAssetLibrary('kangshifu_demo');

  const response = await fetch(`${baseUrl}/api/assets/manager/analyze-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetCards, contentBrief: brief, libraryId: 'kangshifu_demo' })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.protocolVersion, 'asset-manager-v1');
  assert.equal(body.assetCards.length, 3);
  assert.equal(body.report.libraryId, 'kangshifu_demo');
  assert.ok(body.assetCards.every((asset: { analysis?: unknown }) => Boolean(asset.analysis)));
});

test('POST /api/assets/manager/asset-supply-context returns contextual coverage observations without fallback cards', async () => {
  const assetCards = await loadAssetLibrary('kangshifu_demo');

  const response = await fetch(`${baseUrl}/api/assets/manager/asset-supply-context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structureGraph,
      assetCards,
      contentBrief: brief,
      libraryId: 'kangshifu_demo'
    })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  const parsed = AssetSupplyContextSchema.parse(body.assetSupplyContext);
  assert.equal(parsed.protocolVersion, 'asset-supply-v1');
  assert.equal(parsed.libraryId, 'kangshifu_demo');
  assert.equal(parsed.contextualCoverage?.slotCoverages.length, 2);
  assert.ok(parsed.contextualCoverage?.slotCoverages.some((row) => row.coverageStatus === 'covered'));
  assert.ok(parsed.contextualCoverage?.slotCoverages.some((row) => row.coverageStatus === 'insufficient'));
  assert.ok(parsed.contextualCoverage?.observations.some((observation) => observation.ownership === 'asset_manager_observation_only'));
  assert.ok(parsed.materialScenario);
  assert.equal(parsed.materialScenario?.evidenceCoverageScore, parsed.contextualCoverage?.coverageSummary.coverageScore);
  assert.ok((parsed.missingMaterialBriefs?.length ?? 0) > 0);
  assert.ok(parsed.missingMaterialBriefs?.every((briefItem) => briefItem.ownership === 'asset_manager_handoff_brief_only'));
  assert.ok(parsed.missingMaterialBriefs?.some((briefItem) => briefItem.aigcGenerationBrief?.negativePrompt.includes('no watermark')));
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'fallbackCards'), false);
  assert.equal(JSON.stringify(parsed).includes('suggestedRepair'), false);
});

test('legacy video-agent-bundle route returns asset-supply-v1 response without Asset Manager-owned repair strategy', async () => {
  const assetCards = await loadAssetLibrary('kangshifu_demo');

  const response = await fetch(`${baseUrl}/api/assets/manager/video-agent-bundle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structureGraph, assetCards, contentBrief: brief, libraryId: 'kangshifu_demo' })
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  const parsed = AssetSupplyContextSchema.parse(body.assetSupplyContext);
  assert.equal(parsed.protocolVersion, 'asset-supply-v1');
  assert.equal(body.deprecatedRoute, true);
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'fallbackCards'), false);
});
