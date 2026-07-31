/**
 * Backward-compat shim — these wrappers now route through src/lib/llm.ts.
 *
 * Old callers (e.g. background tasks that have no incoming Request) can still
 * call callDeepSeek/streamDeepSeek and they will use the server-side defaults
 * (DeepSeek via env vars).
 *
 * New HTTP routes should use resolveLLMConfig(req) + callLLM / streamLLM
 * directly so they honor per-request user-supplied LLM config.
 */

import {
  callLLM,
  streamLLM,
  callVisionLLM,
  getDefaultLLMConfig,
  type ChatMessage,
  type LLMCallOptions,
  type LLMConfig,
} from "@/lib/llm";

export type { ChatMessage };

/**
 * Calls DeepSeek (server default) chat completion. Returns assistant string.
 * Used by background tasks without an HTTP request context.
 */
export async function callDeepSeek(
  messages: ChatMessage[],
  opts: LLMCallOptions = {}
): Promise<string> {
  return callLLM(getDefaultLLMConfig(), messages, opts);
}

/**
 * Streams DeepSeek (server default) chat completion token-by-token via SSE.
 */
export async function* streamDeepSeek(
  messages: ChatMessage[],
  opts: LLMCallOptions = {}
): AsyncGenerator<string, void, unknown> {
  yield* streamLLM(getDefaultLLMConfig(), messages, opts);
}

/**
 * Vision chat using Zhipu GLM-4V (default, OpenAI-compatible multimodal API)
 * OR a user-supplied OpenAI-compatible vision endpoint. Accepts base64 image
 * and a prompt, returns assistant text. If paperContext is provided, uses a
 * structured "teach-how-to-read → explain → connect" workflow.
 *
 * Vision endpoint is configured via VISION_API_KEY / VISION_BASE_URL / VISION_MODEL
 * env vars (no .z-ai-config file needed). Default model is glm-4v-flash.
 *
 * For per-request override, use callVisionLLM(cfg, ...) directly from an API route
 * that has resolved the LLMConfig from request headers.
 */
export async function callVision(
  prompt: string,
  imageBase64: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
  paperContext?: string
): Promise<string> {
  return callVisionLLM(getDefaultLLMConfig(), prompt, imageBase64, history, paperContext);
}

export { callLLM, streamLLM, callVisionLLM, getDefaultLLMConfig };
export type { LLMConfig, LLMCallOptions };
