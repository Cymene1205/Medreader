import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { streamDeepSeek, type ChatMessage } from "@/lib/deepseek";
import { db } from "@/lib/db";
import { trackEvent } from "@/lib/track";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { messages, question, context, paperId } = await req.json();

    // messages: prior chat history [{role, content}]
    // question: user's new question
    // context: optional selected paper text snippet
    // paperId: optional — associated paper for ChatLog bookkeeping
    const history: ChatMessage[] = Array.isArray(messages)
      ? messages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
        }))
      : [];

    const system: ChatMessage = {
      role: "system",
      content:
        "你是一位资深的科研文献分析助手，正在与用户一起阅读同一篇论文。" +
        (context
          ? `\n\n用户当前选中的原文片段（作为讨论上下文）：\n"""\n${context.slice(0, 3000)}\n"""`
          : "") +
        "\n\n请基于这篇论文，用清晰、专业的中文回答用户的问题。如果问题超出论文范围，可以适当补充通用知识但要明确说明。回答使用 Markdown。",
    };

    const fullMessages: ChatMessage[] = [
      system,
      ...history,
      { role: "user", content: question },
    ];

    // Resolve the user once up-front (best-effort, anonymous allowed)
    let userId: string | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = (session?.user as any)?.id ?? null;
    } catch {
      // ignore — anonymous flow
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let acc = "";
        try {
          for await (const delta of streamDeepSeek(fullMessages, {
            temperature: 0.4,
            maxTokens: 2500,
          })) {
            acc += delta;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)
            );
          }

          // After streaming finishes — persist the ChatLog (best-effort).
          // A failure here must NOT break the stream; the user has already
          // received their answer token-by-token.
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

          // Track event (best-effort)
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

          // Emit the meta event BEFORE [DONE] so the client can attach
          // feedback / follow-ups to the correct ChatLog row.
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
