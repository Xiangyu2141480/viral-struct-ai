import OpenAI from 'openai';

export type OpenAICompatibleClient = OpenAI;

let testClientFactory: (() => OpenAICompatibleClient) | null = null;

/**
 * Test-only seam: route EVERY LLM client through a mock factory. Used by full-pipeline HTTP/route and demo
 * integration tests that must exercise the (mandatory-LLM, no-fallback) category-equivalent vocab and
 * source-identity banlist without a live LLM. Pass null to restore real clients. No effect in production.
 */
export function setLlmClientFactoryForTests(factory: (() => OpenAICompatibleClient) | null): void {
  testClientFactory = factory;
}

export function createOpenAICompatibleClient(): OpenAICompatibleClient {
  if (testClientFactory) return testClientFactory();

  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL;

  if (!apiKey || !baseURL) {
    throw new Error('LLM_API_KEY and LLM_BASE_URL are required. Use mock mode for demo fallback.');
  }

  return new OpenAI({
    apiKey,
    baseURL,
    // Cap per-call latency: without this the SDK waits up to 10 min on a slow/hung Ark/Doubao
    // call and freezes the whole request. On timeout the *WithFallback callers degrade to
    // deterministic rules instead. Tunable via env for slower models / networks.
    timeout: Number(process.env.LLM_TIMEOUT_MS ?? 90_000),
    maxRetries: Number(process.env.LLM_MAX_RETRIES ?? 1),
  });
}
