import { z } from 'zod';

/**
 * AIGC video-generation contract (Wan2.7 / Aliyun DashScope).
 *
 * A {@link WanJob} is ONE video-generation request derived by the AIGC helper from a single Director beat.
 * Building a WanJob is **plan-only** — it never calls the model. The `wanVideoClient` submits it.
 * Zod is the source of truth; the TS types are derived (mirrors authoredComposition / orchestratedTimeline).
 */

export const WanModelSchema = z.enum(['wan2.7-r2v', 'wan2.7-i2v', 'wan2.7-videoedit', 'wan2.7-t2v']);
export type WanModel = z.infer<typeof WanModelSchema>;

/**
 * Media role inside a Wan request. `reference_image` / `reference_video` (r2v), `first_frame` (i2v),
 * `video_edit_source` (videoedit — the clip to be edited; the client maps this to DashScope's wire name `video`).
 */
export const WanMediaTypeSchema = z.enum(['reference_image', 'reference_video', 'first_frame', 'video_edit_source']);
export type WanMediaType = z.infer<typeof WanMediaTypeSchema>;

export const WanMediaSchema = z
  .object({
    type: WanMediaTypeSchema,
    /** A local file path, public URL, oss:// temp URL, or data: URI. Local paths are resolved by the client. */
    url: z.string()
  })
  .strict();
export type WanMedia = z.infer<typeof WanMediaSchema>;

export const WanAspectRatioSchema = z.enum(['9:16', '16:9', '1:1', '4:3', '3:4']);
export type WanAspectRatio = z.infer<typeof WanAspectRatioSchema>;

export const WanParametersSchema = z
  .object({
    resolution: z.enum(['720P', '1080P']),
    ratio: WanAspectRatioSchema,
    /** Seconds. Integer only (DashScope rejects fractions). Clamped per-model by the helper. */
    duration: z.number().int().min(2).max(15),
    promptExtend: z.boolean(),
    /** Burn an "AI生成" disclosure (honesty). */
    watermark: z.boolean(),
    seed: z.number().int().min(0).max(2147483647).optional()
  })
  .strict();
export type WanParameters = z.infer<typeof WanParametersSchema>;

export const WanJobSchema = z
  .object({
    beatId: z.string(),
    model: WanModelSchema,
    prompt: z.string(),
    negativePrompt: z.string().optional(),
    /** Reference / source media. Empty for t2v. */
    media: z.array(WanMediaSchema),
    parameters: WanParametersSchema
  })
  .strict();
export type WanJob = z.infer<typeof WanJobSchema>;

/**
 * Per-beat decision from the AIGC helper: reuse a matched real clip verbatim, or generate via a {@link WanJob}.
 * `index` + `startMs`/`endMs` preserve timeline order for stitching.
 */
export const AigcBeatPlanSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('real_clip'),
      beatId: z.string(),
      index: z.number().int().min(0),
      startMs: z.number().min(0),
      endMs: z.number().min(0),
      /** On-disk path / url of the matched real video, used as-is (no generation). */
      clipUrl: z.string()
    })
    .strict(),
  z
    .object({
      kind: z.literal('generate'),
      beatId: z.string(),
      index: z.number().int().min(0),
      startMs: z.number().min(0),
      endMs: z.number().min(0),
      job: WanJobSchema,
      /** Partial beats: fall back to this real clip if generation fails. */
      fallbackClipUrl: z.string().optional()
    })
    .strict()
]);
export type AigcBeatPlan = z.infer<typeof AigcBeatPlanSchema>;
