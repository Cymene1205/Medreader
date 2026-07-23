"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  image?: string; // base64 data URL
  ts: number;
  error?: boolean;
};

type Props = {
  /** base64 image attached from PDF drag-select */
  attachedImage: string | null;
  onClearAttachedImage: () => void;
  /** selected text from PDF, used as additional chat context */
  selectedText: string;
  /** full paper text extracted from the PDF — always passed as base context */
  paperText?: string;
};

export default function ChatPanel({
  attachedImage,
  onClearAttachedImage,
  selectedText,
  paperText,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  // Pre-fill prompt placeholder with image
  const hasImage = !!attachedImage;

  const send = async () => {
    const text = input.trim();
    if ((!text && !hasImage) || loading) return;

    const userMsg: ChatMessage = {
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
        // Vision path — pass paper text as context so the model can connect
        // the figure with the paper's narrative
        const res = await fetch("/api/vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: userMsg.content,
            image: attachedImage,
            history,
            paperContext: paperText || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.answer, ts: Date.now() },
        ]);
        onClearAttachedImage();
      } else {
        // Streaming text path (DeepSeek)
        // Combine paper text (always) + currently selected snippet (if any)
        let context = "";
        if (paperText) {
          context = `【论文全文】\n${paperText.slice(0, 10000)}`;
        }
        if (selectedText) {
          context += `\n\n【用户当前选中的原文片段】\n"""\n${selectedText.slice(0, 2000)}\n"""`;
        }
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            question: userMsg.content,
            context,
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
              if (json.delta) {
                acc += json.delta;
                setStreaming(acc);
              }
            } catch {
              // ignore
            }
          }
        }
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: acc, ts: Date.now() },
        ]);
        setStreaming("");
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        {
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
      send();
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

        {messages.map((m, i) => (
          <div
            key={i}
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
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
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
                <ReactMarkdown>{streaming}</ReactMarkdown>
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
          onClick={send}
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
