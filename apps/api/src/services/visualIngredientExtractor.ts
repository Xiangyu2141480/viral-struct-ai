import type { CreativeIngredient, VideoAnalysis } from '@viral-struct/shared';

export function extractCreativeIngredientsMock(
  _videoAnalysis?: VideoAnalysis
): CreativeIngredient[] {
  return [
    {
      id: 'ing_product_closeup',
      type: 'product_closeup_trait',
      name: '商品特写与卖点画面',
      description:
        '样例使用清晰的商品特写和卖点画面承接核心信息，迁移时优先补足新商品的可识别视觉。',
      segmentIds: ['seg_hook', 'seg_sp1', 'seg_proof'],
      requiredForSlotIds: ['slot_hook_visual', 'slot_product_closeup'],
      transferability: 'requires_user_asset',
      requiredAssets: ['product_closeup_video', 'selling_point_visual'],
      fallbackStrategies: [
        'product_closeup_replacement',
        'caption_rewrite',
        'selling_point_card',
        'trust_card'
      ],
      evidence: [
        {
          type: 'model_observation',
          value: 'mock: sample contains clear product-focused shots'
        }
      ],
      confidence: 0.86
    },
    {
      id: 'ing_operation_demo',
      type: 'hand_demo',
      name: '手部操作演示',
      description:
        '样例通过操作或使用动作展示卖点，迁移时可用手部演示、步骤卡或产品操作镜头替代。',
      segmentIds: ['seg_sp1', 'seg_proof'],
      requiredForSlotIds: ['slot_usage_demo', 'slot_comparison'],
      transferability: 'requires_user_asset',
      requiredAssets: ['hand_operation_video', 'usage_demo_video'],
      fallbackStrategies: ['hand_demo', 'selling_point_card', 'comparison_card', 'caption_rewrite'],
      evidence: [
        {
          type: 'model_observation',
          value: 'mock: sample includes product operation and proof-oriented shots'
        }
      ],
      confidence: 0.82
    },
    {
      id: 'ing_soft_light_style',
      type: 'soft_light',
      name: '柔光高亮画面',
      description:
        '样例使用柔和光线和干净背景突出商品轮廓、材质和信息卡层级。',
      segmentIds: ['seg_hook', 'seg_sp1', 'seg_proof'],
      requiredForSlotIds: ['slot_product_closeup', 'slot_usage_demo'],
      transferability: 'can_be_recreated_by_packaging',
      requiredAssets: [],
      fallbackStrategies: ['style_filter_suggestion', 'product_closeup_replacement'],
      evidence: [
        {
          type: 'model_observation',
          value: 'mock: visual style is bright, clean, and soft-lighted'
        }
      ],
      confidence: 0.8
    }
  ];
}
