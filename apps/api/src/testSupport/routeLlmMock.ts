/* eslint-disable @typescript-eslint/no-explicit-any */
import { setLlmClientFactoryForTests, type OpenAICompatibleClient } from '../services/llmProvider';
import { EARPHONE_VOCAB_FIXTURE, MACBOOK_SOURCE_BANNED_TERMS } from '../services/directorAgent/vocabularyFixture';

/**
 * Deterministic LLM stub for full-pipeline HTTP/route + demo integration tests.
 *
 * The Director's category-equivalent vocab and source-identity banlist are mandatory LLM calls with NO
 * deterministic fallback, so any route that runs the full director pipeline (e.g. /api/demo/run,
 * /api/director/orchestrate) cannot complete without an LLM. This stub routes each chat call by its system
 * prompt and returns a valid fixture for the two no-fallback calls; every other call (slot alignment, etc.)
 * gets an empty object so its parser fails and the *WithFallback caller degrades to the deterministic
 * rule-based path — exactly the behavior these tests had before the vocab/banlist refactor.
 */
async function fakeChatCreate(args: any): Promise<any> {
  const system = String(args?.messages?.[0]?.content ?? '');
  let content = '{}';
  if (system.includes('源身份禁忌词')) {
    content = JSON.stringify({ sourceProduct: '借用源产品', terms: [...MACBOOK_SOURCE_BANNED_TERMS] });
  } else if (system.includes('品类翻译器')) {
    content = JSON.stringify(EARPHONE_VOCAB_FIXTURE);
  }
  return { choices: [{ message: { content } }] };
}

const stubClient = {
  chat: { completions: { create: fakeChatCreate } }
} as unknown as OpenAICompatibleClient;

let savedModel: string | undefined;

/** Install the deterministic LLM stub for the current test file (call in `before`). */
export function installRouteLlmMock(): void {
  // The vocab/banlist callers throw "LLM_MODEL is required" on a missing model BEFORE touching the client,
  // and the test process does not load .env — so set a placeholder model alongside the stub client.
  savedModel = process.env.LLM_MODEL;
  process.env.LLM_MODEL = 'route-test-mock-model';
  setLlmClientFactoryForTests(() => stubClient);
}

/** Restore real LLM clients + env (call in `after`). */
export function uninstallRouteLlmMock(): void {
  if (savedModel === undefined) delete process.env.LLM_MODEL;
  else process.env.LLM_MODEL = savedModel;
  setLlmClientFactoryForTests(null);
}
