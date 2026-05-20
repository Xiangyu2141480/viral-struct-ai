import OpenAI from 'openai';

export function createOpenAICompatibleClient() {
  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL;

  if (!apiKey || !baseURL) {
    throw new Error('LLM_API_KEY and LLM_BASE_URL are required. Use mock mode for demo fallback.');
  }

  return new OpenAI({ apiKey, baseURL });
}
