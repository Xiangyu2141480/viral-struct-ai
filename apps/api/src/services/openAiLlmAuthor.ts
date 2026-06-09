import type { LLMAuthor } from '@viral-struct/video-agent';
import { createOpenAICompatibleClient } from './llmProvider';

const LLM_AUTHOR_TIMEOUT_MS = 30_000;
const LLM_AUTHOR_MAX_TOKENS = 4096;

/**
 * Adapter exposing the configured OpenAI-compatible LLM as the video-agent's
 * {@link LLMAuthor} (the Director/Screenwriter). The video-agent package carries
 * no OpenAI dependency, so apps/api injects this implementation.
 *
 * Construction throws when LLM_API_KEY / LLM_BASE_URL / LLM_MODEL are absent —
 * callers should wrap it in try/catch and fall back to the deterministic mock
 * author (which still renders real pixels for matched assets).
 */
export function createOpenAiLlmAuthor(opts: { model?: string } = {}): LLMAuthor {
  const client = createOpenAICompatibleClient();
  const modelId = opts.model ?? process.env.LLM_MODEL;
  if (!modelId) {
    throw new Error('LLM_MODEL is required for the authored render path.');
  }

  return {
    async complete(prompt, options) {
      // authorTimeline pre-merges system + user into one prompt string, so a single
      // user message is sufficient. No response_format: the canonicalizer tolerantly
      // extracts JSON from prose/fences. A request timeout + token cap keep a stalled
      // provider from hanging the render request.
      const response = await client.chat.completions.create(
        {
          model: modelId,
          messages: [{ role: 'user', content: prompt }],
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? LLM_AUTHOR_MAX_TOKENS
        },
        { timeout: LLM_AUTHOR_TIMEOUT_MS }
      );
      return response.choices[0]?.message?.content ?? '';
    }
  };
}
