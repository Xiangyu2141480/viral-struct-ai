import { z } from 'zod';
import type { SegmentRole } from './types';

/**
 * Closed packaging vocabulary — the design-system "skill" ported (as ORIGINAL code) from the leading
 * video-editing agents (taxonomy idea from editor-pro-max; props->fixed-template discipline from
 * short-video-maker; style-capture-and-replay from FireRed). The agent may only SELECT these ids; the
 * renderer resolves pixels from the registries below. This preserves the four-line spine + duty boundary:
 * LLM proposes an id -> schema validates it's known -> code applies the registry record -> verifier judges.
 *
 * Types are derived from the Zod enums (z.infer) so there is a single source of truth (no type/schema drift).
 */

export const CaptionStyleIdSchema = z.enum([
  'bold_pop_center',
  'clean_lower_third',
  'karaoke_highlight',
  'minimal_serif',
  'sticker_outline'
]);
export type CaptionStyleId = z.infer<typeof CaptionStyleIdSchema>;

export const CardTypeIdSchema = z.enum([
  'title_card',
  'selling_point_card',
  'comparison_card',
  'cta_card',
  'product_layout',
  'before_after_card',
  'subtitle_patch'
]);
export type CardTypeId = z.infer<typeof CardTypeIdSchema>;

export const TransitionIdSchema = z.enum(['quick_cut', 'zoom_in', 'push', 'fade', 'whip_pan', 'dip_to_color']);
export type TransitionId = z.infer<typeof TransitionIdSchema>;

export const MotionPresetIdSchema = z.enum(['static', 'push_in', 'pan', 'ken_burns', 'pop_scale', 'crop_zoom']);
export type MotionPresetId = z.infer<typeof MotionPresetIdSchema>;

export const ThemeIdSchema = z.enum(['high_click', 'high_conversion', 'premium', 'fast_pace']);
export type ThemeId = z.infer<typeof ThemeIdSchema>;

// ---- Renderer-resolvable parameter records (the renderer reads these, NEVER the model) ----

export interface CardStyleSpec {
  /** '0xRRGGBB' background fill for this card kind. */
  background: string;
  /** '0xRRGGBB' accent (bar/box/headline emphasis). */
  accent: string;
  fontWeight: 'regular' | 'bold' | 'black';
  safeArea: 'vertical' | 'center';
  maxHeadlineChars: number;
  maxBullets: number;
}

export interface CaptionStyleSpec {
  /** Multiplier applied to the renderer's base font size. */
  fontScale: number;
  /** '0xRRGGBB'. */
  primaryColour: string;
  outlineColour: string;
  outlineWidth: number;
  align: 'bottom_center' | 'center' | 'top';
  /** Vertical margin as a fraction of frame height. */
  marginVRatio: number;
}

export interface TransitionSpec {
  kind: 'cut' | 'fade' | 'slide' | 'zoom' | 'dip';
  durationMs: number;
  dipColour?: string;
}

export interface MotionPresetSpec {
  defaultDurationMs: number;
  minMs: number;
  maxMs: number;
  /** Normalised pan/zoom keyframes; the renderer interpolates by frame index (paused clock), never wall time. */
  from: { scale: number; x: number; y: number };
  to: { scale: number; x: number; y: number };
}

export const CARD_REGISTRY: Record<CardTypeId, CardStyleSpec> = {
  title_card: { background: '0x111827', accent: '0xe94560', fontWeight: 'black', safeArea: 'center', maxHeadlineChars: 18, maxBullets: 0 },
  selling_point_card: { background: '0x0f3460', accent: '0x53d8fb', fontWeight: 'bold', safeArea: 'vertical', maxHeadlineChars: 22, maxBullets: 3 },
  comparison_card: { background: '0x1b3a2e', accent: '0xffd400', fontWeight: 'bold', safeArea: 'center', maxHeadlineChars: 16, maxBullets: 4 },
  cta_card: { background: '0xe94560', accent: '0xffffff', fontWeight: 'black', safeArea: 'center', maxHeadlineChars: 16, maxBullets: 0 },
  product_layout: { background: '0x16213e', accent: '0x53d8fb', fontWeight: 'bold', safeArea: 'vertical', maxHeadlineChars: 24, maxBullets: 2 },
  before_after_card: { background: '0x2d2a4a', accent: '0xffd400', fontWeight: 'bold', safeArea: 'center', maxHeadlineChars: 16, maxBullets: 2 },
  subtitle_patch: { background: '0x222222', accent: '0xffffff', fontWeight: 'regular', safeArea: 'vertical', maxHeadlineChars: 28, maxBullets: 0 }
};

export const CAPTION_REGISTRY: Record<CaptionStyleId, CaptionStyleSpec> = {
  bold_pop_center: { fontScale: 1.25, primaryColour: '0xffffff', outlineColour: '0x000000', outlineWidth: 5, align: 'center', marginVRatio: 0.12 },
  clean_lower_third: { fontScale: 1.0, primaryColour: '0xffffff', outlineColour: '0x000000', outlineWidth: 3, align: 'bottom_center', marginVRatio: 0.1 },
  karaoke_highlight: { fontScale: 1.1, primaryColour: '0xffd400', outlineColour: '0x000000', outlineWidth: 4, align: 'bottom_center', marginVRatio: 0.12 },
  minimal_serif: { fontScale: 0.95, primaryColour: '0xffffff', outlineColour: '0x000000', outlineWidth: 2, align: 'bottom_center', marginVRatio: 0.08 },
  sticker_outline: { fontScale: 1.15, primaryColour: '0xffffff', outlineColour: '0xe94560', outlineWidth: 6, align: 'center', marginVRatio: 0.14 }
};

export const TRANSITION_REGISTRY: Record<TransitionId, TransitionSpec> = {
  quick_cut: { kind: 'cut', durationMs: 0 },
  zoom_in: { kind: 'zoom', durationMs: 250 },
  push: { kind: 'slide', durationMs: 300 },
  fade: { kind: 'fade', durationMs: 350 },
  whip_pan: { kind: 'slide', durationMs: 180 },
  dip_to_color: { kind: 'dip', durationMs: 300, dipColour: '0x000000' }
};

export const MOTION_REGISTRY: Record<MotionPresetId, MotionPresetSpec> = {
  static: { defaultDurationMs: 1500, minMs: 400, maxMs: 6000, from: { scale: 1, x: 0, y: 0 }, to: { scale: 1, x: 0, y: 0 } },
  push_in: { defaultDurationMs: 1500, minMs: 600, maxMs: 5000, from: { scale: 1, x: 0, y: 0 }, to: { scale: 1.12, x: 0, y: 0 } },
  pan: { defaultDurationMs: 2000, minMs: 800, maxMs: 6000, from: { scale: 1.1, x: -0.06, y: 0 }, to: { scale: 1.1, x: 0.06, y: 0 } },
  ken_burns: { defaultDurationMs: 2500, minMs: 1000, maxMs: 8000, from: { scale: 1, x: -0.04, y: -0.03 }, to: { scale: 1.18, x: 0.04, y: 0.03 } },
  pop_scale: { defaultDurationMs: 900, minMs: 300, maxMs: 2500, from: { scale: 0.92, x: 0, y: 0 }, to: { scale: 1.04, x: 0, y: 0 } },
  crop_zoom: { defaultDurationMs: 1500, minMs: 500, maxMs: 5000, from: { scale: 1.05, x: 0, y: 0 }, to: { scale: 1.2, x: 0, y: 0 } }
};

export interface RolePackaging {
  card: CardTypeId;
  caption: CaptionStyleId;
  transition: TransitionId;
  motion: MotionPresetId;
}

export interface ThemeSpec {
  roleBackground: Record<SegmentRole, string>;
  perRole: Record<SegmentRole, RolePackaging>;
}

function buildPerRole(caption: CaptionStyleId, motion: MotionPresetId, transition: TransitionId): Record<SegmentRole, RolePackaging> {
  const base: RolePackaging = { card: 'selling_point_card', caption, transition, motion };
  return {
    hook: { ...base, card: 'title_card' },
    pain_point: { ...base },
    selling_point: { ...base },
    proof: { ...base, card: 'before_after_card' },
    usage: { ...base, card: 'product_layout' },
    comparison: { ...base, card: 'comparison_card' },
    cta: { ...base, card: 'cta_card', motion: 'pop_scale' },
    // instructional roles (course/tutorial genre) reuse nearest ad packaging
    explanation: { ...base, card: 'title_card' },
    demonstration: { ...base },
    technique_step: { ...base, card: 'title_card' },
    context: { ...base }
  };
}

function palette(hook: string, pain: string, selling: string, proof: string, usage: string, comparison: string, cta: string): Record<SegmentRole, string> {
  return {
    hook, pain_point: pain, selling_point: selling, proof, usage, comparison, cta,
    // instructional roles reuse the semantically-nearest ad-role background
    explanation: selling, demonstration: usage, technique_step: proof, context: pain
  };
}

export const THEME_REGISTRY: Record<ThemeId, ThemeSpec> = {
  high_click: {
    roleBackground: palette('0x1a1a2e', '0x16213e', '0x0f3460', '0x533483', '0x1b4965', '0x5c3d2e', '0xe94560'),
    perRole: buildPerRole('bold_pop_center', 'push_in', 'quick_cut')
  },
  high_conversion: {
    roleBackground: palette('0x14213d', '0x1d3557', '0x0f3460', '0x2a4d69', '0x21577a', '0x4a3b2a', '0xd62828'),
    perRole: buildPerRole('clean_lower_third', 'push_in', 'push')
  },
  premium: {
    roleBackground: palette('0x0b0b10', '0x14141c', '0x1c1c28', '0x2a2438', '0x1b2330', '0x2e2a3a', '0x3a3a48'),
    perRole: buildPerRole('minimal_serif', 'ken_burns', 'fade')
  },
  fast_pace: {
    roleBackground: palette('0x22063b', '0x2b0a4d', '0x0f3460', '0x4a148c', '0x1b4965', '0x6a1b9a', '0xff2e63'),
    perRole: buildPerRole('sticker_outline', 'pop_scale', 'whip_pan')
  }
};

/**
 * Closed content spec the agent emits and the renderer consumes. `kind` is a subset of CardTypeId; the
 * renderer styles it via CARD_REGISTRY[kind]. Content shapes are explicit so the renderer never improvises.
 */
export const PackagingCardSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('title_card'), headline: z.string().min(1), subline: z.string().optional() }).strict(),
  z.object({ kind: z.literal('selling_point_card'), headline: z.string().min(1), bullets: z.array(z.string()).max(4) }).strict(),
  z.object({
    kind: z.literal('comparison_card'),
    leftLabel: z.string().min(1),
    rightLabel: z.string().min(1),
    rows: z.array(z.object({ before: z.string(), after: z.string() }).strict())
  }).strict(),
  z.object({ kind: z.literal('cta_card'), headline: z.string().min(1), cta: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('product_layout'), assetId: z.string().min(1), caption: z.string().optional() }).strict(),
  z.object({ kind: z.literal('subtitle_patch'), lines: z.array(z.string()) }).strict()
]);
export type PackagingCardSpec = z.infer<typeof PackagingCardSpecSchema>;

// ---- Loose-parse snap: map possibly-unknown model output to a known id, or report it's unknown ----

export function isKnownCardType(id: string): id is CardTypeId {
  return CardTypeIdSchema.safeParse(id).success;
}
export function isKnownCaptionStyle(id: string): id is CaptionStyleId {
  return CaptionStyleIdSchema.safeParse(id).success;
}
export function isKnownTransition(id: string): id is TransitionId {
  return TransitionIdSchema.safeParse(id).success;
}
export function isKnownMotionPreset(id: string): id is MotionPresetId {
  return MotionPresetIdSchema.safeParse(id).success;
}

/**
 * Motion as a PURE function of normalised progress p in [0,1] (frame index / total frames), so the ffmpeg
 * executor today and a HyperFrames executor later compute identical pixels. Never a function of wall-clock.
 */
export function motionTransform(preset: MotionPresetSpec, progress: number): { scale: number; x: number; y: number } {
  const p = Math.max(0, Math.min(1, progress));
  const lerp = (a: number, b: number) => a + (b - a) * p;
  return {
    scale: lerp(preset.from.scale, preset.to.scale),
    x: lerp(preset.from.x, preset.to.x),
    y: lerp(preset.from.y, preset.to.y)
  };
}
