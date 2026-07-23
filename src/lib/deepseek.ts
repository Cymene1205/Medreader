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
 * If paperContext is provided, uses a structured "teach-how-to-read → explain → connect" workflow.
 */
export async function callVision(
  prompt: string,
  imageBase64: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
  paperContext?: string
): Promise<string> {
  const zai = await ZAI.create();

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

  // Build message list: system prompt as first message, then prior history, then user message with image
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: systemPrompt },
    ...history.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  messages.push({
    role: "user",
    content: [
      {
        type: "text",
        text:
          prompt ||
          "请按照四段式结构解读这张科研图表。",
      },
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
