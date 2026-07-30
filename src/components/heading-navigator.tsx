"use client";

import { useMemo, useState } from "react";
import { ListTree, ChevronRight, Hash } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type PaperHeading = {
  level: number; // 2 or 3
  text: string; // verbatim heading text
};

type Props = {
  /** Verbatim H2/H3 headings extracted from MinerU markdown by /api/analyze. */
  headings: PaperHeading[] | undefined;
  /** Currently active heading text (the one the reader is showing). */
  activeHeadingText?: string;
  /** Click handler — parent should jump the block reader / PDF to this heading. */
  onHeadingClick: (h: PaperHeading) => void;
};

/**
 * Left-side "原文段落导航" panel.
 *
 * Lists all verbatim H2/H3 headings extracted from the MinerU markdown so the
 * user can click any of them to jump to the exact paragraph in the block
 * reader. Unlike the 6-dimension outline (which is LLM-generated and may
 * paraphrase), these headings are EXACT strings from the paper — so the
 * block reader's `findBlockIndex` always lands on the right block.
 */
export default function HeadingNavigator({
  headings,
  activeHeadingText,
  onHeadingClick,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const h2 = useMemo(() => (headings || []).filter((h) => h.level === 2), [headings]);
  const h3 = useMemo(() => (headings || []).filter((h) => h.level === 3), [headings]);

  return (
    <div className="border-t bg-card">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-muted/40 transition-colors"
      >
        <ListTree className="h-3.5 w-3.5 text-primary" />
        <span className="text-[12px] font-semibold flex-1">原文段落导航</span>
        <span className="text-[10px] text-muted-foreground">
          {headings?.length || 0} 个标题
        </span>
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform",
            !collapsed && "rotate-90"
          )}
        />
      </button>

      {!collapsed && (
        <div className="max-h-[40vh] overflow-y-auto scrollbar-thin pb-2">
          {(!headings || headings.length === 0) && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground/70">
              {headings ? "暂无 H2/H3 标题" : "导入 PDF 后从论文中提取"}
            </div>
          )}

          {headings && headings.length > 0 && (
            <ul className="px-1.5 space-y-0.5">
              {headings.map((h, idx) => {
                const isActive = activeHeadingText && activeHeadingText === h.text;
                const isH2 = h.level === 2;
                return (
                  <li key={idx}>
                    <button
                      onClick={() => onHeadingClick(h)}
                      className={cn(
                        "w-full text-left px-2 py-1.5 rounded text-[11.5px] transition-colors flex items-start gap-1.5",
                        isH2 ? "font-semibold" : "font-normal pl-5",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-muted text-foreground/80"
                      )}
                      title={h.text}
                    >
                      {isH2 ? (
                        <Hash className="h-3 w-3 mt-0.5 flex-shrink-0 opacity-60" />
                      ) : (
                        <span className="text-muted-foreground/40 mt-0.5 flex-shrink-0">·</span>
                      )}
                      <span className="flex-1 leading-snug line-clamp-2">{h.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
