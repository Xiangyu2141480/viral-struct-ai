import type {
  AssetCard,
  ContentBrief,
  ContextualAssetCoverageReport,
  MaterialScenarioProfile,
  MissingMaterialBrief
} from '@viral-struct/shared';

export interface MaterialScenarioClassifierOptions {
  userCanGenerate?: boolean;
}

export interface ClassifyMaterialScenarioInput {
  assets: AssetCard[];
  contextualCoverage?: ContextualAssetCoverageReport;
  contentBrief?: ContentBrief;
  missingMaterialBriefs?: MissingMaterialBrief[];
  options?: MaterialScenarioClassifierOptions;
}

const GENERATED_SOURCES = new Set(['generated_external', 'planned_generation', 'aigc']);

export function classifyMaterialScenario(input: ClassifyMaterialScenarioInput): MaterialScenarioProfile {
  const assets = input.assets;
  const assetCount = assets.length;
  const imageCount = assets.filter((asset) => asset.type === 'image').length;
  const videoCount = assets.filter((asset) => asset.type === 'video').length;
  const textCount = assets.filter((asset) => asset.type === 'text').length;
  const generatedAssetCount = assets.filter(isGeneratedAsset).length;
  const realFootageCount = assets.filter((asset) => asset.type === 'video' && !isGeneratedAsset(asset)).length;
  const evidenceCoverageScore = roundScore(input.contextualCoverage?.coverageSummary.coverageScore ?? 0);
  const weakOrInsufficient = (input.contextualCoverage?.coverageSummary.weakSlots ?? 0) + (input.contextualCoverage?.coverageSummary.insufficientSlots ?? 0);
  const canGenerate = Boolean(input.options?.userCanGenerate || generatedAssetCount > 0);
  const briefCount = input.missingMaterialBriefs?.length ?? 0;

  const scenarioType = (() => {
    if (assetCount === 0) return 'empty_assets';
    if (realFootageCount > 0 && generatedAssetCount > 0) return 'mixed_real_and_aigc';
    if (canGenerate) return 'aigc_ready';
    if (assetCount === 1 && imageCount === 1 && videoCount === 0) return 'single_image_only';
    if (realFootageCount > 0 && weakOrInsufficient > 0) return 'partial_real_footage';
    if (realFootageCount > 0) return 'partial_real_footage';
    return 'single_image_only';
  })();

  const strengths = buildStrengths({ assets, imageCount, videoCount, textCount, generatedAssetCount, realFootageCount, canGenerate, briefCount });
  const weaknesses = buildWeaknesses({ assetCount, videoCount, generatedAssetCount, weakOrInsufficient, contextualCoverage: input.contextualCoverage });
  const completionFeasibilityScore = estimateCompletionFeasibility({
    assets,
    contentBrief: input.contentBrief,
    evidenceCoverageScore,
    scenarioType,
    realFootageCount,
    generatedAssetCount,
    canGenerate,
    briefCount,
    weakOrInsufficient
  });

  return {
    scenarioType,
    assetCount,
    imageCount,
    videoCount,
    textCount,
    generatedAssetCount,
    realFootageCount,
    evidenceCoverageScore,
    completionFeasibilityScore,
    summary: summarizeScenario(scenarioType, evidenceCoverageScore, completionFeasibilityScore, weakOrInsufficient),
    strengths,
    weaknesses,
    recommendedDownstreamMode: recommendedMode(scenarioType, evidenceCoverageScore, weakOrInsufficient),
    warnings: buildWarnings(scenarioType, generatedAssetCount, canGenerate)
  };
}

function isGeneratedAsset(asset: AssetCard): boolean {
  const source = asset.analysisSource ?? asset.analysis?.source;
  if (source && GENERATED_SOURCES.has(source)) return true;
  const text = [
    asset.id,
    asset.spatialDescription,
    asset.temporalDescription,
    asset.analysis?.semantic.summary,
    ...(asset.analysis?.search.tags ?? [])
  ].filter(Boolean).join(' ').toLowerCase();
  return /\b(aigc|seedance|gemini|generated|planned generation|synthetic)\b/.test(text);
}

function buildStrengths(input: {
  assets: AssetCard[];
  imageCount: number;
  videoCount: number;
  textCount: number;
  generatedAssetCount: number;
  realFootageCount: number;
  canGenerate: boolean;
  briefCount: number;
}): string[] {
  const strengths: string[] = [];
  if (input.assets.some(hasProductEvidence)) strengths.push('Product reference is available.');
  if (input.realFootageCount > 0) strengths.push('Real footage can support concrete visual evidence.');
  if (input.imageCount > 0) strengths.push('Image assets can support crop/zoom, cover, or packaging-card inputs.');
  if (input.textCount > 0) strengths.push('Copy/text assets can support title, benefit, or CTA cards.');
  if (input.canGenerate) strengths.push('AIGC prompt briefs can be prepared for missing material.');
  if (input.generatedAssetCount > 0) strengths.push('Generated/planned assets are marked as proposed external material.');
  if (input.briefCount > 0) strengths.push(`${input.briefCount} missing-material handoff brief(s) are available for downstream planning.`);
  return strengths.length ? strengths : ['Structure and content brief can still drive card-only planning.'];
}

function buildWeaknesses(input: {
  assetCount: number;
  videoCount: number;
  generatedAssetCount: number;
  weakOrInsufficient: number;
  contextualCoverage?: ContextualAssetCoverageReport;
}): string[] {
  const weaknesses: string[] = [];
  if (input.assetCount === 0) weaknesses.push('No user assets were provided.');
  if (input.videoCount === 0) weaknesses.push('No real video footage is available for motion-heavy slots.');
  if (input.generatedAssetCount > 0) weaknesses.push('Generated/planned assets are prompts or references unless an external adapter renders them.');
  if (input.weakOrInsufficient > 0) weaknesses.push(`${input.weakOrInsufficient} structural slot(s) still need downstream handling.`);
  if ((input.contextualCoverage?.observations.length ?? 0) > 0) weaknesses.push('Material coverage observations remain and should be reviewed by GapRepairPlanner or Video Agent.');
  return weaknesses;
}

function estimateCompletionFeasibility(input: {
  assets: AssetCard[];
  contentBrief?: ContentBrief;
  evidenceCoverageScore: number;
  scenarioType: MaterialScenarioProfile['scenarioType'];
  realFootageCount: number;
  generatedAssetCount: number;
  canGenerate: boolean;
  briefCount: number;
  weakOrInsufficient: number;
}): number {
  let score = Math.min(35, input.evidenceCoverageScore * 0.4);
  if (input.assets.some(hasProductEvidence)) score += 18;
  if (input.assets.some(hasCleanProductAsset)) score += 10;
  if (input.realFootageCount > 0) score += Math.min(24, 12 + input.realFootageCount * 4);
  if (input.generatedAssetCount > 0 || input.canGenerate) score += 18;
  if (input.contentBrief?.sellingPoints.length) score += 8;
  if (input.contentBrief?.cta) score += 6;
  if (input.briefCount > 0 || input.weakOrInsufficient > 0) score += 8;

  if (input.scenarioType === 'empty_assets') score = Math.min(score, 38);
  if (input.scenarioType === 'single_image_only') score = Math.max(score, input.evidenceCoverageScore + 12, 48);
  if (input.scenarioType === 'partial_real_footage') score = Math.max(score, input.evidenceCoverageScore + 8, 58);
  if (input.scenarioType === 'aigc_ready') score = Math.max(score, input.evidenceCoverageScore + 16, 62);
  if (input.scenarioType === 'mixed_real_and_aigc') score = Math.max(score, input.evidenceCoverageScore + 12, 68);

  return roundScore(score);
}

function recommendedMode(
  scenarioType: MaterialScenarioProfile['scenarioType'],
  evidenceCoverageScore: number,
  weakOrInsufficient: number
): MaterialScenarioProfile['recommendedDownstreamMode'] {
  if (scenarioType === 'empty_assets') return 'structure_cards_only';
  if (scenarioType === 'single_image_only') return 'single_image_motion_reuse';
  if (scenarioType === 'aigc_ready') return 'aigc_missing_material_generation';
  if (scenarioType === 'mixed_real_and_aigc') return 'mixed_repair_workflow';
  if (weakOrInsufficient > 0 || evidenceCoverageScore < 75) return 'mixed_repair_workflow';
  return 'real_footage_editing';
}

function summarizeScenario(
  scenarioType: MaterialScenarioProfile['scenarioType'],
  evidenceCoverageScore: number,
  completionFeasibilityScore: number,
  weakOrInsufficient: number
): string {
  const label = scenarioType.replace(/_/g, ' ');
  return `${label}: evidence coverage ${evidenceCoverageScore}/100, completion feasibility ${completionFeasibilityScore}/100, ${weakOrInsufficient} weak or insufficient slot(s).`;
}

function buildWarnings(
  scenarioType: MaterialScenarioProfile['scenarioType'],
  generatedAssetCount: number,
  canGenerate: boolean
): string[] {
  const warnings: string[] = [];
  if (scenarioType === 'empty_assets') warnings.push('No user material exists; downstream output should be card/prompt-first.');
  if (generatedAssetCount > 0 || canGenerate) warnings.push('AIGC-ready means prompt planning only; no external image or video generation is performed by Asset Manager.');
  return warnings;
}

function hasProductEvidence(asset: AssetCard): boolean {
  const text = [
    asset.spatialDescription,
    asset.temporalDescription,
    asset.analysis?.semantic.summary,
    ...asset.detectedObjects,
    ...(asset.detectedIngredients ?? []),
    ...(asset.analysis?.search.tags ?? [])
  ].filter(Boolean).join(' ').toLowerCase();
  return /(product|bottle|label|packaging|商品|瓶身|包装|标签|康师傅|冰红茶)/i.test(text);
}

function hasCleanProductAsset(asset: AssetCard): boolean {
  const text = [
    asset.spatialDescription,
    ...(asset.visualStyleTags ?? []),
    ...(asset.analysis?.semantic.visualStyleTags ?? []),
    ...(asset.analysis?.search.tags ?? [])
  ].filter(Boolean).join(' ').toLowerCase();
  return hasProductEvidence(asset) && /(clean|white|background|safe area|product shot|白底|干净|留白)/i.test(text);
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}
