import type { AssetCard, MaterialGap, SlotMatch, ViralStructureGraph } from '@viral-struct/shared';

export function matchSlots(
  graph: ViralStructureGraph,
  assets: AssetCard[]
): { matches: SlotMatch[]; gaps: MaterialGap[] } {
  const matches: SlotMatch[] = graph.shotSlots.map((slot) => {
    const ranked = assets
      .map((asset) => {
        const roleMatch = asset.suitableSlots.includes(slot.role) ? 0.55 : 0;
        const typeMatch =
          slot.requiredAsset.type === 'generated'
            ? 0.2
            : asset.type === slot.requiredAsset.type
              ? 0.25
              : 0;
        const quality = asset.qualityScore * 0.2;
        return { asset, score: roleMatch + typeMatch + quality };
      })
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    const score = best?.score ?? 0;

    if (score >= 0.75) {
      return {
        slotId: slot.id,
        assetId: best.asset.id,
        score,
        status: 'matched',
        reason: '素材类型、槽位语义和质量均满足。'
      };
    }

    if (score >= 0.45) {
      return {
        slotId: slot.id,
        assetId: best.asset.id,
        score,
        status: 'partial',
        reason: '素材语义部分满足，但类型、动作或时长不足，需要补全。'
      };
    }

    return {
      slotId: slot.id,
      score,
      status: 'missing',
      reason: '没有找到能支撑该结构槽位的素材。'
    };
  });

  const gaps: MaterialGap[] = matches
    .filter((match) => match.status !== 'matched')
    .map((match) => {
      const slot = graph.shotSlots.find((s) => s.id === match.slotId)!;
      return {
        slotId: slot.id,
        role: slot.role,
        severity: match.status === 'missing' ? 'high' : 'medium',
        reason: match.reason,
        impact: `该缺口会影响 ${slot.segmentId} 段落的画面表达，需要使用 ${slot.fallbackStrategies.join(' / ')} 补足。`
      };
    });

  return { matches, gaps };
}
