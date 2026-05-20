import type { VideoAnalysis, ViralStructureGraph } from '@viral-struct/shared';
import { extractCreativeIngredientsMock } from './visualIngredientExtractor';

export async function extractStructureMock(
  videoAnalysis?: VideoAnalysis
): Promise<ViralStructureGraph> {
  const duration = videoAnalysis?.metadata.duration ?? 15;
  const creativeIngredients = extractCreativeIngredientsMock(videoAnalysis);

  return {
    meta: {
      duration,
      aspectRatio: '9:16',
      videoType: 'ecommerce',
      style: 'high_click'
    },
    structureSummary:
      '该样例采用「强 Hook → 痛点 → 核心卖点 → 对比证明 → CTA」的营销短视频结构，前 3 秒节奏快，后半段用卖点卡和对比卡提高转化。',
    segments: [
      {
        id: 'seg_hook',
        role: 'hook',
        start: 0,
        end: 2,
        duration: 2,
        purpose: '制造注意力和冲突',
        caption: '你还在这样选 XX？',
        transferRule: '替换为新商品的高频痛点或反常识问题。',
        importance: 5
      },
      {
        id: 'seg_pain',
        role: 'pain_point',
        start: 2,
        end: 4,
        duration: 2,
        purpose: '让用户意识到当前方案的问题',
        caption: '普通方案的问题',
        transferRule: '用新商品目标用户最常见的使用痛点展开。',
        importance: 4
      },
      {
        id: 'seg_sp1',
        role: 'selling_point',
        start: 4,
        end: 8,
        duration: 4,
        purpose: '展示核心卖点',
        caption: '核心功能 / 核心卖点',
        transferRule: '优先映射到新商品最能带来转化的卖点。',
        importance: 5
      },
      {
        id: 'seg_proof',
        role: 'comparison',
        start: 8,
        end: 12,
        duration: 4,
        purpose: '通过对比或证明增强可信度',
        caption: '对比证明',
        transferRule: '使用对比、数据卡或用户评价证明卖点。',
        importance: 4
      },
      {
        id: 'seg_cta',
        role: 'cta',
        start: 12,
        end: 15,
        duration: 3,
        purpose: '促成行动',
        caption: '立即行动',
        transferRule: '用新商品场景化 CTA 收束。',
        importance: 4
      }
    ],
    shotSlots: [
      {
        id: 'slot_hook_visual',
        segmentId: 'seg_hook',
        role: 'opening_attention',
        requiredAsset: { type: 'video', subject: '强视觉开头或冲突场景', motion: 'fast_cut', minDuration: 1.5 },
        visualIngredientRequirements: ['human_presence', 'face_closeup', 'host_talking'],
        humanRequirement: {
          required: true,
          role: 'host',
          framing: 'face_closeup',
          action: 'talking'
        },
        fallbackStrategies: ['ask_user_for_human_demo', 'product_closeup_replacement', 'caption_rewrite'],
        importance: 5
      },
      {
        id: 'slot_product_closeup',
        segmentId: 'seg_sp1',
        role: 'product_closeup',
        requiredAsset: { type: 'image', subject: '商品清晰特写', camera: 'closeup' },
        visualIngredientRequirements: ['product_closeup_trait', 'soft_light', 'clean_background'],
        fallbackStrategies: ['crop_zoom', 'selling_point_card', 'style_filter_suggestion'],
        importance: 4
      },
      {
        id: 'slot_usage_demo',
        segmentId: 'seg_sp1',
        role: 'usage_demo',
        requiredAsset: { type: 'video', subject: '用户使用商品过程', motion: 'hand_operation', minDuration: 2 },
        visualIngredientRequirements: ['human_presence', 'face_closeup', 'beauty_demo', 'soft_light'],
        humanRequirement: {
          required: true,
          role: 'host',
          framing: 'face_closeup',
          action: 'applying_product'
        },
        fallbackStrategies: ['ask_user_for_human_demo', 'hand_demo', 'swatch_card', 'caption_rewrite'],
        importance: 5
      },
      {
        id: 'slot_comparison',
        segmentId: 'seg_proof',
        role: 'comparison',
        requiredAsset: { type: 'video', subject: '使用前后或竞品对比', minDuration: 2 },
        visualIngredientRequirements: ['before_after_comparison', 'trust_building'],
        fallbackStrategies: ['before_after_card', 'comparison_card', 'trust_card'],
        importance: 4
      },
      {
        id: 'slot_cta',
        segmentId: 'seg_cta',
        role: 'cta_visual',
        requiredAsset: { type: 'generated', subject: '结尾行动卡' },
        visualIngredientRequirements: ['trust_building', 'social_proof'],
        fallbackStrategies: ['cta_card', 'selling_point_card', 'trust_card'],
        importance: 4
      }
    ],
    rhythm: {
      avgShotDuration: 1.2,
      cutFrequency: 'high',
      peakAt: 8,
      pattern: 'fast_hook_medium_selling_point_fast_cta'
    },
    packaging: {
      captionDensity: 'high',
      captionPosition: 'bottom_center',
      titleStyle: 'large_bold_center_with_emphasis',
      cardTypes: ['title_card', 'selling_point_card', 'comparison_card', 'cta_card'],
      transitions: ['quick_cut', 'zoom_in', 'push'],
      coverStyle: 'product_left_big_headline_right'
    },
    creativeIngredients,
    edges: [
      { from: 'seg_hook', to: 'seg_pain', type: 'sequence' },
      { from: 'seg_pain', to: 'seg_sp1', type: 'sequence' },
      { from: 'seg_sp1', to: 'seg_proof', type: 'sequence' },
      { from: 'seg_proof', to: 'seg_cta', type: 'sequence' }
    ]
  };
}
