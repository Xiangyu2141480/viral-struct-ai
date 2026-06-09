import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import type { AuthoredTimeline } from '@viral-struct/shared';
import { AuthoredFfmpegExecutor, type RenderResult } from '@viral-struct/render-executor';
import {
  authorTimeline,
  type AuthorTimelineResult,
  type LLMAuthor,
  type VideoEditContext
} from '@viral-struct/video-agent';
import { createOpenAiLlmAuthor } from './openAiLlmAuthor';
import { getDemoAssetDir, getRenderDir } from './videoPaths';

const DEMO_ASSET_URL_PREFIX = '/media/demo-assets/';

/**
 * The authored real-pixel render is opt-in (default OFF), mirroring the
 * ASSET_VLM_ENABLED convention. An explicit boolean overrides the env flag.
 */
export function authoredRenderEnabled(explicit?: boolean): boolean {
  return explicit ?? process.env.USE_AUTHORED_RENDER === 'true';
}

/**
 * The authors copy `AssetCard.url` verbatim into `MediaAsset.resolvedPath`, which
 * the ffmpeg executor opens with `-i`. Demo asset urls are web paths
 * (`/media/demo-assets/...`) that ffmpeg cannot read, so rewrite them to the
 * on-disk file. Without this the executor falls back to colour-block beats.
 *
 * Returns immutable copies; non-matching / missing urls pass through untouched.
 * Output uses forward slashes (ffmpeg accepts them on every platform).
 */
export function rewriteAssetCardUrlsToDisk<T extends { url?: string }>(cards: T[]): T[] {
  return cards.map((card) => {
    if (!card.url || !card.url.startsWith(DEMO_ASSET_URL_PREFIX)) {
      return card;
    }
    const relative = card.url.slice(DEMO_ASSET_URL_PREFIX.length);
    return { ...card, url: path.join(getDemoAssetDir(), relative).replace(/\\/g, '/') };
  });
}

export interface AuthoredRenderResult {
  render: RenderResult;
  mediaUrl: string | null;
  source: AuthorTimelineResult['source'];
  trace: AuthorTimelineResult['trace'];
}

/** Minimal executor surface so tests can inject a stub without ffmpeg. */
export interface AuthoredRenderExecutor {
  render(timeline: AuthoredTimeline): Promise<RenderResult>;
}

export interface AuthoredRenderDeps {
  /** Inject the LLM Director. Default: built from env creds, falling back to the mock author. */
  llm?: LLMAuthor;
  /** Inject the executor (for tests). Default: AuthoredFfmpegExecutor. */
  executorFactory?: (outputPath: string) => AuthoredRenderExecutor;
}

/**
 * Author an AuthoredTimeline from an inherited VideoEditContext and composite it
 * into a real-pixel MP4. With no LLM creds the author falls back to the
 * deterministic mock author, which still yields real pixels for matched assets.
 *
 * Asset cards are expected to already carry on-disk `url`s — call
 * {@link rewriteAssetCardUrlsToDisk} on demo/library assets first.
 */
export async function authoredRenderFromContext(
  context: VideoEditContext,
  deps: AuthoredRenderDeps = {}
): Promise<AuthoredRenderResult> {
  let llm = deps.llm;
  if (!llm) {
    try {
      llm = createOpenAiLlmAuthor();
    } catch {
      // No / invalid LLM creds → deterministic mock author (still composites real pixels).
      llm = undefined;
    }
  }

  const authored = await authorTimeline(context, { llm });

  const renderDir = getRenderDir();
  mkdirSync(renderDir, { recursive: true });
  const outputPath = path.join(renderDir, `authored_${nanoid(10)}.mp4`);

  const executor = deps.executorFactory
    ? deps.executorFactory(outputPath)
    : new AuthoredFfmpegExecutor({ outputPath });
  const render = await executor.render(authored.timeline);

  const mediaUrl =
    render.rendered && render.outputPath ? `/media/renders/${path.basename(render.outputPath)}` : null;

  return { render, mediaUrl, source: authored.source, trace: authored.trace };
}
