import type { AssetCard, Boundary, ContentBrief, QualityReport, SlotMatch, TimelineItem } from '@viral-struct/shared';

export function evaluateQuality(input: {
  matches?: SlotMatch[];
  timeline?: TimelineItem[];
  boundaries?: Boundary[];
  contentBrief?: ContentBrief;
  assets?: AssetCard[];
}): QualityReport {
  const matches = input.matches ?? [];
  const timeline = input.timeline ?? [];
  const boundaries = input.boundaries;
  const matched = matches.filter((m) => m.status === 'matched').length;
  const partial = matches.filter((m) => m.status === 'partial').length;
  const slotCoverage = matches.length ? (matched + partial * 0.5) / matches.length : 0.7;

  const report: QualityReport = {
    structureMatch: computeStructureMatch(matches),
    slotCoverage,
    visualScriptAlignment: computeVisualScriptAlignment(timeline, input.assets),
    factuality: computeFactuality(timeline, input.contentBrief),
    coherence: computeCoherence(timeline),
    subtitleReadability: computeSubtitleReadability(timeline),
    warnings: matches
      .filter((m) => m.status !== 'matched')
      .map((m) => `${m.slotId} 不是直接素材满足，已使用补全策略。`)
  };

  const transitionFidelity = computeTransitionFidelity(timeline, boundaries);
  if (transitionFidelity !== undefined) {
    report.transitionFidelity = transitionFidelity;
  }
  return report;
}

// ---------------------------------------------------------------------------
// structureMatch — weighted alignment quality across matched/partial/missing slots.
// Uses match.quality (PR #36 LLM-judge path) when present; otherwise maps status.
// ---------------------------------------------------------------------------

export function computeStructureMatch(matches: SlotMatch[]): number {
  if (matches.length === 0) return 0;
  const STATUS_SCORE: Record<SlotMatch['status'], number> = {
    matched: 0.9,
    partial: 0.6,
    missing: 0.2
  };
  let sum = 0;
  for (const m of matches) {
    sum += typeof m.quality === 'number' ? m.quality : STATUS_SCORE[m.status];
  }
  return round3(sum / matches.length);
}

// ---------------------------------------------------------------------------
// factuality — how much of the script is backed by the user's ContentBrief.
// Coverage rewards every selling point referenced in the script;
// risk penalty subtracts for unsupported strong claims.
// ---------------------------------------------------------------------------

const FACTUAL_RISK_PHRASES = [
  '100%', '永久', '终身保证', '保证', '最便宜', '最佳',
  '业内第一', '行业第一', '医学证明', '医生推荐', '专家推荐', '临床证明'
];

export function computeFactuality(
  timeline: TimelineItem[],
  brief: ContentBrief | undefined
): number {
  if (!brief || timeline.length === 0) return 0.7;
  const allScript = timeline.map((t) => t.script).join(' ').toLowerCase();

  const coverage = brief.sellingPoints.length
    ? brief.sellingPoints.filter((sp) => mentionsAnyChunk(allScript, sp.toLowerCase())).length
        / brief.sellingPoints.length
    : 1;

  const hallucinations = FACTUAL_RISK_PHRASES.filter((w) => allScript.includes(w.toLowerCase())).length;
  const penalty = Math.min(0.4, hallucinations * 0.1);

  return round3(clamp01(coverage * 0.95 - penalty));
}

// ---------------------------------------------------------------------------
// subtitleReadability — line length + chars-per-second + line-count rubric.
// Optimal: 6-14 chars/line, 3-7 CPS, ≤4 lines/item.
// ---------------------------------------------------------------------------

export function computeSubtitleReadability(timeline: TimelineItem[]): number {
  if (timeline.length === 0) return 0.75;
  let total = 0;
  let counted = 0;

  for (const item of timeline) {
    if (item.subtitles.length === 0) continue;

    const lineLenScore =
      item.subtitles.map(lineLengthScore).reduce((a, b) => a + b, 0) / item.subtitles.length;

    const totalChars = item.subtitles.join('').length;
    const duration = Math.max(0.5, item.end - item.start);
    const cps = totalChars / duration;
    const cpsScore = cpsScoreFromRate(cps);

    const linesScore = item.subtitles.length <= 4 ? 1.0 : 0.6;

    total += lineLenScore * 0.5 + cpsScore * 0.35 + linesScore * 0.15;
    counted += 1;
  }

  if (counted === 0) return 0.75;
  return round3(total / counted);
}

function lineLengthScore(line: string): number {
  const len = line.length;
  if (len >= 6 && len <= 14) return 1.0;
  if (len < 6) return 0.6;
  if (len <= 18) return 0.7;
  return 0.4;
}

function cpsScoreFromRate(cps: number): number {
  if (cps >= 3 && cps <= 7) return 1.0;
  if (cps < 3) return 0.8;
  if (cps <= 9) return 0.7;
  return 0.4;
}

// ---------------------------------------------------------------------------
// coherence — does the timeline avoid obvious cadence problems?
// Penalties: long runs of identical transitions, motion thrashing,
// monotone cardType across many items.
// ---------------------------------------------------------------------------

export function computeCoherence(timeline: TimelineItem[]): number {
  if (timeline.length < 2) return 0.85;
  let score = 1.0;

  // Long run of same transition
  let runLen = 1;
  let longestRun = 1;
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i].packaging.transition === timeline[i - 1].packaging.transition) {
      runLen += 1;
    } else {
      runLen = 1;
    }
    if (runLen > longestRun) longestRun = runLen;
  }
  if (longestRun >= 5) score -= 0.25;
  else if (longestRun >= 3) score -= 0.1;

  // Motion thrashing: A → B → A within a 3-item window
  let thrashing = 0;
  for (let i = 2; i < timeline.length; i++) {
    const m0 = timeline[i - 2].packaging.motion;
    const m1 = timeline[i - 1].packaging.motion;
    const m2 = timeline[i].packaging.motion;
    if (m0 && m2 && m0 === m2 && m1 && m1 !== m0) thrashing += 1;
  }
  score -= Math.min(0.2, thrashing * 0.05);

  // Monotone cardType across long timelines
  const cardTypes = timeline.map((t) => t.packaging.cardType).filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (cardTypes.length >= 4 && new Set(cardTypes).size === 1) {
    score -= 0.15;
  }

  return round3(clamp01(score));
}

// ---------------------------------------------------------------------------
// visualScriptAlignment — does each script line reference its asset's
// visualContent cues (primarySubject / kinematicElements / detectedObjects)?
// When assets lack visualContent we degrade to motion-keyword presence.
// ---------------------------------------------------------------------------

const FALLBACK_MOTION_KEYWORDS = [
  '推近', '飞溅', '入画', '特写', '碎', '滴', '光斑', '托举', '旋转',
  '展示', '展开', '揭示', '聚焦', '滑入', '飞入'
];

export function computeVisualScriptAlignment(
  timeline: TimelineItem[],
  assets: AssetCard[] | undefined
): number {
  if (timeline.length === 0) return 0.7;
  if (!assets || assets.length === 0) {
    const hits = timeline.filter((t) => {
      const text = (t.visualAction + ' ' + t.script).toLowerCase();
      return FALLBACK_MOTION_KEYWORDS.some((w) => text.includes(w));
    }).length;
    return round3((hits / timeline.length) * 0.9);
  }

  const assetById = new Map(assets.map((a) => [a.id, a]));

  let total = 0;
  let counted = 0;

  for (const item of timeline) {
    if (!item.assetId) continue;
    const asset = assetById.get(item.assetId);
    if (!asset) continue;

    const cues = collectAssetCues(asset);
    if (cues.length === 0) continue;

    const blob = (item.script + ' ' + item.visualAction).toLowerCase();
    const cueHits = cues.filter((cue) => mentionsAnyChunk(blob, cue.toLowerCase())).length;
    const itemScore = cueHits > 0 ? Math.min(1, 0.5 + cueHits * 0.2) : 0.3;

    total += itemScore;
    counted += 1;
  }

  if (counted === 0) return 0.7;
  return round3(total / counted);
}

function collectAssetCues(asset: AssetCard): string[] {
  const cues: string[] = [];
  if (asset.visualContent) {
    cues.push(asset.visualContent.primarySubject);
    cues.push(...asset.visualContent.kinematicElements);
    if (asset.visualContent.lighting) cues.push(asset.visualContent.lighting);
  }
  cues.push(...asset.detectedObjects);
  return cues.filter((c) => c.length >= 2);
}

// ---------------------------------------------------------------------------
// transitionFidelity (unchanged from PR #31)
// ---------------------------------------------------------------------------

type PackagingTransition = NonNullable<TimelineItem['packaging']['transition']>;
type SourceTransition = Boundary['transitionType'];

const TRANSITION_FAMILY: Record<SourceTransition, 'hard' | 'soft' | 'motion' | null> = {
  cut: 'hard',
  fade: 'soft',
  dissolve: 'soft',
  morph: 'motion',
  wipe: 'motion',
  unknown: null
};

const PACKAGING_FAMILY: Record<PackagingTransition, 'hard' | 'soft' | 'motion'> = {
  quick_cut: 'hard',
  zoom_in: 'motion',
  push: 'motion',
  fade: 'soft'
};

function sameFamily(src: SourceTransition, planned: PackagingTransition | undefined): boolean {
  if (!planned) return false;
  const srcFam = TRANSITION_FAMILY[src];
  if (!srcFam) return false;
  return PACKAGING_FAMILY[planned] === srcFam;
}

function computeTransitionFidelity(
  timeline: TimelineItem[],
  boundaries: Boundary[] | undefined
): number | undefined {
  if (!boundaries?.length) return undefined;
  if (timeline.length === 0) return 0;
  const matches = boundaries.filter((b) => {
    const item = timeline.find((t) => t.sourceSegmentId === b.from);
    if (!item) return false;
    return sameFamily(b.transitionType, item.packaging.transition);
  }).length;
  return round3(matches / boundaries.length);
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

function round3(n: number): number {
  return Number(n.toFixed(3));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Returns true when `needle` appears in `haystack` directly, or when any
 * sliding 2-char CJK substring of `needle` does. Handles the case where the
 * model paraphrases a long Chinese selling point (e.g. "冰爽解腻" → "冰爽")
 * while still requiring a real overlap, not just a single character match.
 */
function mentionsAnyChunk(haystack: string, needle: string): boolean {
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  if (needle.length <= 2) return false;
  for (let i = 0; i + 2 <= needle.length; i++) {
    const chunk = needle.slice(i, i + 2);
    if (/^[一-鿿]{2}$/.test(chunk) && haystack.includes(chunk)) return true;
  }
  return false;
}
