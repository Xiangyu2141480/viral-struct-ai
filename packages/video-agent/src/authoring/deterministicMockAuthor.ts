import {
  AuthoredTimelineSchema,
  type AuthoredTimeline,
  type ContentBrief
} from '@viral-struct/shared';
import type { VideoEditContext } from '../context/VideoEditContext';
import { buildGapReports } from '../gap-fill/gapFillPlanner';
import type { GapReport } from '../gap-fill/GapFillPlan';
import {
  backgroundForRole,
  buildAssetIndex,
  mediaKindForAsset,
  normalizeAuthoredRole,
  paletteFor,
  renderProfileFor
} from './authoringHelpers';

/**
 * Deterministic, no-LLM author: turns a VideoEditContext (sample graph + new product brief + matched assets)
 * into a schema-valid AuthoredTimeline. It is the offline fallback (when no LLM key is wired) AND the unit-test
 * double. It is NOT the creative path — it is rule-based and reproducible (no clock, no randomness): one beat
 * per segment, a matched real asset becomes a Ken-Burns media layer, role-appropriate brief copy becomes the
 * headline, and a real-proof slot with no matching asset becomes an honest substitute (unresolvedReason set).
 * It NEVER fabricates proof and NEVER copies the sample's exact captions (it uses the new product's brief).
 */
export function deterministicMockAuthor(context: VideoEditContext): AuthoredTimeline {
  const graph = context.structureGraph;
  const brief = context.contentBrief;
  const palette = paletteFor(graph.meta?.style);
  const assetById = buildAssetIndex(context.assetCards);
  const matchBySlot = new Map(context.slotMatches.map((m) => [m.slotId, m]));
  const gapBySlot = new Map(buildGapReports(context).map((g) => [g.slotId, g]));

  const beats = graph.segments.map((seg, index) => {
    const slots = graph.shotSlots.filter((s) => s.segmentId === seg.id);
    const role = normalizeAuthoredRole(seg.role);

    // Pick the first matched, file-backed asset in this segment's slots.
    let mediaLayers: unknown[] = [];
    let hasRealMedia = false;
    for (const slot of slots) {
      const match = matchBySlot.get(slot.id);
      if (!match || match.status !== 'matched' || !match.assetId) continue;
      const card = assetById.get(match.assetId);
      if (!card || !card.url) continue;
      const kind = mediaKindForAsset(card);
      if (!kind) continue;
      const media: Record<string, unknown> = { id: `asset_${card.id}`, type: kind, assetId: card.id, resolvedPath: card.url };
      // Deterministic "best moment" for a long video: a centered window the length of the beat.
      if (kind === 'video') {
        const dur = card.analysis?.media?.durationSec;
        const beatLen = Math.max(0.1, seg.duration ?? 3);
        if (typeof dur === 'number' && dur > beatLen) {
          const startSec = (dur - beatLen) / 2;
          media.startSec = Number(startSec.toFixed(3));
          media.endSec = Number((startSec + beatLen).toFixed(3));
        }
      }
      mediaLayers = [
        {
          id: `media_${seg.id}`,
          media,
          fit: 'cover',
          zOrder: 0,
          opacity: 1,
          motion: kind === 'image' ? kenBurnsForIndex(index) : { kind: 'static', keyframes: [] },
          evidence: { tier: 'real', sourceAssetId: card.id }
        }
      ];
      hasRealMedia = true;
      break;
    }

    // Honesty: any real-proof slot left unmatched (and we have no real media) → honest substitute.
    const realProofUnmatched = slots.some((slot) => {
      const gap = gapBySlot.get(slot.id);
      const match = matchBySlot.get(slot.id);
      return Boolean(gap?.requiresRealProof) && (!match || match.status !== 'matched');
    });
    const unresolvedReason = !hasRealMedia && realProofUnmatched ? `real-proof slot(s) in ${seg.id} have no matching real asset` : undefined;

    const isHeadline = role === 'hook' || role === 'cta';
    const textElements = [
      {
        id: `text_${seg.id}`,
        type: isHeadline ? 'headline' : 'body',
        content: mockTextForRole(role, brief, index),
        stylePreset: isHeadline ? 'bold_pop_center' : 'clean_lower_third'
      }
    ];

    const startSeconds = Number.isFinite(seg.start) ? Math.max(0, seg.start) : index * 3;
    const endSeconds = seg.end > startSeconds ? seg.end : startSeconds + Math.max(1, seg.duration || 3);

    const beat: Record<string, unknown> = {
      id: `beat_${index + 1}`,
      segmentRole: role,
      startSeconds,
      endSeconds,
      mediaLayers,
      textElements,
      fallbackBackground: backgroundForRole(palette, role),
      transitionOut: { kind: 'cut' },
      paletteHint: palette,
      authorIntent: { pacePattern: graph.rhythm?.pattern, emotionalTone: seg.purpose?.slice(0, 60) }
    };
    if (unresolvedReason) beat.unresolvedReason = unresolvedReason;
    return beat;
  });

  const timeline = {
    schemaVersion: '1.0' as const,
    renderProfile: renderProfileFor(graph.meta?.aspectRatio ?? context.constraints.aspectRatio),
    beats,
    meta: { beatCount: beats.length, productName: brief.productName, theme: palette },
    metadata: { authorPrompt: 'deterministic_mock_no_llm_call', model: 'mock' }
  };

  return AuthoredTimelineSchema.parse(timeline);
}

/** Alternate zoom-in / zoom-out by beat so a slideshow of stills has visual variety (not all-identical motion). */
function kenBurnsForIndex(index: number): { kind: string; keyframes: Array<{ progress: number; scale: number; x: number; y: number }> } {
  return index % 2 === 0
    ? { kind: 'ken_burns', keyframes: [{ progress: 0, scale: 1, x: 0, y: 0 }, { progress: 1, scale: 1.12, x: 0, y: 0 }] }
    : { kind: 'ken_burns', keyframes: [{ progress: 0, scale: 1.12, x: 0, y: 0 }, { progress: 1, scale: 1, x: 0, y: 0 }] };
}

/** Role-appropriate copy from the NEW product's brief — never the sample's exact words. */
function mockTextForRole(role: string, brief: ContentBrief, index: number): string[] {
  const points = brief.sellingPoints.length > 0 ? brief.sellingPoints : [brief.productName];
  switch (role) {
    case 'hook':
      return [brief.productName];
    case 'cta':
      return [brief.cta || '立即了解'];
    case 'pain_point':
    case 'selling_point':
    case 'proof':
    case 'comparison':
    case 'usage':
      return [points[index % points.length] ?? brief.productName];
    default:
      return [brief.productName];
  }
}
