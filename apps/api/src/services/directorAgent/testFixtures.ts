import type { AssetCard, ContentBrief, ViralStructureGraph } from '@viral-struct/shared';

/**
 * Shared fixtures for the Director Agent tests. Not a *.test.ts file, so the test runner glob
 * (`src/services/**\/*.test.ts`) never executes it directly.
 */

export function makeGraph(): ViralStructureGraph {
  return {
    meta: { duration: 9, aspectRatio: '9:16', videoType: 'ecommerce', style: 'high_click' },
    structureSummary: 'director agent fixture',
    segments: [
      { id: 'seg_hook', role: 'hook', start: 0, end: 3, duration: 3, purpose: 'hook', transferRule: '', importance: 5 },
      { id: 'seg_usage', role: 'usage', start: 3, end: 7, duration: 4, purpose: 'usage', transferRule: '', importance: 4 },
      { id: 'seg_cta', role: 'cta', start: 7, end: 9, duration: 2, purpose: 'cta', transferRule: '', importance: 4 }
    ],
    shotSlots: [
      {
        id: 'slot_open',
        segmentId: 'seg_hook',
        role: 'opening_attention',
        requiredAsset: { type: 'image', subject: 'high-energy opening' },
        fallbackStrategies: ['text_card'],
        importance: 5
      },
      {
        id: 'slot_usage',
        segmentId: 'seg_usage',
        role: 'usage_demo',
        requiredAsset: { type: 'video', subject: 'opening cap and drinking', motion: 'hand_operation' },
        fallbackStrategies: ['hand_demo'],
        importance: 4,
        intent: {
          purpose: 'show the product being used naturally',
          energyLevel: 'medium',
          motionPattern: 'open cap, drink',
          compositionPrincipal: 'hand-only usage',
          durationMs: [2000, 4000]
        }
      },
      {
        id: 'slot_cta',
        segmentId: 'seg_cta',
        role: 'cta_visual',
        requiredAsset: { type: 'image', subject: 'clean CTA ending frame' },
        fallbackStrategies: ['cta_card'],
        importance: 4
      }
    ],
    rhythm: { avgShotDuration: 3, cutFrequency: 'medium', pattern: 'avg_3s_medium_cut' },
    packaging: {
      captionDensity: 'low',
      captionPosition: 'mixed',
      titleStyle: 'minimal_clean',
      cardTypes: [],
      transitions: ['hard_cut'],
      coverStyle: 'product_centered_clean_background'
    },
    creativeIngredients: [],
    edges: []
  };
}

export function makeAssets(): AssetCard[] {
  return [
    {
      id: 'asset_open',
      type: 'image',
      url: '/open.png',
      detectedObjects: ['product', 'bottle'],
      suitableSlots: ['opening_attention'],
      qualityScore: 0.7
    },
    {
      id: 'asset_usage',
      type: 'video',
      url: '/usage.mp4',
      detectedObjects: ['product', 'hand'],
      suitableSlots: ['usage_demo'],
      qualityScore: 0.6
    }
  ];
}

export function makeContentBrief(): ContentBrief {
  return {
    productName: '康师傅冰红茶',
    targetAudience: 'young office workers',
    scenario: 'summer refreshment',
    sellingPoints: ['冰爽解渴', '柠檬红茶'],
    cta: '立即尝鲜',
    category: 'beverage'
  };
}

// --- mock LLM judge ---------------------------------------------------------

export interface FakeAlignment {
  assetId: string | null;
  quality: number;
  matchedCriteria?: string[];
  missing?: string;
  treatmentSpec?: { motion?: string | null; durationMs?: number | null; syncPoint?: string | null; captionOverlay?: string | null };
}

export function makeFakeClient(alignments: Record<string, FakeAlignment>) {
  const payload: Record<string, unknown> = {};
  for (const [slotId, alignment] of Object.entries(alignments)) {
    payload[slotId] = {
      assetId: alignment.assetId,
      quality: alignment.quality,
      matchedCriteria: alignment.matchedCriteria ?? [],
      missing: alignment.missing ?? '',
      treatmentSpec: alignment.treatmentSpec ?? { motion: null, durationMs: null, syncPoint: null, captionOverlay: null }
    };
  }
  const responseJson = JSON.stringify(payload);
  return () =>
    ({
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: responseJson } }] })
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
}
