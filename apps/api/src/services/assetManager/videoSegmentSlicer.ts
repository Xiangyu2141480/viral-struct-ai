import type { AssetMediaProfile, AssetVideoSegment, ShotSlotRole, VisualSegmentationProfile } from '@viral-struct/shared';
import { buildVisualSegmentationProfile } from './visualSegmentScanner';

export interface VlmVideoSegmentLabel {
  segmentLabel: string;
  visualSummary: string;
  roleHints: ShotSlotRole[];
  actionTags: string[];
  confidence: number;
  risks: string[];
}

export interface SliceVideoIntoSegmentsInput {
  assetId: string;
  media: AssetMediaProfile;
  semanticSummary: string;
  suitableSlots: ShotSlotRole[];
  qualityScore: number;
  segmentation?: VisualSegmentationProfile;
  vlmSegments?: VlmVideoSegmentLabel[];
}

const DEFAULT_SINGLE_SEGMENT_ROLE: ShotSlotRole = 'product_closeup';
const ALLOWED_ROLES = new Set<ShotSlotRole>([
  'opening_attention',
  'product_closeup',
  'usage_demo',
  'benefit_visual',
  'comparison',
  'testimonial',
  'cta_visual',
  'instruction_card',
  'example_clip',
  'technique_demo'
]);

export function sliceVideoIntoSegments(input: SliceVideoIntoSegmentsInput): AssetVideoSegment[] {
  const duration = normalizeDuration(input.media.durationSec);
  const vlmLabels = sanitizeVlmLabels(input.vlmSegments);
  const segmentation = normalizeSegmentation(input.segmentation);
  const windows = buildSegmentWindows({
    durationSec: duration,
    segmentation,
    vlmLabelCount: vlmLabels.length
  });
  const count = windows.length;

  return windows.map((window, index) => {
    const vlm = vlmLabels[index];
    const keyframes = input.media.keyframes.filter((keyframe) => {
      const time = keyframe.timeSec;
      return time === undefined ? false : time >= window.startSec && time <= window.endSec;
    });
    const segmentEvidenceText = buildSegmentEvidenceText(keyframes, window.boundaryEvidence);
    const inferredRoles = inferRolesFromSegmentEvidence(segmentEvidenceText);
    const roleHints = vlm?.roleHints.length
      ? vlm.roleHints
      : inferRoleHints({ count, inferredRoles, suitableSlots: input.suitableSlots });
    const actionTags = uniqueStrings(vlm?.actionTags.length ? vlm.actionTags : inferActionTagsFromEvidence(segmentEvidenceText, input.semanticSummary));
    const label = vlm?.segmentLabel ?? evidenceBasedLabel(index, window, segmentEvidenceText);
    const visualSummary = vlm?.visualSummary ?? evidenceBasedSummary({
      label,
      keyframes,
      boundaryEvidence: window.boundaryEvidence,
      actionTags,
      hasSegmentSemanticEvidence: segmentEvidenceText.length > 0
    });
    const semanticWarning =
      !vlm && count > 1 && segmentEvidenceText.length === 0
        ? 'Segment semantic label unavailable without VLM or meaningful keyframe captions; using visual-boundary label.'
        : undefined;
    return {
      id: `${input.assetId}_seg_${String(index + 1).padStart(3, '0')}`,
      parentAssetId: input.assetId,
      startSec: window.startSec,
      endSec: window.endSec,
      durationSec: round(window.endSec - window.startSec),
      label,
      visualSummary,
      roleHints,
      actionTags,
      qualityScore: input.qualityScore,
      confidence: vlm ? clamp01(vlm.confidence) : deterministicConfidence(index, count, segmentEvidenceText.length > 0),
      keyframeIds: keyframes.map((keyframe) => keyframe.id),
      thumbnailUrl: keyframes[0]?.url,
      source: vlm ? 'hybrid' : 'deterministic',
      boundaryEvidence: window.boundaryEvidence,
      warnings: uniqueStrings([...(segmentation?.warnings ?? []), ...(vlm?.risks ?? []), semanticWarning])
    };
  });
}

function normalizeDuration(durationSec: number | undefined): number {
  if (!Number.isFinite(durationSec ?? NaN) || (durationSec ?? 0) <= 0) return 0;
  return round(durationSec ?? 0);
}

function normalizeSegmentation(segmentation: VisualSegmentationProfile | undefined): VisualSegmentationProfile | undefined {
  if (!segmentation) return undefined;
  if (!segmentation.shouldSlice) {
    return { ...segmentation, boundaryCandidates: [], warnings: uniqueStrings(segmentation.warnings) };
  }
  const rebuilt = buildVisualSegmentationProfile({
    durationSec: segmentation.durationSec,
    boundaryCandidates: segmentation.boundaryCandidates
  });
  return { ...rebuilt, warnings: uniqueStrings([...segmentation.warnings, ...rebuilt.warnings]) };
}

function buildSegmentWindows(input: {
  durationSec: number;
  segmentation?: VisualSegmentationProfile;
  vlmLabelCount: number;
}): Array<{ startSec: number; endSec: number; boundaryEvidence?: VisualSegmentationProfile['boundaryCandidates'][number] }> {
  const durationSec = input.durationSec;
  if (durationSec <= 0) return [{ startSec: 0, endSec: 0 }];
  if (input.segmentation && !input.segmentation.shouldSlice) return [{ startSec: 0, endSec: durationSec }];
  if (input.segmentation?.shouldSlice && input.segmentation.boundaryCandidates.length > 0) {
    return buildWindowsFromBoundaries(durationSec, input.segmentation.boundaryCandidates);
  }
  const count = input.vlmLabelCount > 0 ? clampCount(input.vlmLabelCount, durationSec) : 1;
  return buildEvenWindows(durationSec, count);
}

function clampCount(count: number, durationSec: number): number {
  if (durationSec <= 0) return 1;
  const maxByMinDuration = Math.max(1, Math.floor(durationSec / 3));
  return Math.max(1, Math.min(count, maxByMinDuration, 8));
}

function buildWindowsFromBoundaries(
  durationSec: number,
  boundaries: VisualSegmentationProfile['boundaryCandidates']
): Array<{ startSec: number; endSec: number; boundaryEvidence?: VisualSegmentationProfile['boundaryCandidates'][number] }> {
  const sorted = boundaries.slice().sort((a, b) => a.timeSec - b.timeSec);
  const windows: Array<{ startSec: number; endSec: number; boundaryEvidence?: VisualSegmentationProfile['boundaryCandidates'][number] }> = [];
  let cursor = 0;
  let leftBoundary: VisualSegmentationProfile['boundaryCandidates'][number] | undefined;
  for (const boundary of sorted) {
    windows.push({ startSec: cursor, endSec: boundary.timeSec, boundaryEvidence: leftBoundary });
    leftBoundary = boundary;
    cursor = boundary.timeSec;
  }
  windows.push({ startSec: cursor, endSec: durationSec, boundaryEvidence: leftBoundary });
  return windows.map((window) => ({ ...window, startSec: round(window.startSec), endSec: round(window.endSec) }));
}

function buildEvenWindows(durationSec: number, count: number): Array<{ startSec: number; endSec: number }> {
  if (durationSec <= 0) return [{ startSec: 0, endSec: 0 }];
  return Array.from({ length: count }, (_value, index) => {
    const startSec = round((durationSec * index) / count);
    const endSec = index === count - 1 ? durationSec : round((durationSec * (index + 1)) / count);
    return { startSec, endSec: Math.max(endSec, round(startSec + 0.1)) };
  });
}

function sanitizeVlmLabels(labels: VlmVideoSegmentLabel[] | undefined): VlmVideoSegmentLabel[] {
  return (labels ?? [])
    .map((label) => ({
      ...label,
      segmentLabel: label.segmentLabel.trim(),
      visualSummary: label.visualSummary.trim(),
      roleHints: label.roleHints.filter((role) => ALLOWED_ROLES.has(role)),
      actionTags: uniqueStrings(label.actionTags),
      confidence: clamp01(label.confidence),
      risks: uniqueStrings(label.risks)
    }))
    .filter((label) => label.segmentLabel && label.visualSummary && label.roleHints.length > 0);
}

function inferRoleHints(args: {
  count: number;
  inferredRoles: ShotSlotRole[];
  suitableSlots: ShotSlotRole[];
}): ShotSlotRole[] {
  if (args.count === 1) return args.suitableSlots.length ? args.suitableSlots : (args.inferredRoles.length ? args.inferredRoles : [DEFAULT_SINGLE_SEGMENT_ROLE]);
  if (args.inferredRoles.length) return args.inferredRoles;
  return [];
}

function buildSegmentEvidenceText(
  keyframes: AssetMediaProfile['keyframes'],
  boundaryEvidence?: VisualSegmentationProfile['boundaryCandidates'][number]
): string {
  return uniqueStrings([
    ...keyframes
      .map((keyframe) => keyframe.description)
      .filter((description): description is string => Boolean(description && !isGenericFrameDescription(description))),
    boundaryEvidence?.reason && !isGenericBoundaryReason(boundaryEvidence.reason) ? boundaryEvidence.reason : undefined
  ]).join(' | ');
}

function inferRolesFromSegmentEvidence(text: string): ShotSlotRole[] {
  const lower = text.toLowerCase();
  if (!lower.trim()) return [];
  const role: ShotSlotRole | undefined =
    /cta|end frame|lock.?up|call.?to.?action|结尾|收口|定格|购买|留白/.test(lower)
      ? 'cta_visual'
      : /ice|cold|lemon|refresh|condensation|benefit|proof|冰|冷|柠檬|清爽|冷凝|卖点|证明/.test(lower)
        ? 'benefit_visual'
        : /open cap|pour|drink|hand|pickup|usage|use|开盖|倒|杯|饮用|喝|手持|拿起/.test(lower)
          ? 'usage_demo'
          : /lineup|compare|comparison|before.?after|阵列|陈列|对比/.test(lower)
            ? 'comparison'
            : /closeup|close.?up|label|logo|packaging|bottle|特写|标签|瓶身|包装/.test(lower)
              ? 'product_closeup'
              : /opening|entrance|hook|impact|motion|开场|入场|冲击/.test(lower)
                ? 'opening_attention'
                : undefined;
  return role ? [role] : [];
}

function inferActionTagsFromEvidence(text: string, parentSummary: string): string[] {
  const lower = text.toLowerCase();
  const parentLower = parentSummary.toLowerCase();
  const tags: string[] = [];
  if (/opening|entrance|hook|impact|motion|开场|入场|冲击/.test(lower)) tags.push('product_motion');
  if (/rotation|rotate|pan|旋转|环绕|扫过/.test(lower)) tags.push('product_rotation');
  if (/closeup|close.?up|label|logo|特写|标签/.test(lower)) tags.push('product_closeup_hold');
  if (/open|cap|开盖|瓶盖/.test(lower)) tags.push('open_cap');
  if (/pour|cup|倒|杯/.test(lower)) tags.push('pour_to_cup');
  if (/usage|hand action|使用|动作/.test(lower) && /open|cap|开盖|瓶盖/.test(parentLower)) tags.push('open_cap');
  if (/usage|hand action|使用|动作/.test(lower) && /pour|cup|倒|杯/.test(parentLower)) tags.push('pour_to_cup');
  if (/drink|饮用|喝/.test(lower)) tags.push('drink_neck_down');
  if (/hand|pickup|手持|拿起/.test(lower)) tags.push('hand_pickup');
  if (/ice|cold|lemon|refresh|condensation|冰|冷|柠檬|清爽|冷凝/.test(lower)) tags.push('ice_or_refresh_detail');
  if (/lineup|compare|comparison|before.?after|阵列|陈列|对比/.test(lower)) tags.push('lineup_sweep');
  if (/cta|end frame|lock.?up|结尾|收口|定格|购买|留白/.test(lower)) tags.push('clean_cta_end_frame');
  return uniqueStrings(tags);
}

function evidenceBasedLabel(index: number, window: { startSec: number; endSec: number }, segmentEvidenceText: string): string {
  const firstEvidence = firstEvidencePhrase(segmentEvidenceText);
  if (firstEvidence) return `Visual segment ${index + 1}: ${firstEvidence}`;
  return `Visual segment ${index + 1} (${formatTime(window.startSec)}-${formatTime(window.endSec)}s)`;
}

function evidenceBasedSummary(args: {
  label: string;
  keyframes: AssetMediaProfile['keyframes'];
  boundaryEvidence?: VisualSegmentationProfile['boundaryCandidates'][number];
  actionTags: string[];
  hasSegmentSemanticEvidence: boolean;
}): string {
  const captions = args.keyframes
    .map((keyframe) => keyframe.description)
    .filter((description): description is string => Boolean(description && !isGenericFrameDescription(description)));
  const evidence = [
    captions.length ? `keyframes: ${captions.slice(0, 2).join(' / ')}` : undefined,
    args.boundaryEvidence ? `boundary: ${args.boundaryEvidence.source} at ${args.boundaryEvidence.timeSec}s` : undefined,
    args.actionTags.length ? `actions: ${args.actionTags.join(', ')}` : undefined
  ].filter(Boolean);
  if (!args.hasSegmentSemanticEvidence) {
    evidence.push('semantic label unavailable; this segment is identified by visual boundary only');
  }
  return `${args.label}. ${evidence.join(' | ')}`;
}

function deterministicConfidence(index: number, count: number, hasSegmentSemanticEvidence: boolean): number {
  const edgeBonus = index === 0 || index === count - 1 ? 0.02 : 0;
  const semanticBonus = hasSegmentSemanticEvidence ? 0.08 : 0;
  return Number(Math.min(0.82, 0.62 + semanticBonus + edgeBonus).toFixed(2));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function firstEvidencePhrase(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/[|。.;；]/)[0]?.trim().slice(0, 72) || undefined;
}

function isGenericFrameDescription(description: string): boolean {
  return /^sampled frame(?: at)?/i.test(description.trim())
    || /^deterministic asset keyframe/i.test(description.trim())
    || /^frame\s+\d+/i.test(description.trim())
    || /^keyframe/i.test(description.trim());
}

function isGenericBoundaryReason(reason: string): boolean {
  return /^(scene boundary|valid cut|hard cut|motion boundary)$/i.test(reason.trim());
}

function formatTime(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round(value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
