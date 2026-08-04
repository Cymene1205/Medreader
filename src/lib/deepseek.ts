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
  getDefaultVisionConfig,
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
 * Vision chat using a server-default OpenAI-compatible multimodal endpoint
 * (Zhipu GLM-4V by default). Accepts base64 image and a prompt, returns
 * assistant text. If paperContext is provided, uses a structured
 * "teach-how-to-read → explain → connect" workflow.
 *
 * Vision endpoint is configured via VISION_API_KEY / VISION_BASE_URL /
 * VISION_MODEL env vars. Default model is glm-4v-flash.
 *
 * For per-request override (e.g. user picks a different vision provider in
 * the LLMSettingsDialog "图像识别" tab), use callVisionLLM(vcfg, ...)
 * directly from an API route that has resolved the VisionConfig from
 * request headers via resolveVisionConfig(req).
 */
export async function callVision(
  prompt: string,
  imageBase64: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
  paperContext?: string
): Promise<string> {
  return callVisionLLM(getDefaultVisionConfig(), prompt, imageBase64, history, paperContext);
}

export { callLLM, streamLLM, callVisionLLM, getDefaultLLMConfig, getDefaultVisionConfig };
export type { LLMConfig, LLMCallOptions };
