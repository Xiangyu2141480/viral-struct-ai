import OpenAI from 'openai';

export function createOpenAICompatibleClient() {
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
