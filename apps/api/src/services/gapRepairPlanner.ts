import type { AssetCard, ContentBrief, GapRepair, MaterialGap } from '@viral-struct/shared';

export function planGapRepairs(
  gaps: MaterialGap[],
  _assets: AssetCard[],
  newContent?: ContentBrief
): GapRepair[] {
  return gaps.map((gap) => {
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
