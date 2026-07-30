"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ListTree, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type PaperHeading = {
  level: number; // 1, 2, or 3
  text: string; // Chinese-translated label (for display)
  origText?: string; // verbatim original heading (for block matching)
};

type Props = {
  /** Verbatim H1/H2/H3 headings extracted from MinerU markdown by /api/analyze. */
  headings: PaperHeading[] | undefined;
  /** Currently active heading text (the one the reader is showing). */
  activeHeadingText?: string;
  /** Click handler — parent should jump the block reader / PDF to this heading. */
  onHeadingClick: (h: PaperHeading) => void;
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
 * A group of headings anchored by an H1 (or, for headings appearing before
 * any H1, an "ungrouped" pseudo-group with key `__pre__`).
 */
type HeadingGroup = {
  key: string;
  h1: PaperHeading | null;
  children: PaperHeading[];
};

/**
 * Walk the flat headings list and group consecutive H2/H3 under their
 * nearest preceding H1. Headings before any H1 form an "ungrouped" block.
 *
 * We also gracefully handle papers that have no H1 (only H2/H3): in that
 * case every heading ends up in the ungrouped block and we render a flat
 * list with no collapsible group headers.
 */
function groupHeadings(headings: PaperHeading[]): HeadingGroup[] {
  const groups: HeadingGroup[] = [];
  let current: HeadingGroup | null = null;
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    if (h.level === 1) {
      current = { key: `h1-${i}-${h.text.slice(0, 40)}`, h1: h, children: [] };
      groups.push(current);
    } else {
      // H2/H3 — attach to the current group, or start an ungrouped block.
      if (!current) {
        current = { key: "__pre__", h1: null, children: [] };
        groups.push(current);
      }
      current.children.push(h);
    }
  }
  return groups;
}

/**
 * Render heading text containing inline HTML tags (<sup>...</sup> or
 * <sub>...</sub>) as proper React elements.
 *
 * The heading translation LLM is told to preserve these tags verbatim
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
 * Lists all verbatim H1/H2/H3 headings extracted from the MinerU markdown so the
 * user can click any of them to jump to the exact paragraph in the block
 * reader. Unlike the 6-dimension outline (which is LLM-generated and may
 * paraphrase), these headings are EXACT strings from the paper — so the
 * block reader's `findBlockIndex` always lands on the right block.
 *
 * Headings are grouped by their parent H1: each H1 becomes a collapsible
 * "section card" (addressing the older feedback "把文章结果部分的主要标题
 * 放在折叠框里以便精确锁定位置"). Clicking the H1 text jumps to it; clicking
 * the small chevron on the right collapses/expands its H2/H3 children.
 *
 * Visual differentiation by level (strengthened per user feedback
 * "method/result/introduction/conclusion 这样的肯定是高一级的标题...
 *  需要区分开"):
 *   - H1 (group header): card-style with colored left bar, larger bold text,
 *     tinted background — clearly the "high-level" section title
 *   - H2: medium weight, normal color, indented — clearly a sub-section
 *   - H3: smaller + muted color + deeper indentation — clearly a sub-sub
 *
 * All H1 groups start COLLAPSED by default (user feedback "结果有六七个,
 * 可以搞个折叠这样的") — when a paper has 6+ H1 sections, showing every
 * H2/H3 inline makes the navigator overwhelming. The user clicks a chevron
 * to expand only the H1 group they care about.
 *
 * No "#" prefix is rendered — the level is conveyed by typography,
 * indentation, and the colored left bar alone.
 */
export default function HeadingNavigator({
  headings,
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

  const groups = useMemo(() => {
    if (!headings || headings.length === 0) return [];
    return groupHeadings(headings);
  }, [headings]);

  // Has at least one real H1 group? If not, fall back to flat rendering.
  const hasH1Groups = groups.some((g) => g.h1 !== null);

  // All H1 groups start COLLAPSED. The user clicks a chevron to expand
  // only the group they want. We initialise the set lazily from the group
  // keys so it stays in sync if headings change (new upload).
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(groups.filter((g) => g.h1).map((g) => g.key))
  );
  // Re-initialise when groups change (new upload). Using useEffect would
  // cause a flicker; useMemo + useState comparison is cleaner — but the
  // simplest correct approach is to track the previous headings array ref
  // and reset when it changes.
  const [prevHeadingsRef, setPrevHeadingsRef] = useState(headings);
  if (headings !== prevHeadingsRef) {
    setPrevHeadingsRef(headings);
    setCollapsedGroups(new Set(groups.filter((g) => g.h1).map((g) => g.key)));
  }

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
        <div
          className={cn(
            "overflow-y-auto scrollbar-thin pb-2",
            fillContainer ? "flex-1 min-h-0" : "max-h-[28vh]"
          )}
        >
          {(!headings || headings.length === 0) && (
            <div className="px-3 py-2 text-[11px] text-muted-foreground/70">
              {headings ? "暂无标题" : "导入 PDF 后从论文中提取"}
            </div>
          )}

          {/* Grouped rendering — H1 becomes a collapsible card with H2/H3 children. */}
          {headings && headings.length > 0 && hasH1Groups && (
            <ul className="px-1.5 py-1 space-y-1.5">
              {groups.map((g) => {
                const isGroupCollapsed = collapsedGroups.has(g.key);
                const h1Active =
                  g.h1 && activeHeadingText === g.h1.text;
                return (
                  <li
                    key={g.key}
                    className={cn(
                      "rounded-md border overflow-hidden",
                      h1Active
                        ? "border-primary/40 bg-primary/5"
                        : "border-border/60 bg-background"
                    )}
                  >
                    {/* H1 group header — colored left bar + bold title + chevron */}
                    {g.h1 && (
                      <div
                        className={cn(
                          "flex items-center gap-1.5 pr-1.5 transition-colors",
                          h1Active ? "bg-primary/10" : "hover:bg-muted/50"
                        )}
                      >
                        {/* Colored left bar — clearly marks this as a "high-level" heading */}
                        <div
                          className={cn(
                            "w-1 self-stretch flex-shrink-0",
                            h1Active ? "bg-primary" : "bg-primary/50"
                          )}
                        />
                        <button
                          onClick={() => onHeadingClick(g.h1!)}
                          title={g.h1.text}
                          className="flex-1 min-w-0 text-left py-1.5 pl-1"
                        >
                          <span className="block text-[13px] font-bold text-foreground leading-snug line-clamp-2">
                            {renderHeadingText(g.h1.text)}
                          </span>
                        </button>
                        <button
                          onClick={() => toggleGroup(g.key)}
                          className="flex-shrink-0 p-1 rounded hover:bg-muted self-stretch flex items-center"
                          title={isGroupCollapsed ? "展开子标题" : "折叠子标题"}
                          aria-label={isGroupCollapsed ? "展开子标题" : "折叠子标题"}
                        >
                          {isGroupCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                    )}

                    {/* Ungrouped (no H1 above) — render children flat at top level */}
                    {!g.h1 && g.children.length > 0 && (
                      <ul className="space-y-0.5 p-1">
                        {g.children.map((h, i) => (
                          <FlatHeadingItem
                            key={`pre-${i}-${h.text.slice(0, 20)}`}
                            h={h}
                            isActive={!!activeHeadingText && activeHeadingText === h.text}
                            onClick={() => onHeadingClick(h)}
                          />
                        ))}
                      </ul>
                    )}

                    {/* H2/H3 children — hidden when the group is collapsed */}
                    {g.h1 && !isGroupCollapsed && g.children.length > 0 && (
                      <ul className="px-2 pb-1.5 pt-0.5 space-y-0.5 border-t border-border/40">
                        {g.children.map((h, i) => (
                          <FlatHeadingItem
                            key={`${g.key}-${i}-${h.text.slice(0, 20)}`}
                            h={h}
                            isActive={!!activeHeadingText && activeHeadingText === h.text}
                            onClick={() => onHeadingClick(h)}
                          />
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Flat rendering — when no H1 exists, just list everything inline. */}
          {headings && headings.length > 0 && !hasH1Groups && (
            <ul className="px-1.5 py-1 space-y-0.5">
              {headings.map((h, idx) => (
                <FlatHeadingItem
                  key={idx}
                  h={h}
                  isActive={!!activeHeadingText && activeHeadingText === h.text}
                  onClick={() => onHeadingClick(h)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Render a single (non-H1) heading button with consistent typography by level.
 * Used both inside group children lists and in the flat fallback list.
 *
 * Visual hierarchy (per user feedback):
 *   - H2: clearly a sub-section — medium font, normal color, indented 12px
 *   - H3: clearly a sub-sub — smaller font, muted color, indented 24px
 */
function FlatHeadingItem({
  h,
  isActive,
  onClick,
}: {
  h: PaperHeading;
  isActive: boolean;
  onClick: () => void;
}) {
  const level = h.level || 2;
  return (
    <li>
      <button
        onClick={onClick}
        title={h.text}
        className={cn(
          "w-full text-left px-2 py-1.5 rounded transition-colors",
          // Typography by level — stronger differentiation than before
          level === 2
            ? "text-[12px] font-medium text-foreground/90"
            : "text-[11px] font-normal text-muted-foreground",
          // Indentation by level
          level === 2 ? "pl-3" : "pl-6",
          // Active / hover state
          isActive
            ? "bg-primary/10 text-primary ring-1 ring-primary/20"
            : "hover:bg-muted"
        )}
      >
        <span className="block leading-snug line-clamp-2">
          {renderHeadingText(h.text)}
        </span>
      </button>
    </li>
  );
}
