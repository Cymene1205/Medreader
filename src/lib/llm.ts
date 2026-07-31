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

import { db } from "@/lib/db";

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
  /** When provided, the call will be recorded to the TokenUsage table for the
   *  admin dashboard. Best-effort — failures are silently swallowed. */
  usage?: {
    userId?: string | null;
    action: string; // "analyze" | "chat" | "translate" | "vision" | "followups" | "llm_test"
    paperId?: string | null;
  };
};

// --- Cost-per-1M-tokens (in CNY) for known providers/models --------------
// Sources: official pricing pages as of 2025-09. Used only for rough
// estimation in the admin dashboard; not billed.
//
// Format: { provider: { "model-prefix": { input, output } } }
// "model-prefix" matches by startsWith on the lowercase model name.
// An empty-string key ("") acts as a wildcard default for the provider.
const COST_TABLE_CNY_PER_1M: Record<string, Record<string, { input: number; output: number }>> = {
  deepseek: {
    "deepseek-chat": { input: 1, output: 2 },         // ¥1 / ¥2 per 1M (cache miss)
    "deepseek-reasoner": { input: 4, output: 16 },
  },
  openai: {
    "gpt-4o-mini": { input: 1.05, output: 4.2 },
    "gpt-4o": { input: 17.5, output: 70 },
    "gpt-4-turbo": { input: 70, output: 210 },
    "gpt-3.5": { input: 3.5, output: 7 },
  },
  zhipu: {
    "glm-4-flash": { input: 0.1, output: 0.1 },
    "glm-4-air": { input: 0.5, output: 0.5 },
    "glm-4-plus": { input: 35, output: 35 },
    "glm-4": { input: 70, output: 70 },
  },
  moonshot: {
    "moonshot-v1-8k": { input: 8.4, output: 8.4 },
    "moonshot-v1-32k": { input: 16.8, output: 16.8 },
    "moonshot-v1-128k": { input: 42, output: 42 },
  },
  anthropic: {
    "claude-3-5-sonnet": { input: 21.7, output: 109 },
    "claude-3-5-haiku": { input: 5.6, output: 28 },
    "claude-3-opus": { input: 109, output: 545 },
  },
  // Vision fallback (z-ai-web-dev-sdk) — keyed under a separate "provider"
  // name "zai-vision" so the admin dashboard can attribute it correctly.
  "zai-vision": {
    "": { input: 0.5, output: 0.5 },
  },
};

function estimateCostCny(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  _isVisionFallback: boolean = false
): number {
  // Look up the rate table for this provider. Falls back to deepseek rates
  // for unknown providers so we always produce a non-zero estimate.
  const table = COST_TABLE_CNY_PER_1M[provider] || COST_TABLE_CNY_PER_1M.deepseek;
  // Find the longest matching prefix (or the "" wildcard).
  let best: { input: number; output: number } | undefined;
  let bestLen = -1;
  const mLower = (model || "").toLowerCase();
  for (const [prefix, rate] of Object.entries(table)) {
    if (prefix === "") {
      // Wildcard — only use if nothing else matches.
      if (best === undefined) best = rate;
      continue;
    }
    if (mLower.startsWith(prefix) && prefix.length > bestLen) {
      best = rate;
      bestLen = prefix.length;
    }
  }
  // Fallback: deepseek-chat rates
  if (!best) best = { input: 1, output: 2 };
  const costIn =
    (promptTokens / 1_000_000) * best.input;
  const costOut =
    (completionTokens / 1_000_000) * best.output;
  return Math.round((costIn + costOut) * 10000) / 10000; // 4 decimal places
}

/**
 * Persist a single LLM call's token usage + estimated cost to the TokenUsage
 * table. Best-effort — silently swallows DB errors so it never breaks the
 * main request flow.
 */
async function recordTokenUsage(args: {
  userId?: string | null;
  action: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  paperId?: string | null;
  isVisionFallback?: boolean;
}): Promise<void> {
  try {
    const costCny = estimateCostCny(
      args.provider,
      args.model,
      args.promptTokens,
      args.completionTokens,
      args.isVisionFallback
    );
    await db.tokenUsage.create({
      data: {
        userId: args.userId || null,
        action: args.action,
        provider: args.provider,
        model: args.model,
        promptTokens: args.promptTokens || 0,
        completionTokens: args.completionTokens || 0,
        totalTokens: args.totalTokens || 0,
        costCny,
        paperId: args.paperId || null,
      },
    });
  } catch (e) {
    // Silent failure — tracking should never break the user-facing call
    console.warn("[recordTokenUsage] failed:", e);
  }
}

/** Extract usage numbers from an OpenAI-compatible chat completion response. */
function extractUsage(data: any): {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
} {
  const u = data?.usage;
  if (!u) return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  return {
    promptTokens: Number(u.prompt_tokens || u.promptTokens || 0) || 0,
    completionTokens: Number(u.completion_tokens || u.completionTokens || 0) || 0,
    totalTokens:
      Number(u.total_tokens || u.totalTokens || 0) ||
      (Number(u.prompt_tokens || 0) + Number(u.completion_tokens || 0)),
  };
}

// --- Server-side defaults from env (used when client doesn't supply) ---------
const ENV_DEFAULTS: Record<LLMProvider, { baseUrl: string; apiKey: string; model: string }> = {
  deepseek: {
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    // No hardcoded fallback — must be supplied via env var.
    apiKey: process.env.DEEPSEEK_API_KEY || "",
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
  const content = data?.choices?.[0]?.message?.content ?? "";

  // Record token usage (best-effort) when caller requested it.
  if (opts.usage) {
    const u = extractUsage(data);
    // If the API didn't return usage, estimate prompt tokens from message length.
    // (Many OpenAI-compat proxies omit usage in JSON-mode calls.)
    let prompt = u.promptTokens;
    let completion = u.completionTokens;
    if (prompt === 0 && completion === 0) {
      const approxChars = messages.reduce((a, m) => a + (m.content?.length || 0), 0);
      prompt = Math.ceil(approxChars / 3.5);
      completion = Math.ceil(content.length / 3.5);
    }
    await recordTokenUsage({
      userId: opts.usage.userId,
      action: opts.usage.action,
      provider: cfg.provider,
      model: cfg.model,
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: prompt + completion,
      paperId: opts.usage.paperId,
    });
  }

  return content;
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
    // Request usage to be sent in the final stream chunk (OpenAI & several
    // OpenAI-compatible providers honor this when stream_options is set).
    stream_options: { include_usage: true },
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
  let acc = "";
  // Token usage extracted from the final stream chunk (if the provider
  // sent it back in the include_usage flow).
  let usageFromStream: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null = null;

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
      if (payload === "[DONE]") {
        // After [DONE], if we have usage, record it (or estimate from content).
        if (opts.usage) {
          let prompt = usageFromStream?.promptTokens ?? 0;
          let completion = usageFromStream?.completionTokens ?? 0;
          if (prompt === 0 && completion === 0) {
            const approxChars = messages.reduce((a, m) => a + (m.content?.length || 0), 0);
            prompt = Math.ceil(approxChars / 3.5);
            completion = Math.ceil(acc.length / 3.5);
          }
          await recordTokenUsage({
            userId: opts.usage.userId,
            action: opts.usage.action,
            provider: cfg.provider,
            model: cfg.model,
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: prompt + completion,
            paperId: opts.usage.paperId,
          });
        }
        return;
      }
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) {
          acc += delta;
          yield delta as string;
        }
        // Some providers put usage in the final chunk's `usage` field.
        if (json?.usage && !usageFromStream) {
          usageFromStream = extractUsage(json);
        }
      } catch {
        // ignore keepalive / partial
      }
    }
  }

  // Stream ended without [DONE] — still record usage if requested.
  if (opts.usage) {
    let prompt = usageFromStream?.promptTokens ?? 0;
    let completion = usageFromStream?.completionTokens ?? 0;
    if (prompt === 0 && completion === 0) {
      const approxChars = messages.reduce((a, m) => a + (m.content?.length || 0), 0);
      prompt = Math.ceil(approxChars / 3.5);
      completion = Math.ceil(acc.length / 3.5);
    }
    await recordTokenUsage({
      userId: opts.usage.userId,
      action: opts.usage.action,
      provider: cfg.provider,
      model: cfg.model,
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: prompt + completion,
      paperId: opts.usage.paperId,
    });
  }
}

// --- Vision (image-based) ----------------------------------------------------
//
// Vision is routed through Zhipu GLM-4V (OpenAI-compatible multimodal API).
// The vision endpoint is INDEPENDENT of the chat LLM provider — even when
// the user picks DeepSeek for chat, vision calls still go to Zhipu because
// DeepSeek doesn't provide a public vision endpoint we can rely on.
//
// Configure via env vars (no .z-ai-config file needed):
//   VISION_BASE_URL — default https://open.bigmodel.cn/api/paas/v4
//   VISION_API_KEY  — required (Zhipu API key, e.g. ab99....xxxx)
//   VISION_MODEL    — default glm-4v-flash (free tier; switch to glm-4v / glm-4.5v if needed)
//
// If the user supplies a custom OpenAI-compatible endpoint that supports
// vision (e.g. gpt-4o), and the chosen provider is NOT the default DeepSeek,
// we transparently route through the user's endpoint instead.

const VISION_DEFAULTS = {
  baseUrl: process.env.VISION_BASE_URL || "https://open.bigmodel.cn/api/paas/v4",
  apiKey: process.env.VISION_API_KEY || "",
  model: process.env.VISION_MODEL || "glm-4v-flash",
};

export async function callVisionLLM(
  cfg: LLMConfig,
  prompt: string,
  imageBase64: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
  paperContext?: string,
  usage?: {
    userId?: string | null;
    action: string;
    paperId?: string | null;
  }
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

  const imageUrl = imageBase64.startsWith("data:") ? imageBase64 : `data:image/png;base64,${imageBase64}`;

  // Decide which endpoint to use:
  //   - If the user has explicitly chosen a non-deepseek provider in their
  //     LLM config, honor it and route vision through that provider's
  //     OpenAI-compatible multimodal endpoint (e.g. gpt-4o).
  //   - Otherwise (default DeepSeek, which has no public vision API), fall
  //     back to the dedicated vision endpoint configured via VISION_* env
  //     vars (Zhipu GLM-4V by default).
  let visionBaseUrl: string;
  let visionApiKey: string;
  let visionModel: string;
  let visionProviderLabel: string; // for token usage attribution

  if (cfg.provider !== "deepseek") {
    visionBaseUrl = cfg.baseUrl;
    visionApiKey = cfg.apiKey;
    visionModel = cfg.model;
    visionProviderLabel = cfg.provider;
  } else {
    visionBaseUrl = VISION_DEFAULTS.baseUrl;
    visionApiKey = VISION_DEFAULTS.apiKey;
    visionModel = VISION_DEFAULTS.model;
    visionProviderLabel = "zhipu-vision";
  }

  if (!visionApiKey) {
    throw new Error(
      'Vision API key 未配置。请在 .env.production 中设置 VISION_API_KEY（智谱 API key），或在右上角「模型设置」中切换到自带 vision 能力的 provider（如 openai/gpt-4o、zhipu/glm-4v）。'
    );
  }

  // Build OpenAI-compatible multimodal message list
  const messages: any[] = [
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

  const body = {
    model: visionModel,
    messages,
    temperature: 0.4,
    stream: false,
  };

  const url = `${visionBaseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${visionApiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Vision LLM error ${res.status} (${visionProviderLabel}/${visionModel}): ${errText.slice(0, 400)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "";

  if (usage) {
    const u = extractUsage(data);
    let promptT = u.promptTokens;
    let completionT = u.completionTokens;
    if (promptT === 0 && completionT === 0) {
      // Rough estimate: image ≈ 1k tokens + all message text / 3.5
      const approxChars =
        systemPrompt.length +
        (prompt?.length || 0) +
        history.reduce((a, m) => a + (m.content?.length || 0), 0);
      promptT = Math.ceil(approxChars / 3.5) + 1000;
      completionT = Math.ceil(content.length / 3.5);
    }
    await recordTokenUsage({
      userId: usage.userId,
      action: usage.action,
      provider: visionProviderLabel,
      model: visionModel,
      promptTokens: promptT,
      completionTokens: completionT,
      totalTokens: promptT + completionT,
      paperId: usage.paperId,
    });
  }

  return content;
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
