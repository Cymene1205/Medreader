import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveLLMConfig, streamLLM, type ChatMessage } from "@/lib/llm";
import { db } from "@/lib/db";
import { trackEvent } from "@/lib/track";
import { checkAndIncrement } from "@/lib/quota";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const cfg = resolveLLMConfig(req);
    const { messages, question, context, markdown, paperId } = await req.json();

    // messages: prior chat history [{role, content}]
    // question: user's new question
    // context:  (legacy) selected paper text snippet — kept for backward compat
    // markdown: full MinerU markdown — preferred source of truth
    // paperId:  optional — associated paper for ChatLog bookkeeping
    const history: ChatMessage[] = Array.isArray(messages)
      ? messages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        }))
      : [];

    // Resolve user (anonymous allowed) and enforce quota.
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {
      // ignore — anonymous flow
    }
    const quota = await checkAndIncrement("chat", userId, req);
    if (!quota.ok) {
      return new Response(
        JSON.stringify({
          error: `今日提问额度已用尽（${quota.count}/${quota.limit}）。明日重置。`,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build a single system prompt that ALWAYS contains the paper.
    // Prefer the structured markdown (richer, includes section headers).
    // Fall back to the legacy `context` field if no markdown available.
    const paperContext =
      (typeof markdown === "string" && markdown.trim())
        ? markdown.slice(0, 16000)
        : (typeof context === "string" ? context.slice(0, 12000) : "");

    const system: ChatMessage = {
      role: "system",
      content:
        "你是一位资深的科研文献分析助手，正在与用户一起阅读同一篇论文。" +
        (paperContext
          ? `\n\n【论文全文】（Markdown 格式，包含原文标题、章节、段落、表格、图片描述等结构信息）\n"""\n${paperContext}\n"""`
          : "\n\n（注意：尚未加载到论文全文，请明确告知用户先上传并等待解析完成。）") +
        "\n\n请严格基于论文内容回答用户问题。如果问题超出论文范围，可以适当补充通用知识但必须明确标注\"（通用知识，非论文内容）\"。引用论文内容时尽量保留原文措辞。回答使用 Markdown，专业术语首次出现时附英文原词。",
    };

    const fullMessages: ChatMessage[] = [
      system,
      ...history,
      { role: "user", content: question },
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let acc = "";
        try {
          for await (const delta of streamLLM(cfg, fullMessages, {
            temperature: 0.4,
            maxTokens: 2500,
            usage: {
              userId,
              action: "chat",
              paperId: typeof paperId === "string" ? paperId : null,
            },
          })) {
            acc += delta;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)
            );
          }

          let chatLogId: string | null = null;
          try {
            const chatLog = await db.chatLog.create({
              data: {
                userId: userId || null,
                paperId:
                  typeof paperId === "string" && paperId ? paperId : null,
                question: String(question || "").slice(0, 10000),
                answer: acc.slice(0, 20000),
              },
            });
            chatLogId = chatLog.id;
          } catch (e) {
            console.warn("[chat] failed to save ChatLog:", e);
          }

          try {
            await trackEvent(
              userId,
              "chat",
              JSON.stringify({
                chatLogId,
                paperId: typeof paperId === "string" ? paperId : null,
              })
            );
          } catch {
            // ignore
          }

          if (chatLogId) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ __meta__: { chatLogId } })}\n\n`
              )
            );
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
