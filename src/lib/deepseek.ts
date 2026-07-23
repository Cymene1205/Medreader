import ZAI from "z-ai-web-dev-sdk";

export const DEEPSEEK_API_KEY =
  process.env.DEEPSEEK_API_KEY || "sk-edb16a1b2daa4982a45307247934cd91";
export const DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/**
 * Calls DeepSeek chat completion.
 * Returns the assistant message string.
 */
export async function callDeepSeek(
  messages: ChatMessage[],
  opts: { json?: boolean; temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const body: Record<string, unknown> = {
    model: "deepseek-chat",
    messages,
    temperature: opts.temperature ?? 0.3,
    stream: false,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.json) body.response_format = { type: "json_object" };

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

/**
 * Streams DeepSeek chat completion token-by-token via SSE.
 * Yields content deltas.
 */
export async function* streamDeepSeek(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number } = {}
): AsyncGenerator<string, void, unknown> {
  const body: Record<string, unknown> = {
    model: "deepseek-chat",
    messages,
    temperature: opts.temperature ?? 0.3,
    stream: true,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;

  const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text();
    throw new Error(`DeepSeek stream error ${res.status}: ${errText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch {
        // ignore keepalive / partial
      }
    }
  }
}

/**
 * Vision chat using z-ai-web-dev-sdk.
 * Accepts base64 image and a prompt, returns assistant text.
 */
export async function callVision(
  prompt: string,
  imageBase64: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = []
): Promise<string> {
  const zai = await ZAI.create();

  // Build message list: prior history (text only) + final user message with image
  const messages: Array<Record<string, unknown>> = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  messages.push({
    role: "user",
    content: [
      { type: "text", text: prompt || "请详细分析这张图片。" },
      {
        type: "image_url",
        image_url: { url: imageBase64.startsWith("data:") ? imageBase64 : `data:image/png;base64,${imageBase64}` },
      },
    ],
  });

  const response = await zai.chat.completions.createVision({
    messages: messages as any,
    thinking: { type: "disabled" },
  });

  return response?.choices?.[0]?.message?.content ?? "";
}
