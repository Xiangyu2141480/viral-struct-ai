import { z } from 'zod';
import { ThemeIdSchema } from './packagingVocabulary';

/**
 * AuthoredComposition — the keystone spec of the CREATIVE video-producer rewrite.
 *
 * The LLM AUTHORS this per beat (it is the creative act — it freely composes real media, motion, text,
 * and transitions); the renderer EXECUTES it deterministically into real pixels. It replaces the old
 * "pick one of 7 closed cards + paint a solid colour block" model. The closed packaging vocabulary is
 * DEMOTED to a palette (house-style defaults via `paletteHint`/stylePreset) + a canonicalizer the validator
 * snaps unsafe output back into — never a hard ceiling.
 *
 * Designed via a 4-lens design panel (authorability / ffmpeg-renderability / honesty-enforceability /
 * portability) + adversarial critique. The critique's required fixes are baked in here:
 *   - no `easing` (ffmpeg has no native easing — linear only; pre-interpolate keyframes if ever needed);
 *   - no per-text frame fades (libass can't do them cheaply);
 *   - honesty is a SINGLE source of truth: `evidence.tier === 'unresolved'` (or `unresolvedReason`) forces the
 *     honest-substitute look at PAINT TIME, non-overridable — there is no separate `forceHonestSubstitute` flag;
 *   - AIGC image-to-video requires a burned `disclosureText` (honesty is enforced, not aspirational);
 *   - a single `paletteHint` (ThemeId) instead of a 4-field packaging hint;
 *   - motion / position / custom-style are range-validated (the renderer additionally clamps motion on-canvas).
 *
 * Renderer-neutral: motion is frame-indexed (progress = frameIndex / totalFrames ∈ [0,1], never wall-clock),
 * positions are normalized [0,1], colours are '0xRRGGBB' — so an ffmpeg executor today and a HyperFrames
 * executor later compute identical pixels. Types are derived from the Zod schemas (single source of truth).
 */

const ColourToken = z.string().regex(/^0x[0-9a-fA-F]{6}$/, 'expected a 0xRRGGBB colour token');

// ---- Evidence (honesty is structural, declared per visual element) ----

export const EvidenceTierSchema = z.enum(['real', 'attributed', 'derivative', 'unresolved']);
export type EvidenceTier = z.infer<typeof EvidenceTierSchema>;

export const EvidenceMetadataSchema = z
  .object({
    /** real = a matched real asset; attributed = real with a cited source; derivative = a transform of real
     *  (e.g. Ken-Burns / honesty-safe image-to-video on a real photo); unresolved = evidence missing → substitute. */
    tier: EvidenceTierSchema,
    sourceAssetId: z.string().optional(),
    attribution: z.string().optional(),
    derivedFrom: z.string().optional(),
    confidence: z.number().min(0).max(1).optional()
  })
  .strict();
export type EvidenceMetadata = z.infer<typeof EvidenceMetadataSchema>;

// ---- Motion (frame-indexed, deterministic; linear interpolation between keyframes) ----

export const MotionKindSchema = z.enum(['static', 'ken_burns', 'crop_zoom', 'pan', 'push_in', 'pop_scale', 'custom']);
export type MotionKind = z.infer<typeof MotionKindSchema>;

export const MotionKeyframeSchema = z
  .object({
    progress: z.number().min(0).max(1),
    /** >=1 zooms IN (crop a 1/scale window and scale up). The renderer clamps pan so the crop stays on-canvas. */
    scale: z.number().min(1).max(3),
    /** normalized pan of the crop centre, -1..1 (renderer clamps to the valid on-canvas range for `scale`). */
    x: z.number().min(-1).max(1),
    y: z.number().min(-1).max(1)
  })
  .strict();
export type MotionKeyframe = z.infer<typeof MotionKeyframeSchema>;

export const MotionSpecSchema = z
  .object({
    kind: MotionKindSchema,
    keyframes: z.array(MotionKeyframeSchema).max(8).default([]),
    durationMs: z.number().positive().optional()
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.kind === 'static') return;
    if (m.keyframes.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `motion '${m.kind}' needs at least 2 keyframes` });
      return;
    }
    const first = m.keyframes[0];
    const last = m.keyframes[m.keyframes.length - 1];
    if (first && first.progress !== 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'first keyframe progress must be 0' });
    if (last && last.progress !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'last keyframe progress must be 1' });
  });
export type MotionSpec = z.infer<typeof MotionSpecSchema>;

// ---- Media (real image / video clip / honesty-safe AIGC image-to-video) ----

export const MediaSourceKindSchema = z.enum(['image', 'video', 'aigc_image_to_video']);
export type MediaSourceKind = z.infer<typeof MediaSourceKindSchema>;

export const MediaAssetSchema = z
  .object({
    id: z.string().min(1),
    type: MediaSourceKindSchema,
    /** Logical asset id (AssetCard.id / library id). */
    assetId: z.string().min(1),
    /** Concrete file the renderer reads. For image/video = the asset file; for AIGC = the pre-rendered output
     *  (AIGC is a PRE-RENDER step, not a render-time call). Absent ⇒ the renderer treats it as unresolved. */
    resolvedPath: z.string().optional(),
    startSec: z.number().min(0).optional(),
    endSec: z.number().min(0).optional(),
    aigcProvider: z.string().optional(),
    aigcMotionPrompt: z.string().optional(),
    /** Burned-in AIGC disclosure (e.g. '【AI 生成动画】'). REQUIRED for aigc_image_to_video — honesty is enforced. */
    disclosureText: z.string().optional()
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.type === 'aigc_image_to_video' && !a.disclosureText) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'aigc_image_to_video requires disclosureText (burned AIGC watermark)' });
    }
  });
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const FitModeSchema = z.enum(['cover', 'contain', 'fill']);
export type FitMode = z.infer<typeof FitModeSchema>;

export const MediaLayerSchema = z
  .object({
    id: z.string().min(1),
    media: MediaAssetSchema,
    fit: FitModeSchema.default('cover'),
    /** 0 = background; higher = nearer the viewer. Layers paint in ascending zOrder. */
    zOrder: z.number().int().min(0).max(100).default(0),
    position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict().optional(),
    opacity: z.number().min(0).max(1).default(1),
    motion: MotionSpecSchema.optional(),
    evidence: EvidenceMetadataSchema
  })
  .strict();
export type MediaLayer = z.infer<typeof MediaLayerSchema>;

// ---- Text (authored directly, not embedded in a fixed card) ----

export const TextElementTypeSchema = z.enum(['headline', 'body', 'annotation', 'honest_marker']);
export type TextElementType = z.infer<typeof TextElementTypeSchema>;

export const CaptionStylePresetSchema = z.enum([
  'bold_pop_center',
  'clean_lower_third',
  'karaoke_highlight',
  'minimal_serif',
  'sticker_outline',
  'custom'
]);
export type CaptionStylePreset = z.infer<typeof CaptionStylePresetSchema>;

export const CustomTextStyleSchema = z
  .object({
    fontScale: z.number().min(0.5).max(3).optional(),
    primaryColour: ColourToken.optional(),
    outlineColour: ColourToken.optional(),
    outlineWidth: z.number().min(0).max(12).optional(),
    align: z.enum(['top', 'center', 'bottom_center']).optional(),
    marginVRatio: z.number().min(0).max(1).optional()
  })
  .strict();
export type CustomTextStyle = z.infer<typeof CustomTextStyleSchema>;

export const TextElementSchema = z
  .object({
    id: z.string().min(1),
    type: TextElementTypeSchema,
    content: z.array(z.string()).min(1),
    stylePreset: CaptionStylePresetSchema.optional(),
    customStyle: CustomTextStyleSchema.optional(),
    zOrder: z.number().int().min(0).max(100).default(10),
    /** Required when the text makes a factual claim (claim-binding lint binds it to a source asset). */
    evidence: EvidenceMetadataSchema.optional()
  })
  .strict()
  .superRefine((t, ctx) => {
    if (t.stylePreset === 'custom' && (!t.customStyle || Object.keys(t.customStyle).length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stylePreset 'custom' requires a non-empty customStyle" });
    }
  });
export type TextElement = z.infer<typeof TextElementSchema>;

// ---- Transition (applied at the beat boundary; ffmpeg xfade/concat) ----

export const TransitionKindSchema = z.enum(['cut', 'fade', 'slide', 'zoom', 'dip']);
export type TransitionKind = z.infer<typeof TransitionKindSchema>;

export const BeatTransitionSpecSchema = z
  .object({
    kind: TransitionKindSchema,
    durationMs: z.number().min(0).max(2000).optional(),
    dipColour: ColourToken.optional()
  })
  .strict();
export type BeatTransitionSpec = z.infer<typeof BeatTransitionSpecSchema>;

// ---- Beat + timeline ----

export const AuthoredSegmentRoleSchema = z.enum([
  'hook',
  'pain_point',
  'selling_point',
  'proof',
  'usage',
  'comparison',
  'cta',
  'explanation',
  'demonstration',
  'technique_step',
  'context'
]);
export type AuthoredSegmentRole = z.infer<typeof AuthoredSegmentRoleSchema>;

export const AuthoredCompositionSchema = z
  .object({
    id: z.string().min(1),
    segmentRole: AuthoredSegmentRoleSchema,
    startSeconds: z.number().min(0),
    endSeconds: z.number().positive(),
    /** Bottom-to-top real media composited into the frame (empty ⇒ a pure text/colour card, which is fine). */
    mediaLayers: z.array(MediaLayerSchema).max(8).default([]),
    textElements: z.array(TextElementSchema).max(8).default([]),
    /** Background when there is no opaque media covering the frame; defaults from the palette/role. */
    fallbackBackground: ColourToken.optional(),
    transitionOut: BeatTransitionSpecSchema.optional(),
    /** Set by the author/verifier when a real-evidence slot could not be filled → forces honest substitute. */
    unresolvedReason: z.string().optional(),
    /** House-style palette (ThemeId) the renderer resolves defaults from; the author may override per element. */
    paletteHint: ThemeIdSchema.optional(),
    /** Audit/reflection only — does not affect rendering (powers the editor + explainability). */
    authorIntent: z
      .object({
        visualTheme: z.string().optional(),
        emotionalTone: z.string().optional(),
        focusElement: z.string().optional(),
        pacePattern: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict()
  .superRefine((b, ctx) => {
    if (b.endSeconds <= b.startSeconds) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'endSeconds must be greater than startSeconds' });
    }
  });
export type AuthoredComposition = z.infer<typeof AuthoredCompositionSchema>;

export const AuthoredRenderProfileSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    format: z.literal('mp4')
  })
  .strict();
export type AuthoredRenderProfile = z.infer<typeof AuthoredRenderProfileSchema>;

export const AuthoredTimelineSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    renderProfile: AuthoredRenderProfileSchema,
    beats: z.array(AuthoredCompositionSchema).min(1),
    meta: z
      .object({
        totalDurationMs: z.number().optional(),
        beatCount: z.number().optional(),
        productName: z.string().optional(),
        theme: z.string().optional()
      })
      .strict()
      .optional(),
    metadata: z
      .object({
        authorPrompt: z.string().optional(),
        model: z.string().optional(),
        generatedAt: z.string().optional()
      })
      .strict()
      .optional()
  })
  .strict();
export type AuthoredTimeline = z.infer<typeof AuthoredTimelineSchema>;

// ---- Honest-substitute constants + the single honesty predicate (paint-time, non-overridable) ----

export const HONEST_SUBSTITUTE = {
  background: '0x1b4965',
  markerText: '（替代卡片 · 素材缺失）',
  markerColour: '0xffd400'
} as const;

/**
 * The single source of truth for honesty enforcement. When true, the renderer MUST paint the honest-substitute
 * look (teal background + yellow 「替代卡片 · 素材缺失」 marker) regardless of how the author styled the beat —
 * styling can never mask missing evidence. Triggered by an explicit `unresolvedReason` or any element whose
 * evidence tier is 'unresolved'.
 */
export function beatIsUnresolved(beat: AuthoredComposition): boolean {
  if (beat.unresolvedReason) return true;
  if (beat.mediaLayers.some((layer) => layer.evidence.tier === 'unresolved')) return true;
  if (beat.textElements.some((text) => text.evidence?.tier === 'unresolved')) return true;
  return false;
}

/** A media layer whose concrete file is missing cannot show real pixels → treat as unresolved at compile time. */
export function mediaLayerIsRenderable(layer: MediaLayer): boolean {
  return layer.evidence.tier !== 'unresolved' && typeof layer.media.resolvedPath === 'string' && layer.media.resolvedPath.length > 0;
}
