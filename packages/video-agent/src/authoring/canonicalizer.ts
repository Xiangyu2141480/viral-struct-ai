import { AuthoredTimelineSchema, type AuthoredTimeline } from '@viral-struct/shared';
import type { VideoEditContext } from '../context/VideoEditContext';
import { backgroundForRole, buildAssetIndex, mediaKindForAsset, normalizeAuthoredRole, paletteFor, renderProfileFor } from './authoringHelpers';

export interface CanonicalizeResult {
  timeline: AuthoredTimeline;
  log: string[];
}

/**
 * Repairs raw LLM output into a schema-valid, HONEST AuthoredTimeline. The LLM "proposes"; this is the
 * "code applies" rung. Key repairs: tolerant JSON extraction; resolve media.assetId -> real file path (unknown
 * asset -> unresolved); AIGC in a real-proof context -> unresolved (the honesty gate the schema alone can't
 * enforce); clamp motion/opacity/zOrder; default fit/evidence; force unresolvedReason when any layer is
 * unresolved. Throws only if the result still fails the schema after repair.
 */
export function canonicalizeAuthoredTimeline(raw: unknown, context: VideoEditContext): CanonicalizeResult {
  const log: string[] = [];
  const obj = coerceObject(raw, log);
  const assetById = buildAssetIndex(context.assetCards);
  const palette = paletteFor(context.structureGraph.meta?.style);
  const profile = renderProfileFor(context.structureGraph.meta?.aspectRatio ?? context.constraints.aspectRatio);

  const rawBeats = Array.isArray(obj.beats) ? obj.beats : [];
  const beats = rawBeats.map((b, i) => canonicalizeBeat(b, i, assetById, palette, log));

  const candidate: Record<string, unknown> = {
    schemaVersion: '1.0',
    renderProfile: isObject(obj.renderProfile) ? obj.renderProfile : profile,
    beats
  };
  if (isObject(obj.meta)) candidate.meta = obj.meta;
  if (isObject(obj.metadata)) candidate.metadata = obj.metadata;

  const parsed = AuthoredTimelineSchema.safeParse(candidate);
  if (parsed.success) return { timeline: parsed.data, log };

  const issues = parsed.error.issues.slice(0, 6).map((iss) => `${iss.path.join('.')}: ${iss.message}`).join('; ');
  throw new Error(`canonicalize: timeline invalid after repair: ${issues}`);
}

function canonicalizeBeat(rawBeat: unknown, index: number, assetById: Map<string, VideoEditContext['assetCards'][number]>, palette: ReturnType<typeof paletteFor>, log: string[]): Record<string, unknown> {
  const b = isObject(rawBeat) ? rawBeat : {};
  const role = normalizeAuthoredRole(String(b.segmentRole ?? 'selling_point'));
  const id = typeof b.id === 'string' && b.id ? b.id : `beat_${index + 1}`;

  let start = num(b.startSeconds, index * 3);
  let end = num(b.endSeconds, start + 3);
  if (start < 0) start = 0;
  if (end <= start) {
    end = start + 3;
    log.push(`${id}: endSeconds<=startSeconds, defaulted to +3s`);
  }

  const requiresRealProof = roleRequiresRealProof(role);
  let forcedUnresolved = false;
  const markUnresolved = () => {
    forcedUnresolved = true;
  };

  const rawLayers = Array.isArray(b.mediaLayers) ? b.mediaLayers : [];
  const mediaLayers = rawLayers
    .map((l, j) => canonicalizeLayer(l, id, j, assetById, requiresRealProof, markUnresolved, log))
    .filter((l): l is Record<string, unknown> => l !== null);

  const rawTexts = Array.isArray(b.textElements) ? b.textElements : [];
  const textElements = rawTexts.map((t, j) => canonicalizeText(t, id, j)).filter((t): t is Record<string, unknown> => t !== null);

  const beat: Record<string, unknown> = {
    id,
    segmentRole: role,
    startSeconds: start,
    endSeconds: end,
    mediaLayers,
    textElements,
    fallbackBackground: typeof b.fallbackBackground === 'string' && /^0x[0-9a-fA-F]{6}$/.test(b.fallbackBackground) ? b.fallbackBackground : backgroundForRole(palette, role),
    transitionOut: isObject(b.transitionOut) && typeof b.transitionOut.kind === 'string' ? b.transitionOut : { kind: 'cut' },
    paletteHint: palette
  };
  const reason = typeof b.unresolvedReason === 'string' ? b.unresolvedReason : undefined;
  if (reason) beat.unresolvedReason = reason;
  else if (forcedUnresolved) beat.unresolvedReason = 'evidence unresolved (canonicalizer)';
  return beat;
}

function canonicalizeLayer(
  rawLayer: unknown,
  beatId: string,
  j: number,
  assetById: Map<string, VideoEditContext['assetCards'][number]>,
  requiresRealProof: boolean,
  markUnresolved: () => void,
  log: string[]
): Record<string, unknown> | null {
  if (!isObject(rawLayer)) return null;
  const media = isObject(rawLayer.media) ? { ...rawLayer.media } : {};
  const assetId = typeof media.assetId === 'string' ? media.assetId : undefined;
  const card = assetId ? assetById.get(assetId) : undefined;
  let type = typeof media.type === 'string' ? media.type : 'image';
  const evidence: Record<string, unknown> = isObject(rawLayer.evidence) ? { ...rawLayer.evidence } : {};

  if (card && card.url) {
    media.resolvedPath = card.url;
    if (type !== 'aigc_image_to_video') type = mediaKindForAsset(card) ?? type;
  } else if (assetId) {
    log.push(`${beatId}: unknown assetId '${assetId}' -> unresolved`);
    evidence.tier = 'unresolved';
    markUnresolved();
  }

  // Honesty gate the schema can't enforce: AIGC in a real-proof context becomes unresolved.
  if (type === 'aigc_image_to_video' && requiresRealProof) {
    log.push(`${beatId}: AIGC in real-proof context -> unresolved`);
    evidence.tier = 'unresolved';
    markUnresolved();
  }
  if (type === 'aigc_image_to_video' && (typeof media.disclosureText !== 'string' || media.disclosureText.trim() === '')) {
    media.disclosureText = '【AI 生成动画】';
  }
  media.type = type;
  if (typeof media.id !== 'string' || !media.id) media.id = `asset_${assetId ?? `${beatId}_${j}`}`;
  if (typeof media.assetId !== 'string' || !media.assetId) media.assetId = assetId ?? `${beatId}_${j}`;

  if (typeof evidence.tier !== 'string') evidence.tier = media.resolvedPath ? 'real' : 'unresolved';
  if (evidence.tier === 'unresolved') markUnresolved();

  // A non-AIGC layer with no real file cannot show pixels — drop it (the beat falls back to bg / substitute).
  if (!media.resolvedPath && type !== 'aigc_image_to_video') return null;

  const layer: Record<string, unknown> = {
    id: typeof rawLayer.id === 'string' && rawLayer.id ? rawLayer.id : `media_${beatId}_${j}`,
    media,
    fit: ['cover', 'contain', 'fill'].includes(String(rawLayer.fit)) ? rawLayer.fit : 'cover',
    zOrder: clampInt(rawLayer.zOrder, 0, 100, 0),
    opacity: clamp(rawLayer.opacity, 0, 1, 1),
    evidence
  };
  if (isObject(rawLayer.position)) {
    layer.position = { x: clamp(rawLayer.position.x, 0, 1, 0.5), y: clamp(rawLayer.position.y, 0, 1, 0.5) };
  }
  const motion = canonicalizeMotion(rawLayer.motion);
  if (motion) layer.motion = motion;
  return layer;
}

function canonicalizeMotion(rawMotion: unknown): Record<string, unknown> | null {
  if (!isObject(rawMotion)) return null;
  const kinds = ['static', 'ken_burns', 'crop_zoom', 'pan', 'push_in', 'pop_scale', 'custom'];
  const kind = kinds.includes(String(rawMotion.kind)) ? String(rawMotion.kind) : 'static';
  if (kind === 'static') return { kind: 'static', keyframes: [] };
  const rawKf = Array.isArray(rawMotion.keyframes) ? rawMotion.keyframes : [];
  let keyframes = rawKf
    .filter(isObject)
    .map((k) => ({ progress: clamp(k.progress, 0, 1, 0), scale: clamp(k.scale, 1, 3, 1), x: clamp(k.x, -1, 1, 0), y: clamp(k.y, -1, 1, 0) }));
  if (keyframes.length < 2) keyframes = [{ progress: 0, scale: 1, x: 0, y: 0 }, { progress: 1, scale: 1.1, x: 0, y: 0 }];
  keyframes[0] = { ...keyframes[0]!, progress: 0 };
  keyframes[keyframes.length - 1] = { ...keyframes[keyframes.length - 1]!, progress: 1 };
  return { kind, keyframes };
}

function canonicalizeText(rawText: unknown, beatId: string, j: number): Record<string, unknown> | null {
  if (!isObject(rawText)) return null;
  const content = Array.isArray(rawText.content)
    ? rawText.content.map((c) => String(c)).filter((c) => c.trim().length > 0)
    : typeof rawText.content === 'string' && rawText.content.trim()
      ? [rawText.content]
      : [];
  if (content.length === 0) return null;
  const types = ['headline', 'body', 'annotation', 'honest_marker'];
  const text: Record<string, unknown> = {
    id: typeof rawText.id === 'string' && rawText.id ? rawText.id : `text_${beatId}_${j}`,
    type: types.includes(String(rawText.type)) ? rawText.type : 'body',
    content
  };
  const presets = ['bold_pop_center', 'clean_lower_third', 'karaoke_highlight', 'minimal_serif', 'sticker_outline', 'custom'];
  if (presets.includes(String(rawText.stylePreset)) && rawText.stylePreset !== 'custom') text.stylePreset = rawText.stylePreset;
  return text;
}

// proof-bearing roles require real evidence (heuristic: the canonicalizer can't see per-slot gap reports per beat).
function roleRequiresRealProof(role: string): boolean {
  return role === 'proof' || role === 'comparison';
}

function coerceObject(raw: unknown, log: string[]): Record<string, unknown> {
  if (isObject(raw)) return raw;
  if (typeof raw === 'string') {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        if (isObject(parsed)) return parsed;
      } catch {
        log.push('coerce: failed to JSON.parse LLM output');
      }
    }
    log.push('coerce: LLM output was not a JSON object');
  }
  return {};
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clamp(value, min, max, fallback));
}
