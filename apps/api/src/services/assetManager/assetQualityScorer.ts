import type { AssetIssue, AssetMediaProfile, AssetQualityProfile } from '@viral-struct/shared';

export interface QualityScoreResult {
  quality: AssetQualityProfile;
  warnings: string[];
}

export function scoreAssetQuality(media: AssetMediaProfile, semanticSignals: { hasProductCue?: boolean; isTextCta?: boolean } = {}): QualityScoreResult {
  const warnings: string[] = [];
  const resolution = scoreResolution(media.width, media.height, media.kind);
  const sharpness = media.kind === 'text' ? 0.88 : 0.6;
  const brightness = media.kind === 'text' ? 0.9 : 0.62;
  const contrast = media.kind === 'text' ? 0.82 : 0.58;

  if (media.kind !== 'text') {
    warnings.push('Pixel-level sharpness/brightness/contrast are deterministic fallback estimates.');
  }

  const composition = media.aspectRatio === 'unknown' ? 0.58 : 0.72;
  const productFocus = semanticSignals.hasProductCue ? 0.78 : media.kind === 'text' ? 0.5 : 0.56;
  const textSafeArea = media.kind === 'text' || semanticSignals.isTextCta ? 0.85 : 0.7;
  const formatFit = media.kind === 'text'
    ? 0.86
    : media.aspectRatio === '9:16'
      ? 0.92
      : media.aspectRatio === '16:9'
        ? 0.76
        : media.aspectRatio === '1:1'
          ? 0.68
          : 0.55;
  const clarity = average([resolution, sharpness]);
  const lighting = average([brightness, contrast]);
  const subjectProminence = productFocus;
  const overallScore = average([resolution, sharpness, brightness, contrast, composition, productFocus, textSafeArea, formatFit]);
  const issues = buildIssues(media, overallScore, resolution);

  return {
    quality: {
      overallScore,
      resolution,
      sharpness,
      brightness,
      contrast,
      clarity,
      composition,
      lighting,
      subjectProminence,
      productFocus,
      textSafeArea,
      formatFit,
      issues
    },
    warnings
  };
}

function scoreResolution(width: number | undefined, height: number | undefined, kind: AssetMediaProfile['kind']): number {
  if (kind === 'text') return 0.86;
  if (!width || !height) return 0.45;
  const pixels = width * height;
  if (pixels < 10_000) return 0.1;
  if (pixels < 250_000) return 0.35;
  if (pixels < 1_000_000) return 0.62;
  if (pixels < 2_000_000) return 0.78;
  return 0.9;
}

function buildIssues(media: AssetMediaProfile, overallScore: number, resolution: number): AssetIssue[] {
  const issues: AssetIssue[] = [];
  if (resolution < 0.35) {
    issues.push({
      type: 'low_resolution',
      severity: 'medium',
      message: 'Resolution is below the recommended threshold for final short-video composition.'
    });
  }
  if (overallScore < 0.5) {
    issues.push({
      type: 'low_quality',
      severity: 'medium',
      message: 'Deterministic quality estimate is below the recommended threshold.'
    });
  }
  if (media.kind === 'video' && media.keyframes.length === 0) {
    issues.push({
      type: 'no_motion_evidence',
      severity: 'low',
      message: 'No sampled keyframes are available for video-level quality analysis.'
    });
  }
  return issues;
}

function average(values: number[]): number {
  return clamp01(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}
