import type { AssetCard, ContentBrief } from '@viral-struct/shared';
import type { DeterministicAnalyzeOptions } from './deterministicAssetAnalyzer';
import { analyzeAssetsDeterministic } from './deterministicAssetAnalyzer';
import {
  enrichAssetsWithOptionalVlm,
  type OptionalVlmAssetAnalyzerOptions
} from './optionalVlmAssetAnalyzer';

export interface AssetManagerAnalyzeOptions extends DeterministicAnalyzeOptions {
  contentBrief?: ContentBrief;
  clientFactory?: OptionalVlmAssetAnalyzerOptions['clientFactory'];
  vlmEnabled?: boolean;
  vlmModel?: string;
}

export interface AssetManagerAnalyzeResult {
  assetCards: AssetCard[];
  warnings: string[];
  vlmStatus: 'disabled' | 'enhanced' | 'fallback';
}

export async function analyzeAssetsWithAssetManager(opts: AssetManagerAnalyzeOptions): Promise<AssetManagerAnalyzeResult> {
  const assetCards = await analyzeAssetsDeterministic(opts);
  return enrichAssetsWithOptionalVlm({
    assetCards,
    contentBrief: opts.contentBrief,
    clientFactory: opts.clientFactory,
    enabled: opts.vlmEnabled,
    model: opts.vlmModel
  });
}
