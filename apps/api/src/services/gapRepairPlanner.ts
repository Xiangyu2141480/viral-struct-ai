import type { AssetCard, ContentBrief, GapRepair, MaterialGap } from '@viral-struct/shared';

export function planGapRepairs(
  gaps: MaterialGap[],
  _assets: AssetCard[],
  newContent?: ContentBrief
): GapRepair[] {
  return gaps.map((gap) => {
    if (gap.type === 'missing_human_host' || gap.type === 'missing_face_closeup') {
      return {
        slotId: gap.slotId,
        strategy: 'ask_user_for_human_demo',
        explanation:
          '样例结构需要授权演示或讲解镜头来建立信任。优先让用户补充授权的演示素材；若无法补拍，则降级为产品特写 + 强字幕说明，不默认生成虚拟人物替代。'
      };
    }

    if (gap.type === 'missing_beauty_demo' || gap.type === 'missing_usage_action') {
      return {
        slotId: gap.slotId,
        strategy: 'hand_demo',
        explanation:
          '缺少真实操作或动作演示素材，优先建议补拍手部操作/使用过程；无法补拍时使用步骤卡、字幕和产品局部特写降级表达。'
      };
    }

    if (gap.type === 'missing_before_after') {
      return {
        slotId: gap.slotId,
        strategy: 'before_after_card',
        explanation:
          '缺少使用前后对比素材，使用对比卡或前后状态文字卡表达变化，并提示用户后续补充真实对比素材。'
      };
    }

    if (gap.type === 'missing_trust_element') {
      return {
        slotId: gap.slotId,
        strategy: 'trust_card',
        explanation:
          '缺少建立信任的口播、评价或证据元素，使用来源可控的卖点证据卡补足；无证据时避免强事实承诺。'
      };
    }

    if (gap.type === 'missing_scene_style') {
      return {
        slotId: gap.slotId,
        strategy: 'style_filter_suggestion',
        explanation:
          '当前素材缺少样例中的柔光、干净背景或高质感画面风格，建议使用统一滤镜、浅色背景、产品特写构图和标题条包装补足审美一致性。'
      };
    }

    if (gap.role === 'opening_attention') {
      return {
        slotId: gap.slotId,
        strategy: 'text_card',
        explanation: `缺少强视觉开头镜头，使用大标题卡 + 产品图推近制造 Hook。标题围绕「${newContent?.productName ?? '新商品'}」的核心痛点生成。`
      };
    }

    if (gap.role === 'usage_demo') {
      return {
        slotId: gap.slotId,
        strategy: 'crop_zoom',
        explanation: '缺少真实使用过程视频，使用现有手持图或产品图局部放大，并叠加步骤字幕和箭头贴纸。'
      };
    }

    if (gap.role === 'comparison') {
      return {
        slotId: gap.slotId,
        strategy: 'comparison_card',
        explanation: '缺少真实对比镜头，使用左右对比卡片表达普通方案与新商品的差异。'
      };
    }

    if (gap.role === 'cta_visual') {
      return {
        slotId: gap.slotId,
        strategy: 'cta_card',
        explanation: '缺少结尾 CTA 镜头，自动生成 CTA 卡片收束。'
      };
    }

    return {
      slotId: gap.slotId,
      strategy: 'caption_rewrite',
      explanation: '使用字幕和卖点卡补足画面信息。'
    };
  });
}
