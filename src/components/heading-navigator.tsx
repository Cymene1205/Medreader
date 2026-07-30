"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ListTree, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  StructuredHeading,
  StructuredHeadingChild,
} from "@/components/outline-panel";

type Props = {
  /** LLM-analysed 2-level heading tree (major sections + their children). */
  structuredHeadings: StructuredHeading[] | undefined;
  /** Currently active heading text (the one the reader is showing). */
  activeHeadingText?: string;
  /** Click handler — parent should jump the block reader / PDF to this heading. */
  onHeadingClick: (h: { title: string; origTitle: string }) => void;
  /**
   * Kept for backward compatibility — no longer affects layout. The navigator
   * now always renders at its natural height (capped at 50vh with internal
   * scroll) so the 全文框架 panel below can sit right under the last section
   * instead of being pushed to the bottom of the panel.
   */
  fillContainer?: boolean;
  /**
   * Controlled collapse state. When provided, the parent owns the state
   * (used to auto-collapse both panels when results arrive). When omitted,
   * the component manages its own state internally for backward compat.
   */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
};

/**
 * Render heading text containing inline HTML tags (<sup>...</sup> or
 * <sub>...</sub>) as proper React elements.
 *
 * The heading-translation LLM is told to preserve these tags verbatim
 * (e.g. "SiglecF<sup>hi</sup>"), but React escapes raw text by default —
 * so without this helper, the user sees the literal string "<sup>hi</sup>"
 * instead of a superscript. We split on the two allowed tag patterns and
 * render the wrapped text as <sup>/<sub> React elements.
 *
 * We deliberately only allow these two tags (no attributes, no nesting)
 * to keep the surface area small — the content comes from an LLM, but
 * the LLM was instructed to only emit <sup>/<sub>.
 */
function renderHeadingText(text: string): ReactNode {
  if (!text) return null;
  // Capture <sup>...</sup> and <sub>...</sub> (non-greedy, no nested tags)
  const parts = text.split(/(<sup>[^<]*<\/sup>|<sub>[^<]*<\/sub>)/g);
  return parts.map((part, i) => {
    if (!part) return null;
    const supMatch = part.match(/^<sup>([^<]*)<\/sup>$/);
    if (supMatch) return <sup key={i}>{supMatch[1]}</sup>;
    const subMatch = part.match(/^<sub>([^<]*)<\/sub>$/);
    if (subMatch) return <sub key={i}>{subMatch[1]}</sub>;
    return <span key={i}>{part}</span>;
  });
}

/**
 * Left-side "原文段落导航" panel.
 *
 * Renders the LLM-analysed 2-level heading tree:
 *   - `kind: "major"` sections (Introduction / Results / Discussion /
 *     Methods / ...) appear as collapsible list items with a coloured left
 *     bar (NO outer card border — the user explicitly asked for "only one
 *     frame" instead of nested frames).
 *   - `kind: "metadata"` sections (Novelty and Significance, Data
 *     Availability, ...) are HIDDEN — the user wants the navigator to
 *     show the paper's actual structure, not journal boilerplate.
 *   - Each major section's children appear as indented H2 list items
 *     when expanded.
 *
 * All major sections start COLLAPSED by default.
 *
 * Visual identity (per user request to distinguish from 全文框架):
 *   - Header uses a blue accent (ListTree icon + sky-600 text)
 *   - Each section item has a blue left bar (sky-500)
 *   - No per-item card border — the panel itself is the only "frame"
 *
 * Layout (per user request "全文框架紧跟着最后一个上面的框框"):
 *   - The navigator renders at its natural height (no flex-1 fill).
 *   - Content is capped at 50vh; if there are many sections, the body
 *     scrolls internally instead of pushing the 全文框架 panel to the
 *     bottom of the visible area.
 */
export default function HeadingNavigator({
  structuredHeadings,
  activeHeadingText,
  onHeadingClick,
  fillContainer: _fillContainer = false,
  collapsed: collapsedProp,
  onCollapsedChange,
}: Props) {
  // Backwards-compat: if the parent doesn't control collapse state, manage
  // it locally. When controlled, mirror the prop into local state for the
  // existing internal toggle button to keep working.
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed =
    collapsedProp !== undefined ? collapsedProp : internalCollapsed;
  const toggleCollapsed = () => {
    if (onCollapsedChange) onCollapsedChange(!collapsed);
    else setInternalCollapsed((v) => !v);
  };

  // Only show `kind: "major"` sections in the navigator. Metadata
  // (Novelty and Significance, Data Availability, ...) is hidden — the
  // user can find it in the PDF if needed.
  const majorSections = useMemo(
    () => (structuredHeadings || []).filter((s) => s.kind === "major"),
    [structuredHeadings]
  );

  // All major sections start COLLAPSED. The user clicks a chevron to
  // expand only the section they want. We initialise the set lazily from
  // the section keys so it stays in sync if headings change (new upload).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(majorSections.map((s, i) => `sec-${i}-${s.origTitle.slice(0, 30)}`))
  );
  // Re-initialise when majorSections changes (new upload).
  const [prevRef, setPrevRef] = useState(majorSections);
  if (majorSections !== prevRef) {
    setPrevRef(majorSections);
    setCollapsedGroups(
      new Set(majorSections.map((s, i) => `sec-${i}-${s.origTitle.slice(0, 30)}`))
    );
  }

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalCount = majorSections.length;

  return (
    <div className="border-t border-border/60 bg-card flex flex-col">
      <button
        onClick={toggleCollapsed}
        className={cn(
          "w-full px-3 py-2 flex items-center gap-2 text-left transition-colors flex-shrink-0",
          "hover:bg-sky-50/60 dark:hover:bg-sky-950/30",
          "border-b border-sky-100/70 dark:border-sky-900/40"
        )}
      >
        <ListTree className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400 flex-shrink-0" />
        <span className="text-[12px] font-semibold flex-1 text-sky-700 dark:text-sky-300">
          原文段落导航
        </span>
        <span className="text-[10px] text-muted-foreground">
          {totalCount} 个章节
        </span>
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground transition-transform",
            !collapsed && "rotate-90"
          )}
        />
      </button>

      {!collapsed && (
        <div className="overflow-y-auto scrollbar-thin max-h-[50vh] py-1">
          {majorSections.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground/70">
              {structuredHeadings
                ? "暂无章节"
                : "导入 PDF 后从论文中提取"}
            </div>
          )}

          {majorSections.length > 0 && (
            <ul className="px-1.5 space-y-0.5">
              {majorSections.map((section, idx) => {
                const key = `sec-${idx}-${section.origTitle.slice(0, 30)}`;
                const isGroupCollapsed = collapsedGroups.has(key);
                const sectionActive =
                  activeHeadingText === section.title ||
                  activeHeadingText === section.origTitle;
                const hasChildren =
                  Array.isArray(section.children) &&
                  section.children.length > 0;
                return (
                  <li
                    key={key}
                    className={cn(
                      "rounded-md transition-colors",
                      sectionActive
                        ? "bg-sky-50 dark:bg-sky-950/40"
                        : "hover:bg-muted/40"
                    )}
                  >
                    {/* Major section header — coloured left bar + bold title + chevron.
                        No outer border (per user request: "only one frame"). */}
                    <div className="flex items-center gap-1.5 pr-1.5">
                      {/* Coloured left bar — the ONLY visual "frame" for the section */}
                      <div
                        className={cn(
                          "w-1 self-stretch flex-shrink-0 rounded-full",
                          sectionActive
                            ? "bg-sky-600 dark:bg-sky-400"
                            : "bg-sky-400/70 dark:bg-sky-700/70"
                        )}
                      />
                      <button
                        onClick={() =>
                          onHeadingClick({
                            title: section.title,
                            origTitle: section.origTitle,
                          })
                        }
                        title={section.title}
                        className="flex-1 min-w-0 text-left py-1.5 pl-1"
                      >
                        <span
                          className={cn(
                            "block text-[13px] font-bold leading-snug line-clamp-2",
                            sectionActive
                              ? "text-sky-700 dark:text-sky-300"
                              : "text-foreground"
                          )}
                        >
                          {renderHeadingText(section.title)}
                        </span>
                      </button>
                      {hasChildren && (
                        <button
                          onClick={() => toggleGroup(key)}
                          className="flex-shrink-0 p-1 rounded hover:bg-muted self-stretch flex items-center"
                          title={
                            isGroupCollapsed ? "展开子标题" : "折叠子标题"
                          }
                          aria-label={
                            isGroupCollapsed ? "展开子标题" : "折叠子标题"
                          }
                        >
                          {isGroupCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </button>
                      )}
                    </div>

                    {/* Sub-section children — hidden when the group is collapsed.
                        No border-t separator (avoids the "two frames" feeling). */}
                    {hasChildren && !isGroupCollapsed && (
                      <ul className="pl-3 pr-1 pb-1 pt-0 space-y-0.5">
                        {section.children.map((child: StructuredHeadingChild, ci) => {
                          const childActive =
                            activeHeadingText === child.title ||
                            activeHeadingText === child.origTitle;
                          return (
                            <li key={`child-${ci}-${child.origTitle.slice(0, 20)}`}>
                              <button
                                onClick={() =>
                                  onHeadingClick({
                                    title: child.title,
                                    origTitle: child.origTitle,
                                  })
                                }
                                title={child.title}
                                className={cn(
                                  "w-full text-left px-2 py-1.5 rounded transition-colors",
                                  "text-[12px] font-medium",
                                  childActive
                                    ? "bg-sky-100/80 dark:bg-sky-900/50 text-sky-700 dark:text-sky-300"
                                    : "text-foreground/85 hover:bg-muted"
                                )}
                              >
                                <span className="block leading-snug line-clamp-2">
                                  {renderHeadingText(child.title)}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
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
