"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings2, Eye, EyeOff, Check, Loader2 } from "lucide-react";

export type LLMSettings = {
  provider: "deepseek" | "openai" | "zhipu" | "moonshot" | "anthropic" | "custom";
  baseUrl: string;
  apiKey: string;
  model: string;
};

const PROVIDER_PRESETS: Record<
  LLMSettings["provider"],
  { baseUrl: string; model: string; label: string; hint: string }
> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    label: "DeepSeek（默认）",
    hint: "DeepSeek 官方 OpenAI 兼容接口",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    label: "OpenAI",
    hint: "GPT-4o / GPT-4 Turbo 等",
  },
  zhipu: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    label: "智谱 GLM",
    hint: "GLM-4 系列（智谱清言）",
  },
  moonshot: {
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    label: "Moonshot Kimi",
    hint: "Kimi 长上下文模型",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-sonnet-latest",
    label: "Anthropic Claude（需 OpenAI 兼容代理）",
    hint: "Claude 3.5 Sonnet 等",
  },
  custom: {
    baseUrl: "",
    model: "",
    label: "自定义（OpenAI 兼容）",
    hint: "任意 OpenAI 兼容端点：vLLM / Ollama / Together / Azure 等",
  },
};

const STORAGE_KEY = "medreader.llm.settings.v1";

function loadSettings(): LLMSettings {
  if (typeof window === "undefined") {
    return { provider: "deepseek", baseUrl: "", apiKey: "", model: "" };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.provider) {
        return {
          provider: parsed.provider,
          baseUrl: parsed.baseUrl || "",
          apiKey: parsed.apiKey || "",
          model: parsed.model || "",
        };
      }
    }
  } catch {
    // ignore
  }
  return { provider: "deepseek", baseUrl: "", apiKey: "", model: "" };
}

function saveSettings(s: LLMSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

/**
 * Hook used by chat / translate / vision / analyze callers to attach the
 * user's LLM settings to outgoing fetch requests as headers.
 */
export function useLLMHeaders() {
  const [headers, setHeaders] = useState<Record<string, string>>({});
  useEffect(() => {
    const s = loadSettings();
    const h: Record<string, string> = {};
    h["X-LLM-Provider"] = s.provider;
    if (s.baseUrl) h["X-LLM-Base-Url"] = s.baseUrl;
    if (s.apiKey) h["X-LLM-Api-Key"] = s.apiKey;
    if (s.model) h["X-LLM-Model"] = s.model;
    setHeaders(h);
  }, []);
  return headers;
}

/** Re-read settings from localStorage (call after the dialog closes). */
export function refreshLLMHeaders(): Record<string, string> {
  const s = loadSettings();
  const h: Record<string, string> = {};
  h["X-LLM-Provider"] = s.provider;
  if (s.baseUrl) h["X-LLM-Base-Url"] = s.baseUrl;
  if (s.apiKey) h["X-LLM-Api-Key"] = s.apiKey;
  if (s.model) h["X-LLM-Model"] = s.model;
  return h;
}

export function hasUserLLMConfig(): boolean {
  const s = loadSettings();
  return !!(s.apiKey && s.baseUrl && s.model);
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called after settings are saved — caller should refresh its header snapshot. */
  onSaved?: () => void;
};

export default function LLMSettingsDialog({ open, onOpenChange, onSaved }: Props) {
  const [draft, setDraft] = useState<LLMSettings>(loadSettings());
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [testMsg, setTestMsg] = useState<string>("");

  // Refresh draft whenever dialog opens
  useEffect(() => {
    if (open) {
      setDraft(loadSettings());
      setTestResult(null);
      setTestMsg("");
    }
  }, [open]);

  const onProviderChange = (p: LLMSettings["provider"]) => {
    const preset = PROVIDER_PRESETS[p];
    setDraft((d) => ({
      ...d,
      provider: p,
      baseUrl: d.baseUrl && d.provider === p ? d.baseUrl : preset.baseUrl,
      model: d.model && d.provider === p ? d.model : preset.model,
    }));
    setTestResult(null);
  };

  const onSave = () => {
    saveSettings(draft);
    onSaved?.();
    onOpenChange(false);
  };

  const onTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestMsg("");
    try {
      const res = await fetch("/api/llm-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LLM-Provider": draft.provider,
          "X-LLM-Base-Url": draft.baseUrl,
          "X-LLM-Api-Key": draft.apiKey,
          "X-LLM-Model": draft.model,
        },
        body: JSON.stringify({ prompt: "请回答：1+1=" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.answer) {
        setTestResult("ok");
        setTestMsg(`连通成功。模型返回：${(data.answer as string).slice(0, 60)}`);
      } else {
        setTestResult("fail");
        setTestMsg(data.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setTestResult("fail");
      setTestMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const preset = PROVIDER_PRESETS[draft.provider];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            LLM 模型设置
          </DialogTitle>
          <DialogDescription>
            选择并配置一个 OpenAI 兼容的大语言模型。所有调用都会使用此模型，包括大纲生成、翻译、Agent 提问。
            配置保存在浏览器本地，不会上传到服务器数据库。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="llm-provider" className="text-xs">
              服务商
            </Label>
            <Select
              value={draft.provider}
              onValueChange={(v) => onProviderChange(v as LLMSettings["provider"])}
            >
              <SelectTrigger id="llm-provider" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(PROVIDER_PRESETS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    <div className="flex flex-col">
                      <span className="text-[13px]">{v.label}</span>
                      <span className="text-[10px] text-muted-foreground">{v.hint}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="llm-base" className="text-xs">
              Base URL
            </Label>
            <Input
              id="llm-base"
              value={draft.baseUrl}
              onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
              placeholder={preset.baseUrl || "https://api.example.com/v1"}
              className="h-9 text-[13px]"
            />
            <p className="text-[10px] text-muted-foreground/70">
              OpenAI 兼容端点，会自动追加 <code>/chat/completions</code>
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="llm-key" className="text-xs">
              API Key
            </Label>
            <div className="relative">
              <Input
                id="llm-key"
                type={showKey ? "text" : "password"}
                value={draft.apiKey}
                onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
                placeholder="sk-xxxxxxxxxxxx"
                className="h-9 text-[13px] pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="llm-model" className="text-xs">
              模型名
            </Label>
            <Input
              id="llm-model"
              value={draft.model}
              onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
              placeholder={preset.model || "model-name"}
              className="h-9 text-[13px] font-mono"
            />
          </div>

          {testResult && (
            <div
              className={
                "text-[11px] rounded-md px-2.5 py-2 " +
                (testResult === "ok"
                  ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300"
                  : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300")
              }
            >
              <div className="flex items-start gap-1.5">
                {testResult === "ok" ? (
                  <Check className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                ) : (
                  <span className="font-bold flex-shrink-0">×</span>
                )}
                <span className="break-all">{testMsg}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={testing || !draft.apiKey || !draft.baseUrl}
            className="h-8"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            测试连接
          </Button>
          <Button size="sm" onClick={onSave} disabled={!draft.apiKey} className="h-8">
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { loadSettings, saveSettings, PROVIDER_PRESETS };
