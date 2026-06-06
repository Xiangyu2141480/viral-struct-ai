/**
 * Provider-agnostic LLM contract for the authoring step (the "LLM proposes" rung of the four-line spine).
 * video-agent imports NO concrete LLM SDK — apps/api injects a Doubao/OpenAI-compatible implementation, tests
 * inject a fake, and absence falls back to the deterministic mock author. This keeps the brain testable offline.
 */
export interface LLMAuthor {
  complete(prompt: string, options?: { temperature?: number; maxTokens?: number }): Promise<string>;
}
