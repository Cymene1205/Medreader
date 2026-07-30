"use client";

import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, FileSearch, ChevronRight, Expand, Quote } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export type OutlineChild = {
  id: string;
  title: string;
  summary?: string;
  keywords?: string[];
  quote?: string;
};

export type OutlineSection = {
  id: string;
  title: string;
  summary?: string;
  /** Long-form Markdown analysis (Feature 4) */
  detail?: string;
  /** Top key points (Feature 4) */
  keyPoints?: string[];
  quote?: string;
  children: OutlineChild[];
};

export type PaperHeading = {
  level: number; // 1, 2, or 3 — verbatim H1/H2/H3 from MinerU markdown
  text: string; // Chinese-translated label (for display)
  origText?: string; // verbatim original heading (for block matching)
};

export type Outline = {
  title?: string;
  sections: OutlineSection[];
  /** Verbatim H2/H3 headings extracted from MinerU markdown — used by HeadingNavigator. */
  headings?: PaperHeading[];
};

type Props = {
  outline: Outline | null;
  loading: boolean;
  onChildClick: (child: OutlineChild, section: OutlineSection) => void;
  activeChildId?: string;
  /** Controlled collapse state — when true, only the header is shown. */
  collapsed?: boolean;
  /** Called when the user clicks the collapse toggle. */
  onCollapsedChange?: (collapsed: boolean) => void;
};

// Map section index to dimension color (1-6)
function dimClass(idx: number, suffix: string): string {
  const n = (idx % 6) + 1;
  return `dim-${suffix}-${n}`;
}

export default function OutlinePanel({
  outline,
  loading,
  onChildClick,
  activeChildId,
  collapsed = false,
  onCollapsedChange,
}: Props) {
  const [openItems, setOpenItems] = useState<string[]>([]);
  const [detailSection, setDetailSection] = useState<OutlineSection | null>(null);

  // Helper: fixed px sizes (no zoom — the panel itself collapses instead).
  const fs = (px: number) => `${px}px`;

  return (
    <div className={cn("flex flex-col bg-card", collapsed ? "h-auto" : "h-full")}>
      {/* Header — matches HeadingNavigator's pattern: a full-width button
          row that toggles collapse. Uses ChevronRight with rotate-90 when
          expanded, identical to the 原文段落导航 panel above. */}
      <button
        type="button"
        onClick={() => onCollapsedChange?.(!collapsed)}
        className="w-full px-3 py-2.5 flex items-center gap-2 text-left hover:bg-muted/40 transition-colors flex-shrink-0"
        title={collapsed ? "展开全文框架" : "折叠全文框架"}
        aria-label={collapsed ? "展开全文框架" : "折叠全文框架"}
        aria-expanded={!collapsed}
      >
        <FileSearch className="h-3.5 w-3.5 text-primary flex-shrink-0" />
        <span className="text-[12px] font-semibold flex-1">全文框架</span>
        {outline?.sections?.length ? (
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
            {outline.sections.length} 维度
          </Badge>
        ) : null}
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform flex-shrink-0",
            !collapsed && "rotate-90"
          )}
        />
      </button>
      {!collapsed && <div className="border-b" />}

      {/*
        Body — hidden when collapsed. We keep the Dialog mounted so a
        previously-opened detail dialog doesn't get torn down mid-collapse.
      */}
      {!collapsed && (
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="p-2">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-xs">Agent 正在分析文献…</p>
              <p className="text-[10px] text-muted-foreground/70">
                生成 6 维度结构化大纲（约 30-90 秒）
              </p>
            </div>
          )}

          {!loading && !outline && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/70 gap-2 px-4 text-center">
              <FileSearch className="h-6 w-6 opacity-40" />
              <p className="text-xs">导入 PDF 后，Agent 将自动生成大纲</p>
              <p className="text-[10px]">
                包含 6 个维度：科学问题、论证思路、实验方法与结果、论证逻辑解析、创新性、局限性
              </p>
            </div>
          )}

          {outline && (
            <Accordion
              type="multiple"
              value={openItems}
              onValueChange={setOpenItems}
              className="w-full"
            >
              {outline.sections.map((section, idx) => (
                <AccordionItem
                  key={section.id}
                  value={section.id}
                  className="border-b last:border-0"
                >
                  <div className="flex items-stretch">
                    <div className={cn("w-1 flex-shrink-0", dimClass(idx, "dot"))} />
                    <AccordionTrigger className="hover:no-underline px-2 py-2.5 text-left group flex-1">
                      <div className="flex items-start gap-2 flex-1">
                        <span
                          className={cn(
                            "flex-shrink-0 w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center mt-0.5",
                            dimClass(idx, "bg-soft"),
                            dimClass(idx, "text")
                          )}
                        >
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div
                            className="font-medium leading-snug"
                            style={{ fontSize: fs(13) }}
                          >
                            {section.title}
                          </div>
                          {section.summary && (
                            <div
                              className="text-muted-foreground mt-0.5 line-clamp-2"
                              style={{ fontSize: fs(11) }}
                            >
                              {section.summary}
                            </div>
                          )}
                          {section.keyPoints && section.keyPoints.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {section.keyPoints.slice(0, 3).map((kp, i) => (
                                <span
                                  key={i}
                                  className={cn(
                                    "px-1.5 py-px rounded",
                                    dimClass(idx, "bg-soft"),
                                    dimClass(idx, "text")
                                  )}
                                  style={{ fontSize: fs(9) }}
                                >
                                  {kp.length > 12 ? kp.slice(0, 12) + "…" : kp}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </AccordionTrigger>
                    {section.detail && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 self-center mr-1 flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetailSection(section);
                        }}
                        title="展开完整分析"
                      >
                        <Expand className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <AccordionContent className="pb-1 pt-0 pl-3">
                    <div className="ml-1 pl-2 border-l border-border/60 space-y-0.5">
                      {section.children.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => onChildClick(child, section)}
                          className={cn(
                            "w-full text-left px-2 py-1.5 rounded transition-colors group/item flex items-start gap-1.5",
                            activeChildId === child.id
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted text-foreground/80"
                          )}
                          style={{ fontSize: fs(12) }}
                        >
                          <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0 opacity-50 group-hover/item:opacity-100" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium leading-snug">
                              {child.title}
                            </div>
                            {child.summary && (
                              <div
                                className="text-muted-foreground/80 mt-0.5 line-clamp-2"
                                style={{ fontSize: fs(11) }}
                              >
                                {child.summary}
                              </div>
                            )}
                            {child.keywords && child.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {child.keywords.slice(0, 3).map((kw, i) => (
                                  <span
                                    key={i}
                                    className="px-1 py-px rounded bg-muted text-muted-foreground"
                                    style={{ fontSize: fs(9) }}
                                  >
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </div>
      )}

      {/* Detail Dialog (Feature 4) */}
      <Dialog
        open={!!detailSection}
        onOpenChange={(o) => !o && setDetailSection(null)}
      >
        <DialogContent className="w-[70%] max-w-[900px] max-h-[85vh] flex flex-col p-0 gap-0">
          {detailSection && (
            <>
              <DialogHeader className="px-6 py-4 border-b">
                <DialogTitle className="flex items-center gap-2 text-lg">
                  <span
                    className={cn(
                      "inline-block w-1 h-5 rounded-full",
                      dimClass(
                        (outline?.sections.findIndex((s) => s.id === detailSection.id) ?? 0),
                        "dot"
                      )
                    )}
                  />
                  {detailSection.title}
                </DialogTitle>
                {detailSection.summary && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {detailSection.summary}
                  </p>
                )}
              </DialogHeader>
              <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4 space-y-4">
                {detailSection.keyPoints && detailSection.keyPoints.length > 0 && (
                  <div className="rounded-md bg-muted/40 p-3">
                    <div className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                      核心要点
                    </div>
                    <ul className="space-y-1">
                      {detailSection.keyPoints.map((kp, i) => (
                        <li key={i} className="text-[13px] flex gap-2 leading-relaxed">
                          <span className="text-primary flex-shrink-0">•</span>
                          <span>{kp}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {detailSection.detail && (
                  <div className="chat-markdown text-[15px] leading-[1.8]">
                    <ReactMarkdown>{detailSection.detail}</ReactMarkdown>
                  </div>
                )}
                {detailSection.quote && (
                  <div className="rounded-md border-l-4 border-primary/40 bg-primary/5 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-primary mb-1">
                      <Quote className="h-3 w-3" />
                      原文定位短语
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="block w-full h-auto p-0 text-left text-[12px] italic text-muted-foreground hover:text-primary"
                      onClick={() => {
                        onChildClick(
                          {
                            id: detailSection.id,
                            title: detailSection.title,
                            quote: detailSection.quote,
                            keywords: [],
                          },
                          detailSection
                        );
                        setDetailSection(null);
                      }}
                    >
                      <span className="block whitespace-normal break-words leading-relaxed">
                        &ldquo;{detailSection.quote}&rdquo; — 点击跳转原文
                      </span>
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
