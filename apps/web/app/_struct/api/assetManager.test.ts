import assert from 'node:assert/strict';
import test from 'node:test';

import { SOURCE_VIDEO, TARGET_MATERIALS, TARGET_PRODUCT } from '../data';
import { buildStructAssetManagerRequest, mapStructRoleToShotSlotRole } from './assetManager';

test('buildStructAssetManagerRequest preserves source slots for Asset Manager coverage', () => {
  const request = buildStructAssetManagerRequest({
    sourceVideo: SOURCE_VIDEO,
    materials: TARGET_MATERIALS,
    product: TARGET_PRODUCT,
  });

  assert.equal(request.libraryId, 'struct_ui_input_assets');
  assert.equal(request.structureGraph.shotSlots.length, SOURCE_VIDEO.segments.length);
  assert.deepEqual(
    request.structureGraph.shotSlots.map((slot) => slot.id),
    SOURCE_VIDEO.segments.map((segment) => segment.id),
  );
  assert.equal(request.structureGraph.shotSlots[0].role, 'opening_attention');
  assert.equal(request.structureGraph.shotSlots[3].role, 'product_closeup');
  assert.equal(request.structureGraph.shotSlots[6].role, 'cta_visual');
});

test('buildStructAssetManagerRequest maps assigned materials into AssetCard evidence', () => {
  const request = buildStructAssetManagerRequest({
    sourceVideo: SOURCE_VIDEO,
    materials: TARGET_MATERIALS,
    product: TARGET_PRODUCT,
  });

  const productPhoto = request.assetCards.find((asset) => asset.id === 'm1');
  const titleText = request.assetCards.find((asset) => asset.id === 'm6');

  assert.equal(productPhoto?.type, 'image');
  assert.equal(productPhoto?.qualityScore, TARGET_MATERIALS[0].quality);
  assert.ok(productPhoto?.suitableSlots.includes('product_closeup'));
  assert.ok(productPhoto?.detectedObjects.includes('产品正面图'));
  assert.equal(titleText?.type, 'text');
  assert.ok(titleText?.suitableSlots.includes('benefit_visual'));
  assert.ok(titleText?.text?.includes('商品标题/卖点'));
});

test('mapStructRoleToShotSlotRole translates local roles into shared slot roles', () => {
  assert.equal(mapStructRoleToShotSlotRole('hook'), 'opening_attention');
  assert.equal(mapStructRoleToShotSlotRole('product'), 'product_closeup');
  assert.equal(mapStructRoleToShotSlotRole('compare'), 'comparison');
  assert.equal(mapStructRoleToShotSlotRole('social'), 'testimonial');
  assert.equal(mapStructRoleToShotSlotRole('cta'), 'cta_visual');
});
