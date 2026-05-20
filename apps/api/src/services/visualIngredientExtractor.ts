import type { CreativeIngredient, VideoAnalysis } from '@viral-struct/shared';

export function extractCreativeIngredientsMock(
  _videoAnalysis?: VideoAnalysis
): CreativeIngredient[] {
  return [
    {
      id: 'ing_human_host_face',
      type: 'human_presence',
      name: '真人博主近脸出镜',
      description:
        '样例中开头和试用段落大量使用真人博主近脸出镜，增强亲近感和信任感。',
      segmentIds: ['seg_hook', 'seg_sp1', 'seg_cta'],
      requiredForSlotIds: ['slot_hook_visual', 'slot_usage_demo'],
      transferability: 'requires_user_asset',
      requiredAssets: ['face_closeup_video', 'talking_head_video'],
      fallbackStrategies: [
        'ask_user_for_human_demo',
        'product_closeup_replacement',
        'caption_rewrite',
        'trust_card'
      ],
      evidence: [
        {
          type: 'model_observation',
          value: 'mock: sample contains close-up host shots'
        }
      ],
      confidence: 0.86
    },
    {
      id: 'ing_beauty_usage_demo',
      type: 'beauty_demo',
      name: '上脸试用展示',
      description:
        '样例通过上脸试用展示产品效果，属于证明和转化的重要视觉要素。',
      segmentIds: ['seg_sp1', 'seg_proof'],
      requiredForSlotIds: ['slot_usage_demo', 'slot_comparison'],
      transferability: 'requires_user_asset',
      requiredAssets: ['applying_product_video', 'before_after_image'],
      fallbackStrategies: ['hand_demo', 'swatch_card', 'before_after_card', 'caption_rewrite'],
      evidence: [
        {
          type: 'model_observation',
          value: 'mock: sample includes makeup application and result display'
        }
      ],
      confidence: 0.82
    },
    {
      id: 'ing_soft_light_style',
      type: 'soft_light',
      name: '柔光高亮画面',
      description:
        '样例使用柔和光线和干净背景突出肤质、妆容和产品质感。',
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
