/**
 * LLM provider abstraction.
 *
 * Allows swapping the underlying LLM at runtime via either:
 *   - environment variables (server-side defaults), or
 *   - per-request headers from the client (user-supplied config).
 *
 * Supported providers (any OpenAI-compatible endpoint):
 *   - deepseek (default)
 *   - openai
 *   - anthropic (via openai-compatible proxy)
 *   - zhipu / glm
 *   - moonshot / kimi
 *   - custom (any OpenAI-compatible baseUrl + apiKey)
 *
 * Client → Server protocol:
 *   The client may send the following HTTP headers on /api/chat, /api/analyze,
 *   /api/translate, /api/vision, /api/followups requests:
 *     X-LLM-Provider:  deepseek | openai | zhipu | moonshot | anthropic | custom
 *     X-LLM-Base-Url:  https://api.example.com/v1
 *     X-LLM-Api-Key:   sk-xxxxx
 *     X-LLM-Model:     gpt-4o-mini | deepseek-chat | glm-4-flash | ...
 *
 *   If a header is missing, the corresponding env var (or default) is used.
 */

import ZAI from "z-ai-web-dev-sdk";

export type LLMProvider = "deepseek" | "openai" | "zhipu" | "moonshot" | "anthropic" | "custom";

export type LLMConfig = {
  provider: LLMProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMCallOptions = {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** stop sequences */
  stop?: string[];
};

// --- Server-side defaults from env (used when client doesn't supply) ---------
const ENV_DEFAULTS: Record<LLMProvider, { baseUrl: string; apiKey: string; model: string }> = {
  deepseek: {
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY || "sk-edb16a1b2daa4982a45307247934cd91",
    model: "deepseek-chat",
  },
  openai: {
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
  zhipu: {
    baseUrl: process.env.ZHIPU_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
    apiKey: process.env.ZHIPU_API_KEY || "",
    model: process.env.ZHIPU_MODEL || "glm-4-flash",
  },
  moonshot: {
    baseUrl: process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1",
    apiKey: process.env.MOONSHOT_API_KEY || "",
    model: process.env.MOONSHOT_MODEL || "moonshot-v1-8k",
  },
  anthropic: {
    baseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
  },
  custom: {
    baseUrl: process.env.CUSTOM_LLM_BASE_URL || "",
    apiKey: process.env.CUSTOM_LLM_API_KEY || "",
    model: process.env.CUSTOM_LLM_MODEL || "",
  },
};

/**
 * Resolve an LLMConfig from incoming request headers (Next.js Request).
 * Falls back to env defaults if a header is missing.
 */
export function resolveLLMConfig(req: Request): LLMConfig {
  const headers = req.headers;
  const providerRaw = (headers.get("x-llm-provider") || "deepseek").toLowerCase();
  const provider = (["deepseek","openai","zhipu","moonshot","anthropic","custom"].includes(providerRaw)
    ? providerRaw
    : "deepseek") as LLMProvider;

  const env = ENV_DEFAULTS[provider];

  const baseUrl = (headers.get("x-llm-base-url") || env.baseUrl).trim();
  const apiKey = (headers.get("x-llm-api-key") || env.apiKey).trim();
  const model = (headers.get("x-llm-model") || env.model).trim();

  if (!apiKey) {
    throw new Error(
      `LLM API key 未配置。请在右上角"模型设置"中填写 ${provider} 的 API Key，或在服务端 .env 中设置对应变量。`
    );
  }
  if (!baseUrl) {
    throw new Error(`LLM Base URL 未配置（provider=${provider}）。`);
  }

  return { provider, baseUrl, apiKey, model };
}

/**
 * Get the server-default LLMConfig (no per-request override). Used by background
 * tasks like MinerU parse where there's no incoming HTTP request.
 */
export function getDefaultLLMConfig(): LLMConfig {
  return { provider: "deepseek", ...ENV_DEFAULTS.deepseek };
}

// --- OpenAI-compatible chat completion (non-streaming) ----------------------

export async function callLLM(
  cfg: LLMConfig,
  messages: ChatMessage[],
  opts: LLMCallOptions = {}
): Promise<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? 0.3,
    stream: false,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.stop) body.stop = opts.stop;
  if (opts.json) body.response_format = { type: "json_object" };

  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM error ${res.status} (${cfg.provider}/${cfg.model}): ${errText.slice(0, 400)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

// --- OpenAI-compatible streaming chat completion (SSE) ----------------------

export async function* streamLLM(
  cfg: LLMConfig,
  messages: ChatMessage[],
  opts: LLMCallOptions = {}
): AsyncGenerator<string, void, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: opts.temperature ?? 0.3,
    stream: true,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.stop) body.stop = opts.stop;

  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text();
    throw new Error(`LLM stream error ${res.status} (${cfg.provider}/${cfg.model}): ${errText.slice(0, 400)}`);
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

// --- Vision (image-based) ----------------------------------------------------
//
// Vision is currently routed through the z-ai-web-dev-sdk because that's the
// only vision-capable endpoint available in this environment by default.
// If the user supplies a custom OpenAI-compatible endpoint that supports
// vision (e.g. gpt-4o), we transparently route through the standard
// OpenAI vision message format instead.

export async function callVisionLLM(
  cfg: LLMConfig,
  prompt: string,
  imageBase64: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
  paperContext?: string
): Promise<string> {
  // Structured system prompt for figure reading
  const systemPrompt = `你是一位资深的科研论文图表解读助手。当用户给你一张科研图表（柱状图、折线图、流式细胞图、热图、Western Blot、免疫荧光、HE 染色、Kaplan-Meier 生存曲线、UMAP/t-SNE、火山图等）时，请严格按照以下四段式结构作答，每段使用清晰的中文小标题（用 **加粗** 标记）：

**1. 图表类型与读图方法**
- 先判断这是什么类型的图（例如："这是一张分组柱状图"、"这是流式细胞术散点图"、"这是 Kaplan-Meier 生存曲线"）。
- 然后教用户怎么读这张图：横轴 (X-axis) 代表什么、纵轴 (Y-axis) 代表什么、单位是什么、分组/颜色/图例分别代表什么实验组、是否有误差棒（标准差 SD 还是标准误 SEM）、样本量 n 是多少。如果是散点/聚类图，说明每个点代表什么。
- 如果图中有 p 值标注，解释其含义（* p<0.05, ** p<0.01, *** p<0.001 等）。

**2. 图表呈现的关键数据**
- 客观陈述图中显示的主要数值与趋势。例如："d28-inv 组的 CD8+ T 细胞数量约为 65 个/mg，显著高于 Virgin 组（约 12 个/mg）和 d10-FW 组（约 18 个/mg）"。
- 不要在这一段做主观推断，只描述图上能直接看到的事实。

**3. 结合论文原文的解释**
${paperContext
  ? `- 基于下方提供的论文原文，解释这张图在整个研究逻辑中的作用：它回答了什么科学问题？验证了什么假设？与前一张图/后一张图如何衔接？作者用这张图想说明的核心结论是什么？\n- 如果原文有相关讨论，引用原文关键句。`
  : `- 由于没有提供论文原文上下文，请基于图中的标题、注释和你对该领域的常识，合理推测这张图可能说明的生物学含义，并明确标注"（推测）"。`}

**4. 一句话总结**
- 用一句中文话概括这张图最重要的发现。

${paperContext ? `\n以下是论文原文（供你做"结合原文解释"时参考）：\n"""\n${paperContext.slice(0, 8000)}\n"""` : ""}

回答风格要求：专业、准确、不啰嗦；中文为主，专业术语首次出现时附英文原词；如果图中信息不足以支撑某段，请诚实说明"图中未显示"。`;

  // Build message list
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
  ];

  const imageUrl = imageBase64.startsWith("data:") ? imageBase64 : `data:image/png;base64,${imageBase64}`;

  // If the configured provider is NOT the default DeepSeek, route through the
  // standard OpenAI-compatible vision message format. This lets users plug in
  // gpt-4o, claude-3-5-sonnet (via openai-compat proxy), qwen-vl, etc.
  if (cfg.provider !== "deepseek") {
    // Push a multimodal user message
    (messages as any).push({
      role: "user",
      content: [
        { type: "text", text: prompt || "请按照四段式结构解读这张科研图表。" },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    });
    // Call the standard OpenAI-compatible endpoint with the multimodal payload
    const body = {
      model: cfg.model,
      messages,
      temperature: 0.4,
      stream: false,
    };
    const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Vision LLM error ${res.status}: ${errText.slice(0, 400)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }

  // Default DeepSeek provider doesn't support vision; fall back to z-ai SDK.
  const zai = await ZAI.create();
  const zaiMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: [
        { type: "text", text: prompt || "请按照四段式结构解读这张科研图表。" },
        { type: "image_url", image_url: { url: imageUrl } },
      ],
    },
  ];
  const response = await zai.chat.completions.createVision({
    model: "glm-4.5v",
    messages: zaiMessages,
    thinking: { type: "disabled" },
  } as any);
  return response?.choices?.[0]?.message?.content ?? "";
}

// --- Helpers for parsing the LLM response into JSON --------------------------

/**
 * Try to parse a JSON object from an LLM response that may be wrapped in
 * markdown code fences or have leading/trailing prose.
 */
export function parseJsonLoose(raw: string): unknown {
  // 1) Direct
  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }
  // 2) Strip markdown code fences
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through
  }
  // 3) Find first { ... last } and try parsing that slice
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  throw new Error("无法解析 LLM 返回的 JSON。原始内容：" + raw.slice(0, 500));
}
