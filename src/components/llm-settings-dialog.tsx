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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Settings2, Eye, EyeOff, Check, Loader2, ImageIcon, Type } from "lucide-react";

// ---------------------------------------------------------------------------
// LLM (text) settings
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Vision (image / multimodal) settings — independent from LLM
// ---------------------------------------------------------------------------

export type VisionSettings = {
  provider: "zhipu" | "openai" | "anthropic" | "custom";
  baseUrl: string;
  apiKey: string;
  model: string;
};

const VISION_PROVIDER_PRESETS: Record<
  VisionSettings["provider"],
  { baseUrl: string; model: string; label: string; hint: string }
> = {
  zhipu: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4v-flash",
    label: "智谱 GLM-4V（默认）",
    hint: "GLM-4V 系列，免费版 glm-4v-flash 可用",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    label: "OpenAI (gpt-4o)",
    hint: "GPT-4o / GPT-4 Turbo 原生支持图像",
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-sonnet-latest",
    label: "Anthropic Claude（需 OpenAI 兼容代理）",
    hint: "Claude 3.5 Sonnet 支持图像",
  },
  custom: {
    baseUrl: "",
    model: "",
    label: "自定义（OpenAI 兼容多模态）",
    hint: "任意支持 image_url 的 OpenAI 兼容端点",
  },
};

const VISION_STORAGE_KEY = "medreader.vision.settings.v1";

function loadVisionSettings(): VisionSettings {
  if (typeof window === "undefined") {
    return { provider: "zhipu", baseUrl: "", apiKey: "", model: "" };
  }
  try {
    const raw = localStorage.getItem(VISION_STORAGE_KEY);
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
  return { provider: "zhipu", baseUrl: "", apiKey: "", model: "" };
}

function saveVisionSettings(s: VisionSettings) {
  try {
    localStorage.setItem(VISION_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Header hooks
// ---------------------------------------------------------------------------

/**
 * Hook used by chat / translate / analyze callers to attach the user's LLM
 * settings to outgoing fetch requests as X-LLM-* headers.
 */
export function useLLMHeaders() {
  const [headers, setHeaders] = useState<Record<string, string>>({});
  useEffect(() => {
    setHeaders(buildLLMHeaders());
  }, []);
  return headers;
}

/** Build X-LLM-* headers from current localStorage settings. */
export function buildLLMHeaders(): Record<string, string> {
  const s = loadSettings();
  const h: Record<string, string> = {};
  h["X-LLM-Provider"] = s.provider;
  if (s.baseUrl) h["X-LLM-Base-Url"] = s.baseUrl;
  if (s.apiKey) h["X-LLM-Api-Key"] = s.apiKey;
  if (s.model) h["X-LLM-Model"] = s.model;
  return h;
}

/** Backward-compat alias — old callers use refreshLLMHeaders(). */
export function refreshLLMHeaders(): Record<string, string> {
  return buildLLMHeaders();
}

/**
 * Hook used by ChatPanel (the only caller of /api/vision) to attach the
 * user's vision settings to outgoing fetch requests as X-Vision-* headers.
 */
export function useVisionHeaders() {
  const [headers, setHeaders] = useState<Record<string, string>>({});
  useEffect(() => {
    setHeaders(buildVisionHeaders());
  }, []);
  return headers;
}

/** Build X-Vision-* headers from current localStorage settings. */
export function buildVisionHeaders(): Record<string, string> {
  const s = loadVisionSettings();
  const h: Record<string, string> = {};
  if (s.baseUrl) h["X-Vision-Base-Url"] = s.baseUrl;
  if (s.apiKey) h["X-Vision-Api-Key"] = s.apiKey;
  if (s.model) h["X-Vision-Model"] = s.model;
  return h;
}

/** Re-read vision headers from localStorage (call after the dialog closes). */
export function refreshVisionHeaders(): Record<string, string> {
  return buildVisionHeaders();
}

export function hasUserLLMConfig(): boolean {
  const s = loadSettings();
  return !!(s.apiKey && s.baseUrl && s.model);
}

export function hasUserVisionConfig(): boolean {
  const s = loadVisionSettings();
  return !!(s.apiKey && s.baseUrl && s.model);
}

// ---------------------------------------------------------------------------
// Dialog component
// ---------------------------------------------------------------------------

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called after settings are saved — caller should refresh its header snapshot. */
  onSaved?: () => void;
};

export default function LLMSettingsDialog({ open, onOpenChange, onSaved }: Props) {
  const [tab, setTab] = useState<"llm" | "vision">("llm");

  const [draft, setDraft] = useState<LLMSettings>(loadSettings());
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [testMsg, setTestMsg] = useState<string>("");

  const [vDraft, setVDraft] = useState<VisionSettings>(loadVisionSettings());
  const [vShowKey, setVShowKey] = useState(false);
  const [vTesting, setVTesting] = useState(false);
  const [vTestResult, setVTestResult] = useState<"ok" | "fail" | null>(null);
  const [vTestMsg, setVTestMsg] = useState<string>("");

  // Refresh drafts whenever dialog opens
  useEffect(() => {
    if (open) {
      setDraft(loadSettings());
      setVDraft(loadVisionSettings());
      setTestResult(null);
      setTestMsg("");
      setVTestResult(null);
      setVTestMsg("");
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

  const onVisionProviderChange = (p: VisionSettings["provider"]) => {
    const preset = VISION_PROVIDER_PRESETS[p];
    setVDraft((d) => ({
      ...d,
      provider: p,
      baseUrl: d.baseUrl && d.provider === p ? d.baseUrl : preset.baseUrl,
      model: d.model && d.provider === p ? d.model : preset.model,
    }));
    setVTestResult(null);
  };

  const onSave = () => {
    saveSettings(draft);
    saveVisionSettings(vDraft);
    onSaved?.();
    onOpenChange(false);
  };

  const onTestLLM = async () => {
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

  const onTestVision = async () => {
    setVTesting(true);
    setVTestResult(null);
    setVTestMsg("");
    try {
      const res = await fetch("/api/vision-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Vision-Base-Url": vDraft.baseUrl,
          "X-Vision-Api-Key": vDraft.apiKey,
          "X-Vision-Model": vDraft.model,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setVTestResult("ok");
        setVTestMsg(`连通成功。模型返回：${(data.answer as string).slice(0, 60)}`);
      } else {
        setVTestResult("fail");
        setVTestMsg(data.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setVTestResult("fail");
      setVTestMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setVTesting(false);
    }
  };

  const preset = PROVIDER_PRESETS[draft.provider];
  const vPreset = VISION_PROVIDER_PRESETS[vDraft.provider];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            模型设置
          </DialogTitle>
          <DialogDescription>
            文本模型用于 Agent 提问 / 翻译 / 大纲；图像识别模型用于图表问答。两者可以分别配置不同的服务商和 key。配置保存在浏览器本地。
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "llm" | "vision")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="llm" className="text-xs">
              <Type className="h-3.5 w-3.5 mr-1.5" />
              文本模型 LLM
            </TabsTrigger>
            <TabsTrigger value="vision" className="text-xs">
              <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
              图像识别 Vision
            </TabsTrigger>
          </TabsList>

          {/* ─── LLM tab ─────────────────────────────────────────────── */}
          <TabsContent value="llm" className="space-y-3.5 py-2 mt-2">
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
          </TabsContent>

          {/* ─── Vision tab ──────────────────────────────────────────── */}
          <TabsContent value="vision" className="space-y-3.5 py-2 mt-2">
            <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 px-3 py-2 text-[11px] text-blue-700 dark:text-blue-300">
              图像识别模型仅用于「图表提问」功能（ChatPanel 上传截图 / 论文 figure）。
              与文本模型独立，可以选不同的服务商。例如：文本用 DeepSeek，图像用智谱 GLM-4V。
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vision-provider" className="text-xs">
                服务商
              </Label>
              <Select
                value={vDraft.provider}
                onValueChange={(v) => onVisionProviderChange(v as VisionSettings["provider"])}
              >
                <SelectTrigger id="vision-provider" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(VISION_PROVIDER_PRESETS).map(([k, v]) => (
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
              <Label htmlFor="vision-base" className="text-xs">
                Base URL
              </Label>
              <Input
                id="vision-base"
                value={vDraft.baseUrl}
                onChange={(e) => setVDraft((d) => ({ ...d, baseUrl: e.target.value }))}
                placeholder={vPreset.baseUrl || "https://open.bigmodel.cn/api/paas/v4"}
                className="h-9 text-[13px]"
              />
              <p className="text-[10px] text-muted-foreground/70">
                OpenAI 兼容多模态端点，会自动追加 <code>/chat/completions</code>
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vision-key" className="text-xs">
                API Key
              </Label>
              <div className="relative">
                <Input
                  id="vision-key"
                  type={vShowKey ? "text" : "password"}
                  value={vDraft.apiKey}
                  onChange={(e) => setVDraft((d) => ({ ...d, apiKey: e.target.value }))}
                  placeholder="ab99-xxxxxxxxxxxx"
                  className="h-9 text-[13px] pr-9 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setVShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {vShowKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="vision-model" className="text-xs">
                模型名
              </Label>
              <Input
                id="vision-model"
                value={vDraft.model}
                onChange={(e) => setVDraft((d) => ({ ...d, model: e.target.value }))}
                placeholder={vPreset.model || "glm-4v-flash"}
                className="h-9 text-[13px] font-mono"
              />
              <p className="text-[10px] text-muted-foreground/70">
                如留空且未在 .env 中配置 <code>VISION_MODEL</code>，服务端默认 <code>glm-4v-flash</code>
              </p>
            </div>

            {vTestResult && (
              <div
                className={
                  "text-[11px] rounded-md px-2.5 py-2 " +
                  (vTestResult === "ok"
                    ? "bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300"
                    : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300")
                }
              >
                <div className="flex items-start gap-1.5">
                  {vTestResult === "ok" ? (
                    <Check className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  ) : (
                    <span className="font-bold flex-shrink-0">×</span>
                  )}
                  <span className="break-all">{vTestMsg}</span>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          {tab === "llm" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onTestLLM}
              disabled={testing || !draft.apiKey || !draft.baseUrl}
              className="h-8"
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              测试连接
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={onTestVision}
              disabled={vTesting || !vDraft.apiKey || !vDraft.baseUrl}
              className="h-8"
            >
              {vTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              测试连接
            </Button>
          )}
          <Button size="sm" onClick={onSave} disabled={!draft.apiKey && !vDraft.apiKey} className="h-8">
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { loadSettings, saveSettings, loadVisionSettings, saveVisionSettings, PROVIDER_PRESETS, VISION_PROVIDER_PRESETS };
