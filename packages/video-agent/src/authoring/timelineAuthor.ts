import type { AuthoredTimeline } from '@viral-struct/shared';
import type { VideoEditContext } from '../context/VideoEditContext';
import type { LLMAuthor } from './llmAuthor';
import { buildAuthoringPrompt } from './authoringPrompt';
import { canonicalizeAuthoredTimeline } from './canonicalizer';
import { deterministicMockAuthor } from './deterministicMockAuthor';

export interface AuthorTimelineDeps {
  /** Injected LLM client. Absent → the deterministic mock author is used (offline / no-key). */
  llm?: LLMAuthor;
}

export interface AuthorTimelineResult {
  timeline: AuthoredTimeline;
  source: 'llm' | 'mock';
  trace: { reason?: string; canonicalizations?: string[]; promptChars?: number; completionChars?: number };
}

/**
 * The P1 entry point: author an AuthoredTimeline from a VideoEditContext (sample graph + new product + assets).
 * With an injected LLM client it runs the Director/Screenwriter prompt → canonicalize; on ANY failure (API or
 * parse) it falls back to the deterministic mock author so the pipeline never crashes and always renders.
 */
export async function authorTimeline(context: VideoEditContext, deps: AuthorTimelineDeps = {}): Promise<AuthorTimelineResult> {
  const { llm } = deps;
  if (!llm) {
    return { timeline: deterministicMockAuthor(context), source: 'mock', trace: { reason: 'no LLM client injected' } };
  }
  try {
    const { system, user } = buildAuthoringPrompt(context);
    const prompt = `${system}\n\n${user}`;
    const completion = await llm.complete(prompt, { temperature: 0.7 });
    const { timeline, log } = canonicalizeAuthoredTimeline(completion, context);
    return { timeline, source: 'llm', trace: { canonicalizations: log, promptChars: prompt.length, completionChars: completion.length } };
  } catch (error) {
    return { timeline: deterministicMockAuthor(context), source: 'mock', trace: { reason: `LLM author failed, used mock: ${String(error)}` } };
  }
}
