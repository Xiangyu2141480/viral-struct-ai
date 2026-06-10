import type {
  AigcBeatPlan,
  AigcOption,
  AssetCard,
  GapResolutionOption,
  OrchestratedSlot,
  OrchestratedTimeline,
  WanAspectRatio,
  WanJob,
  WanMedia,
  WanModel
} from '@viral-struct/shared';

/**
 * AIGC Helper (pure, no IO).
 *
 * Turns a Director `OrchestratedTimeline` into one {@link AigcBeatPlan} per slot, routing each beat by its
 * asset-fit to the right Wan2.7 model (see docs/aigc-helper-video-pipeline.md §3):
 *
 *   - matched real **video**            → reuse the clip verbatim (no generation)
 *   - partial / enhance, matched image  → `wan2.7-r2v`        (参考重绘)
 *   - partial / enhance, matched video  → `wan2.7-videoedit`  (视频修改)
 *   - true gap (+ product image)        → `wan2.7-r2v`        (产品图参考)
 *   - true gap (no product image)       → `wan2.7-t2v`        (纯文生视频，兜底)
 *
 * Every generated beat is anchored to the real product (reference image) — never fabricates the product.
 */

export interface PlanAigcBeatsInput {
  timeline: OrchestratedTimeline;
  assetCards: AssetCard[];
  /** Global product reference image (path / url). Anchors every generated beat to the real product. */
  productImageUrl?: string;
  productName?: string;
  resolution?: '720P' | '1080P';
  /** Burn an "AI生成" disclosure into generated beats (honesty). Default true. */
  aigcDisclosure?: boolean;
}

type Route = 'real_clip' | WanModel;

const MODEL_DURATION_MAX: Record<WanModel, number> = {
  'wan2.7-r2v': 15,
  'wan2.7-i2v': 15,
  'wan2.7-t2v': 15,
  'wan2.7-videoedit': 10
};
const DURATION_MIN = 2;
const MAX_REFERENCE_MEDIA = 5;
const DEFAULT_NEGATIVE = '低分辨率、模糊、畸变、多余手指、错误比例、杂乱背景、文字乱码';

export function planAigcBeats(input: PlanAigcBeatsInput): AigcBeatPlan[] {
  const byId = new Map(input.assetCards.map((card) => [card.id, card]));
  const resolution = input.resolution ?? '720P';
  const ratio = normalizeRatio(input.timeline.renderProfile.aspectRatio);
  const disclosure = input.aigcDisclosure ?? true;

  return input.timeline.slots.map((slot, index) => {
    const base = { beatId: slot.slotId, index, startMs: slot.startMs, endMs: slot.endMs };
    const matched = slot.fill.kind === 'matched' ? byId.get(slot.fill.assetId) : undefined;
    const route = routeModel(slot, matched);

    if (route === 'real_clip') {
      return { kind: 'real_clip', ...base, clipUrl: matched!.url! } satisfies AigcBeatPlan;
    }

    const job = buildWanJob({ slot, model: route, matched, input, ratio, resolution, disclosure });
    const fallbackClipUrl = matched?.type === 'video' ? matched.url : undefined;
    return {
      kind: 'generate',
      ...base,
      job,
      ...(fallbackClipUrl ? { fallbackClipUrl } : {})
    } satisfies AigcBeatPlan;
  });
}

function routeModel(slot: OrchestratedSlot, matched?: AssetCard): Route {
  // Fully matched real VIDEO → use as-is, never regenerate.
  if (slot.fillStatus === 'matched' && matched?.type === 'video' && matched.url) {
    return 'real_clip';
  }
  // Partial / needs-enhancement with a usable matched asset → enhance via generation.
  if (matched?.url) {
    if (matched.type === 'video') return 'wan2.7-videoedit'; // 视频修改
    if (matched.type === 'image') return 'wan2.7-r2v'; //         图 → 参考重绘
  }
  // True gap: r2v anchored to the product image; t2v only when no product reference exists at all.
  return 'wan2.7-r2v';
}

interface BuildJobArgs {
  slot: OrchestratedSlot;
  model: WanModel;
  matched?: AssetCard;
  input: PlanAigcBeatsInput;
  ratio: WanAspectRatio;
  resolution: '720P' | '1080P';
  disclosure: boolean;
}

function buildWanJob(args: BuildJobArgs): WanJob {
  const { slot, input, ratio, resolution, disclosure } = args;
  // t2v fallback only if a gap has no product image to anchor on.
  const model =
    args.model === 'wan2.7-r2v' && slotIsGap(slot) && !input.productImageUrl && !args.matched
      ? 'wan2.7-t2v'
      : args.model;

  const durationSec = clampDuration(Math.round((slot.endMs - slot.startMs) / 1000), model);
  const media = buildMedia(slot, model, args.matched, input);

  return {
    beatId: slot.slotId,
    model,
    prompt: buildPrompt(slot, model, input.productName),
    negativePrompt: DEFAULT_NEGATIVE,
    media,
    parameters: {
      resolution,
      ratio,
      duration: durationSec,
      promptExtend: false,
      watermark: disclosure
    }
  };
}

function slotIsGap(slot: OrchestratedSlot): boolean {
  return slot.fill.kind === 'gap' || slot.fillStatus === 'missing_generation_required';
}

function slotOptions(slot: OrchestratedSlot): GapResolutionOption[] {
  return (slot.fill.kind === 'gap' ? slot.fill.options : slot.fill.options) ?? [];
}

function findAigc(slot: OrchestratedSlot): AigcOption | undefined {
  return slotOptions(slot).find((o): o is AigcOption => o.id === 'aigc');
}

/**
 * The director's TARGET effect for the beat. `aigc.prompt` is the creative target that BOTH routes aim at —
 * generate (r2v/t2v) and edit (videoedit) differ only in how {@link buildPrompt} frames it. `hyperframes` is a
 * separate (non-AIGC) channel, so it is not consumed here; the slot intent fields are the only fallbacks.
 */
function beatGuidance(slot: OrchestratedSlot): string {
  return (
    findAigc(slot)?.prompt ??
    slot.transferableIntent ??
    slot.compressionBeat?.targetEquivalentBeat ??
    slot.sourceIntent ??
    slot.role
  );
}

function buildPrompt(slot: OrchestratedSlot, model: WanModel, productName?: string): string {
  const guidance = beatGuidance(slot);
  const name = productName?.trim();
  if (model === 'wan2.7-videoedit') {
    // Edit, don't regenerate: the real clip is the base, aigc.prompt is only the TARGET look to move toward.
    const subject = name ? `「${name}」` : '这段';
    return `保留原片${subject}镜头的主体、构图、运动与场景内容不变，仅在此基础上增强画质、光影、质感与氛围，使其向以下目标效果靠拢；不要替换、重绘或新增画面主体与场景。目标效果：${guidance}`;
  }
  // r2v / t2v / i2v — anchor generation to the real product so the bottle/label stays faithful.
  const anchor = name ? `参考图片中的${name}，` : '';
  return `${anchor}${guidance}`;
}

function buildMedia(slot: OrchestratedSlot, model: WanModel, matched: AssetCard | undefined, input: PlanAigcBeatsInput): WanMedia[] {
  if (model === 'wan2.7-t2v') return [];
  if (model === 'wan2.7-videoedit') {
    return matched?.url ? [{ type: 'video_edit_source', url: matched.url }] : [];
  }

  // r2v: matched image first (its scene), then the global product anchor, then aigc referenceAssetIds — ≤5, deduped.
  const media: WanMedia[] = [];
  if (matched?.type === 'image' && matched.url) media.push({ type: 'reference_image', url: matched.url });
  if (input.productImageUrl) media.push({ type: 'reference_image', url: input.productImageUrl });
  for (const id of findAigc(slot)?.referenceAssetIds ?? []) {
    const asset = input.assetCards.find((card) => card.id === id);
    if (asset?.type === 'image' && asset.url) media.push({ type: 'reference_image', url: asset.url });
  }

  const seen = new Set<string>();
  return media.filter((m) => (seen.has(m.url) ? false : (seen.add(m.url), true))).slice(0, MAX_REFERENCE_MEDIA);
}

function clampDuration(seconds: number, model: WanModel): number {
  const max = MODEL_DURATION_MAX[model];
  if (!Number.isFinite(seconds)) return DURATION_MIN;
  return Math.max(DURATION_MIN, Math.min(Math.round(seconds), max));
}

function normalizeRatio(value: string): WanAspectRatio {
  const allowed: WanAspectRatio[] = ['9:16', '16:9', '1:1', '4:3', '3:4'];
  return (allowed as string[]).includes(value) ? (value as WanAspectRatio) : '9:16';
}
