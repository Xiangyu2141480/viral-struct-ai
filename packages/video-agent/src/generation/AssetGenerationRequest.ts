export type AssetGenerationMode = 'text_to_image' | 'image_to_video' | 'text_to_video';

export interface AssetGenerationRequest {
  slotId: string;
  generationMode: AssetGenerationMode;
  semanticRole: string;
  positivePrompt: string;
  negativePrompt: string;
  referenceAssetIds: string[];
  durationMs?: number;
  aspectRatio: '9:16' | '16:9' | '1:1';
  forbiddenElements: string[];
  riskFlags: string[];
  fallbackRepair: 'deterministic_editing_fill' | 'ask_user_for_asset';
  maxRegenerations: number;
  verificationCriteria: string[];
}
