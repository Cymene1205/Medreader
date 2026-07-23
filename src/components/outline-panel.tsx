"use client";

import { useState } from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileSearch, ChevronRight } from "lucide-react";
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
  children: OutlineChild[];
};

export type Outline = {
  title?: string;
  sections: OutlineSection[];
};

type Props = {
  outline: Outline | null;
  loading: boolean;
  onChildClick: (child: OutlineChild, section: OutlineSection) => void;
  activeChildId?: string;
};

export default function OutlinePanel({
  outline,
  loading,
  onChildClick,
  activeChildId,
}: Props) {
  const [openItems, setOpenItems] = useState<string[]>([]);

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-3 py-2.5 border-b flex items-center gap-2">
        <FileSearch className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">全文框架</span>
        {outline?.sections?.length ? (
          <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1.5">
            {outline.sections.length} 维度
          </Badge>
        ) : null}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        <div className="p-2">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-xs">Agent 正在分析文献…</p>
              <p className="text-[10px] text-muted-foreground/70">
                生成 6 维度层次化大纲（约 30-60 秒）
              </p>
            </div>
          )}

          {!loading && !outline && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/70 gap-2 px-4 text-center">
              <FileSearch className="h-6 w-6 opacity-40" />
              <p className="text-xs">导入 PDF 后，Agent 将自动生成大纲</p>
              <p className="text-[10px]">
                包含 6 个维度：科学问题、逻辑证明、实验技术、关键点、逻辑总结、衍生课题
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
                  <AccordionTrigger className="hover:no-underline px-2 py-2.5 text-left group">
                    <div className="flex items-start gap-2 flex-1">
                      <span
                        className={cn(
                          "flex-shrink-0 w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center mt-0.5",
                          "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
                        )}
                      >
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium leading-snug">
                          {section.title}
                        </div>
                        {section.summary && (
                          <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                            {section.summary}
                          </div>
                        )}
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-1 pt-0">
                    <div className="ml-7 pl-2 border-l border-border/60 space-y-0.5">
                      {section.children.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => onChildClick(child, section)}
                          className={cn(
                            "w-full text-left px-2 py-1.5 rounded text-[12px] transition-colors group/item flex items-start gap-1.5",
                            activeChildId === child.id
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-muted text-foreground/80"
                          )}
                        >
                          <ChevronRight className="h-3 w-3 mt-0.5 flex-shrink-0 opacity-50 group-hover/item:opacity-100" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium leading-snug">
                              {child.title}
                            </div>
                            {child.summary && (
                              <div className="text-[11px] text-muted-foreground/80 mt-0.5 line-clamp-2">
                                {child.summary}
                              </div>
                            )}
                            {child.keywords && child.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {child.keywords.slice(0, 3).map((kw, i) => (
                                  <span
                                    key={i}
                                    className="text-[9px] px-1 py-px rounded bg-muted text-muted-foreground"
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
    </div>
  );
}
