"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  Loader2,
  Bot,
  User,
  Image as ImageIcon,
  X,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string; // base64 data URL
  ts: number;
  error?: boolean;
  // Feature 6: feedback + follow-ups
  chatLogId?: string;
  feedback?: "up" | "down" | null;
  followUps?: string[];
  followUpsLoading?: boolean;
  // dislike reason expansion
  showReason?: boolean;
  reasonText?: string;
  reasonSubmitting?: boolean;
};

type Props = {
  /** base64 image attached from PDF drag-select */
  attachedImage: string | null;
  onClearAttachedImage: () => void;
  /** selected text from PDF, used as additional chat context */
  selectedText: string;
  /** full paper markdown (MinerU) — preferred source of truth for chat context */
  paperMarkdown?: string;
  /** full paper text (fallback when markdown unavailable) */
  paperText?: string;
  /** current paper id (for ChatLog bookkeeping) */
  paperId?: string | null;
  /** LLM headers from LLMSettingsDialog — attached to text chat / translate / followups API calls */
  llmHeaders?: Record<string, string>;
  /** Vision headers from LLMSettingsDialog — attached to /api/vision calls only */
  visionHeaders?: Record<string, string>;
};

const genId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export default function ChatPanel({
  attachedImage,
  onClearAttachedImage,
  selectedText,
  paperMarkdown,
  paperText,
  paperId,
  llmHeaders = {},
  visionHeaders = {},
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef(llmHeaders);
  headersRef.current = llmHeaders;
  const visionHeadersRef = useRef(visionHeaders);
  visionHeadersRef.current = visionHeaders;

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  // Pre-fill prompt placeholder with image
  const hasImage = !!attachedImage;

  const updateMessage = (id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
  };

  /** Fetch 3 follow-up questions for a finalized assistant message. */
  const fetchFollowUps = async (
    msgId: string,
    question: string,
    answer: string
  ) => {
    try {
      const res = await fetch("/api/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headersRef.current },
        body: JSON.stringify({ question, answer, paperText }),
      });
      const data = await res.json();
      if (data && Array.isArray(data.followUps)) {
        updateMessage(msgId, {
          followUps: data.followUps,
          followUpsLoading: false,
        });
      } else {
        updateMessage(msgId, { followUpsLoading: false });
      }
    } catch {
      updateMessage(msgId, { followUpsLoading: false });
    }
  };

  /** Like (positive feedback) — optimistic. */
  const handleLike = async (msgId: string, chatLogId: string) => {
    updateMessage(msgId, {
      feedback: "up",
      showReason: false,
    });
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatLogId, type: "up" }),
      });
    } catch {
      // revert on failure
      updateMessage(msgId, { feedback: null });
    }
  };

  /** Dislike — record immediately + expand reason textarea. */
  const handleDislike = async (msgId: string, chatLogId: string) => {
    updateMessage(msgId, {
      feedback: "down",
      showReason: true,
    });
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatLogId, type: "down" }),
      });
    } catch {
      // ignore — UI state already reflects the user's intent
    }
  };

  /** Submit optional reason for a dislike. */
  const submitReason = async (msgId: string, chatLogId: string) => {
    const msg = messages.find((m) => m.id === msgId);
    const reason = msg?.reasonText || "";
    updateMessage(msgId, { reasonSubmitting: true });
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatLogId, type: "down", reason }),
      });
      updateMessage(msgId, {
        reasonSubmitting: false,
        showReason: false,
      });
    } catch {
      updateMessage(msgId, { reasonSubmitting: false });
    }
  };

  /** Click a follow-up card → fill input & send immediately. */
  const handleFollowUpClick = (q: string) => {
    setInput("");
    void send(q);
  };

  const send = async (overrideQuestion?: string) => {
    const text = (overrideQuestion ?? input).trim();
    if ((!text && !hasImage) || loading) return;

    const userMsg: ChatMessage = {
      id: genId(),
      role: "user",
      content: text || (hasImage ? "请分析这张图片。" : ""),
      image: attachedImage || undefined,
      ts: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setStreaming("");

    const history = messages
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      if (hasImage) {
        // Vision path — pass paper markdown as context so the model can
        // connect the figure with the paper's narrative.
        //
        // NOTE: vision uses its own config (X-Vision-* headers) which can
        // point to a different provider than the text LLM. Falls back to
        // the server-default VISION_* env vars when the user hasn't filled
        // in the vision tab.
        const res = await fetch("/api/vision", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...visionHeadersRef.current },
          body: JSON.stringify({
            prompt: userMsg.content,
            image: attachedImage,
            history,
            paperContext: paperMarkdown || paperText || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setMessages((prev) => [
          ...prev,
          {
            id: genId(),
            role: "assistant",
            content: data.answer,
            ts: Date.now(),
          },
        ]);
        onClearAttachedImage();
      } else {
        // Streaming text path (DeepSeek)
        // Prefer MinerU markdown as the source of truth; fall back to plain text.
        // Always include the user's currently selected paragraph as additional context.
        let context = "";
        const paperSource = paperMarkdown || paperText || "";
        if (paperSource) {
          context = `【论文全文】\n${paperSource.slice(0, 14000)}`;
        }
        if (selectedText) {
          context += `\n\n【用户当前选中的段落】\n"""\n${selectedText.slice(0, 2000)}\n"""`;
        }
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headersRef.current },
          body: JSON.stringify({
            messages: history,
            question: userMsg.content,
            context,
            markdown: paperMarkdown || undefined,
            paperId: paperId || undefined,
          }),
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let acc = "";
        let chatLogId: string | null = null;
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
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload);
              if (json.error) throw new Error(json.error);
              if (json.__meta__?.chatLogId) {
                chatLogId = json.__meta__.chatLogId as string;
                continue;
              }
              if (json.delta) {
                acc += json.delta;
                setStreaming(acc);
              }
            } catch {
              // ignore parse errors on keepalives / partials
            }
          }
        }

        const assistantId = genId();
        const hasChatLog = !!chatLogId;
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            role: "assistant",
            content: acc,
            ts: Date.now(),
            chatLogId: chatLogId || undefined,
            followUpsLoading: hasChatLog,
          },
        ]);
        setStreaming("");

        // Trigger follow-up question fetch in the background
        if (hasChatLog) {
          void fetchFollowUps(assistantId, userMsg.content, acc);
        }
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
          id: genId(),
          role: "assistant",
          content: `出错：${e instanceof Error ? e.message : String(e)}`,
          ts: Date.now(),
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
      setStreaming("");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-3 py-2.5 border-b flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Agent 提问</span>
        <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1.5">
          {hasImage ? "图片+文字" : "DeepSeek"}
        </Badge>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/70 gap-2 text-center px-4">
            <Bot className="h-7 w-7 opacity-30" />
            <p className="text-xs">向 Agent 提问关于这篇文献的任何问题</p>
            <p className="text-[10px]">
              支持文字提问与图片提问（在 PDF 上框选图表后自动附加）
            </p>
            {selectedText && (
              <div className="mt-2 text-[10px] text-primary/80 px-2 py-1 rounded bg-primary/5 border border-primary/20 max-w-full">
                当前选中片段将作为提问上下文
              </div>
            )}
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              "flex gap-2",
              m.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {m.role === "assistant" && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[80%] rounded-lg px-3 py-2 text-[13px] leading-relaxed",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : m.error
                  ? "bg-red-50 text-red-600 dark:bg-red-950/30"
                  : "bg-muted"
              )}
            >
              {m.image && (
                <img
                  src={m.image}
                  alt="attached"
                  className="mb-2 rounded max-w-[200px] max-h-[160px] border border-border/60"
                />
              )}
              {m.role === "assistant" && !m.error ? (
                <div className="chat-markdown break-words">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{m.content}</ReactMarkdown>
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              )}

              {/* Feature 6: follow-ups + feedback row (only for assistant
                  messages that have been persisted to the DB) */}
              {m.role === "assistant" && m.chatLogId && !m.error && (
                <div className="mt-2.5 pt-2 border-t border-border/40 space-y-2">
                  {/* Follow-up cards */}
                  {m.followUpsLoading && (
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      生成延伸追问…
                    </div>
                  )}
                  {!m.followUpsLoading &&
                    m.followUps &&
                    m.followUps.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] text-muted-foreground/80 flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          延伸追问（点击直接发送）
                        </div>
                        {m.followUps.map((q, qi) => (
                          <button
                            key={qi}
                            type="button"
                            onClick={() => handleFollowUpClick(q)}
                            className="group w-full flex items-center gap-1.5 text-left text-[12px] px-2.5 py-1.5 rounded-md border border-border/60 hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-50"
                            disabled={loading}
                          >
                            <Sparkles className="h-3 w-3 text-primary/70 group-hover:text-primary flex-shrink-0" />
                            <span className="flex-1 leading-snug">{q}</span>
                            <ChevronRight className="h-3 w-3 text-muted-foreground/60 group-hover:text-primary flex-shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}

                  {/* Like / dislike row */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-7 px-2 text-[11px] gap-1",
                        m.feedback === "up" &&
                          "text-green-600 bg-green-50 hover:bg-green-100 dark:bg-green-950/30 dark:text-green-400"
                      )}
                      onClick={() => handleLike(m.id, m.chatLogId!)}
                      disabled={loading}
                    >
                      <ThumbsUp className="h-3 w-3" />
                      有帮助
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-7 px-2 text-[11px] gap-1",
                        m.feedback === "down" &&
                          "text-red-600 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 dark:text-red-400"
                      )}
                      onClick={() => handleDislike(m.id, m.chatLogId!)}
                      disabled={loading}
                    >
                      <ThumbsDown className="h-3 w-3" />
                      需改进
                    </Button>
                  </div>

                  {/* Inline reason textarea for dislike */}
                  {m.showReason && (
                    <div className="space-y-1.5">
                      <Textarea
                        value={m.reasonText || ""}
                        onChange={(e) =>
                          updateMessage(m.id, { reasonText: e.target.value })
                        }
                        placeholder="告诉 Agent 哪里需要改进（可选）…"
                        className="min-h-[60px] max-h-[120px] resize-none text-[12px] scrollbar-thin"
                        rows={2}
                      />
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() =>
                            updateMessage(m.id, { showReason: false })
                          }
                          disabled={m.reasonSubmitting}
                        >
                          取消
                        </Button>
                        <Button
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() => submitReason(m.id, m.chatLogId!)}
                          disabled={m.reasonSubmitting}
                        >
                          {m.reasonSubmitting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "提交"
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            {m.role === "user" && (
              <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                <User className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
            )}
          </div>
        ))}

        {streaming && (
          <div className="flex gap-2 justify-start">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="max-w-[80%] rounded-lg px-3 py-2 text-[13px] leading-relaxed bg-muted">
              <div className="chat-markdown break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>{streaming}</ReactMarkdown>
              </div>
              <span className="inline-block w-1.5 h-3.5 bg-primary ml-0.5 animate-pulse align-middle" />
            </div>
          </div>
        )}

        {loading && !streaming && !hasImage && (
          <div className="flex gap-2 justify-start">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
            </div>
            <div className="rounded-lg px-3 py-2 text-[13px] bg-muted text-muted-foreground">
              思考中…
            </div>
          </div>
        )}
      </div>

      {/* attached image preview */}
      {attachedImage && (
        <div className="px-3 pt-2 pb-1 border-t bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-center gap-2">
            <img
              src={attachedImage}
              alt="to-ask"
              className="h-14 w-14 object-cover rounded border border-amber-200 dark:border-amber-800"
            />
            <div className="flex-1 text-xs">
              <div className="font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1">
                <ImageIcon className="h-3 w-3" />
                图片已附加
              </div>
              <div className="text-muted-foreground">
                将使用视觉模型分析这张图片
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={onClearAttachedImage}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* input */}
      <div className="p-2.5 border-t flex gap-2 items-end">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            hasImage
              ? "针对框选的图片提问…（将按四段式解读：读图方法→关键数据→结合原文→一句话总结。Enter 发送）"
              : "向 Agent 提问…（Enter 发送，Shift+Enter 换行）"
          }
          className="min-h-[44px] max-h-[140px] resize-none text-[13px] scrollbar-thin"
          rows={1}
        />
        <Button
          onClick={() => void send()}
          disabled={loading || (!input.trim() && !hasImage)}
          size="sm"
          className="h-9 px-3"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
