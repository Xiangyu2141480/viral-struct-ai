import type { AssetCard } from '@viral-struct/shared';

export async function analyzeAssetsMock(
  files: Express.Multer.File[],
  textBrief?: string
): Promise<AssetCard[]> {
  const cards: AssetCard[] = files.map((file, index) => {
    const lower = file.originalname.toLowerCase();
    const isVideo = lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm');
    const isHand = lower.includes('hand') || lower.includes('手');

    return {
      id: `asset_${index + 1}`,
      type: isVideo ? 'video' : 'image',
      url: file.path,
      spatialDescription: isHand
        ? '手持商品的静态画面，适合表现使用场景，但动作信息不足。'
        : '商品主体清晰，适合做商品特写和 CTA 视觉。',
      temporalDescription: isVideo
        ? '片段包含轻微镜头运动，可用于卖点展示。'
        : '静态图片，无真实动作过程。',
      detectedObjects: ['product'],
      suitableSlots: isHand
        ? ['product_closeup', 'usage_demo', 'cta_visual']
        : ['product_closeup', 'benefit_visual', 'cta_visual'],
      qualityScore: 0.82
    };
  });

  if (textBrief) {
    cards.push({
      id: 'asset_text_brief',
      type: 'text',
      text: textBrief,
      detectedObjects: [],
      suitableSlots: ['benefit_visual', 'cta_visual'],
      qualityScore: 0.75
    });
  }

  return cards;
}
