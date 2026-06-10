import type { AssetCard } from '@viral-struct/shared';

export interface MatchableAssetCardFilterResult {
  assetCards: AssetCard[];
  removedParentAssetIds: string[];
  warnings: string[];
}

export function isLongVideoParentAsset(asset: AssetCard): boolean {
  return asset.type === 'video'
    && !asset.segmentSource
    && (asset.analysis?.videoSegments?.length ?? 0) > 0;
}

export function isMatchableAssetCard(asset: AssetCard): boolean {
  return !isLongVideoParentAsset(asset);
}

/**
 * Long-video parent cards are provenance/media-source records only. Matching,
 * coverage, Director references and Video Agent prompts should consume the
 * segment AssetCards so parent videos cannot double-count or mask gaps.
 */
export function filterMatchableAssetCards(assetCards: AssetCard[]): MatchableAssetCardFilterResult {
  const removedParentAssetIds: string[] = [];
  const matchable = assetCards.filter((asset) => {
    if (!isLongVideoParentAsset(asset)) return true;
    removedParentAssetIds.push(asset.id);
    return false;
  });

  return {
    assetCards: matchable,
    removedParentAssetIds,
    warnings: removedParentAssetIds.length > 0
      ? [
          `Filtered ${removedParentAssetIds.length} long-video parent asset(s) from matchable downstream context; segment AssetCards remain matchable.`
        ]
      : []
  };
}
