import type { AssetCard } from '@viral-struct/shared';

export async function analyzeAssetsMock(
  files: Express.Multer.File[],
  textBrief?: string
): Promise<AssetCard[]> {
  const cards: AssetCard[] = files.map((file, index) => {
    const lower = file.originalname.toLowerCase();
    const isVideo = lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm');
    const isHand = lower.includes('hand') || lower.includes('手');
    const hasFace = lower.includes('face') || lower.includes('host') || lower.includes('真人') || lower.includes('脸');
    const isBeauty = lower.includes('makeup') || lower.includes('beauty') || lower.includes('swatch') || lower.includes('妆') || lower.includes('试色');
    const isBeforeAfter = lower.includes('before') || lower.includes('after') || lower.includes('对比');

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
      qualityScore: 0.82,
      detectedIngredients: [
        'product_closeup_trait',
        'clean_background',
        ...(isHand ? ['hand_demo' as const] : []),
        ...(hasFace ? ['human_presence' as const, 'face_closeup' as const, 'host_talking' as const] : []),
        ...(isBeauty ? ['beauty_demo' as const, 'swatch_demo' as const] : []),
        ...(isBeforeAfter ? ['before_after_comparison' as const] : [])
      ],
      humanPresence: {
        hasHuman: hasFace || isHand,
        role: hasFace ? 'host' : isHand ? 'hand_only' : 'unknown',
        framing: hasFace ? ['face_closeup'] : isHand ? ['hands'] : ['product_only'],
        actions: [
          ...(hasFace && isVideo ? ['talking' as const] : []),
          ...(isBeauty && isVideo ? ['applying_product' as const, 'showing_result' as const] : []),
          ...(isHand ? ['holding_product' as const] : [])
        ]
      },
      visualStyleTags: ['clean_background', ...(isBeauty ? ['beauty_style' as const] : [])]
    };
  });

  if (textBrief) {
    cards.push({
      id: 'asset_text_brief',
      type: 'text',
      text: textBrief,
      detectedObjects: [],
      suitableSlots: ['benefit_visual', 'cta_visual'],
      qualityScore: 0.75,
      detectedIngredients: ['trust_building'],
      humanPresence: {
        hasHuman: false,
        role: 'unknown',
        framing: [],
        actions: []
      },
      visualStyleTags: []
    });
  }

  return cards;
}
