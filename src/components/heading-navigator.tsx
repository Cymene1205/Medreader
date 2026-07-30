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
   * When true, the navigator expands to fill its parent container (used when
   * the 全文框架 panel below is collapsed). When false (default), the
   * navigator caps its height at 28vh and lets the 全文框架 panel take the
   * rest of the vertical space.
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
 *     Methods / ...) appear as collapsible H1 cards with a coloured left
 *     bar, bold title, and a chevron toggle.
 *   - `kind: "metadata"` sections (Novelty and Significance, Data
 *     Availability, ...) are HIDDEN — the user wants the navigator to
 *     show the paper's actual structure, not journal boilerplate. They
 *     can still find those sections in the PDF tab.
 *   - Each major section's children (the real sub-sections, e.g.
 *     "梗死心脏中..." under "结果") appear as H2 list items inside the
 *     card when expanded.
 *
 * All major sections start COLLAPSED by default — when a paper has 6+
 * major sections, showing every sub-section inline makes the navigator
 * overwhelming. The user clicks a chevron to expand only the section
 * they care about.
 *
 * Visual hierarchy (per user feedback "背景/方法/结果是大标题，结果下的
 * 具体内容是子标题，需要区分开"):
 *   - H1 (major section card): coloured left bar + bold 13px text +
 *     tinted background — clearly the "high-level" section title
 *   - H2 (sub-section item): medium 12px text, indented — clearly a
 *     sub-section under its parent H1
 */
export default function HeadingNavigator({
  structuredHeadings,
  activeHeadingText,
  onHeadingClick,
  fillContainer = false,
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
    <div
      className={cn(
        "border-t bg-card flex flex-col",
        fillContainer && !collapsed ? "h-full" : ""
      )}
    >
      <button
        onClick={toggleCollapsed}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-muted/40 transition-colors flex-shrink-0"
      >
        <ListTree className="h-3.5 w-3.5 text-primary" />
        <span className="text-[12px] font-semibold flex-1">原文段落导航</span>
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
        <div
          className={cn(
            "overflow-y-auto scrollbar-thin pb-2",
            fillContainer ? "flex-1 min-h-0" : "max-h-[28vh]"
          )}
        >
          {majorSections.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground/70">
              {structuredHeadings
                ? "暂无章节"
                : "导入 PDF 后从论文中提取"}
            </div>
          )}

          {majorSections.length > 0 && (
            <ul className="px-1.5 py-1 space-y-1.5">
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
                      "rounded-md border overflow-hidden",
                      sectionActive
                        ? "border-primary/40 bg-primary/5"
                        : "border-border/60 bg-background"
                    )}
                  >
                    {/* Major section header — coloured left bar + bold title + chevron */}
                    <div
                      className={cn(
                        "flex items-center gap-1.5 pr-1.5 transition-colors",
                        sectionActive ? "bg-primary/10" : "hover:bg-muted/50"
                      )}
                    >
                      {/* Coloured left bar — clearly marks this as a major heading */}
                      <div
                        className={cn(
                          "w-1 self-stretch flex-shrink-0",
                          sectionActive ? "bg-primary" : "bg-primary/50"
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
                        <span className="block text-[13px] font-bold text-foreground leading-snug line-clamp-2">
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

                    {/* Sub-section children — hidden when the group is collapsed */}
                    {hasChildren && !isGroupCollapsed && (
                      <ul className="px-2 pb-1.5 pt-0.5 space-y-0.5 border-t border-border/40">
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
                                  "text-[12px] font-medium pl-3",
                                  childActive
                                    ? "bg-primary/10 text-primary ring-1 ring-primary/20"
                                    : "text-foreground/90 hover:bg-muted"
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
