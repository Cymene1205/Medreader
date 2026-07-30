"use client";

import { useState } from "react";
import { ListTree, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type PaperHeading = {
  level: number; // 1, 2, or 3
  text: string; // verbatim heading text (no leading #)
};

type Props = {
  /** Verbatim H1/H2/H3 headings extracted from MinerU markdown by /api/analyze. */
  headings: PaperHeading[] | undefined;
  /** Currently active heading text (the one the reader is showing). */
  activeHeadingText?: string;
  /** Click handler — parent should jump the block reader / PDF to this heading. */
  onHeadingClick: (h: PaperHeading) => void;
};

/**
 * Left-side "原文段落导航" panel.
 *
 * Lists all verbatim H1/H2/H3 headings extracted from the MinerU markdown so the
 * user can click any of them to jump to the exact paragraph in the block
 * reader. Unlike the 6-dimension outline (which is LLM-generated and may
 * paraphrase), these headings are EXACT strings from the paper — so the
 * block reader's `findBlockIndex` always lands on the right block.
 *
 * Visual differentiation by level:
 *   - H1: bold + slightly larger text + accent color (text-primary)
 *   - H2: medium weight + normal color (default look)
 *   - H3: smaller + muted color + deeper indentation
 *
 * No "#" prefix is rendered — the level is conveyed by typography & indentation
 * alone, which matches the user's request.
 */
export default function HeadingNavigator({
  headings,
  activeHeadingText,
  onHeadingClick,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

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
        <div className="max-h-[28vh] overflow-y-auto scrollbar-thin pb-2">
          {(!headings || headings.length === 0) && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground/70">
              {headings ? "暂无标题" : "导入 PDF 后从论文中提取"}
            </div>
          )}

          {headings && headings.length > 0 && (
            <ul className="px-1.5 space-y-0.5">
              {headings.map((h, idx) => {
                const isActive = activeHeadingText && activeHeadingText === h.text;
                const level = h.level || 2;
                return (
                  <li key={idx}>
                    <button
                      onClick={() => onHeadingClick(h)}
                      title={h.text}
                      className={cn(
                        "w-full text-left px-2 py-1.5 rounded transition-colors",
                        // Typography by level
                        level === 1
                          ? "text-[12.5px] font-bold text-foreground"
                          : level === 2
                          ? "text-[12px] font-medium text-foreground/90"
                          : "text-[11px] font-normal text-muted-foreground",
                        // Indentation by level
                        level === 1
                          ? "pl-2"
                          : level === 2
                          ? "pl-4"
                          : "pl-7",
                        // Active / hover state
                        isActive
                          ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                          : "hover:bg-muted"
                      )}
                    >
                      <span className="block leading-snug line-clamp-2">
                        {h.text}
                      </span>
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
