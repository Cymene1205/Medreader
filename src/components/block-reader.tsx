"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  useCallback,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import {
  Loader2,
  FileText,
  Image as ImageIcon,
  Table as TableIcon,
  Hash,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type MinerUBlock = {
  type: string;
  text?: string;
  text_level?: number;
  text_format?: any;
  content?: any;
  img_path?: string;
  bbox?: [number, number, number, number];
  page_idx?: number;
  table_body?: string;
  table_caption?: string;
  table_footnote?: string;
  chart_caption?: string;
  chart_footnote?: string;
};

export type BlockReaderHandle = {
  scrollToText: (quote: string, keywords: string[]) => void;
};

type Props = {
  fallbackText: string | null;
  markdown: string | null;
  blocks: MinerUBlock[] | null;
  imagesDir: string | null;
  loading: boolean;
  statusMessage?: string;
  onParagraphClick?: (text: string, blockIdx: number) => void;
  highlightToken?: { quote: string; keywords: string[]; nonce: number } | null;
};

/**
 * Strip MinerU's over-escaped markdown punctuation.
 * MinerU outputs things like "Ehsan Vafadarnejad,\* Giuseppe Rizzo,\* ..."
 * The backslash before * is wrong — these are author name separators, not
 * emphasis markers. Strip them so the text renders cleanly.
 */
function cleanMinerUText(s: string): string {
  if (!s) return "";
  return s
    // \*  → * (MinerU over-escapes asterisks used as author separators)
    .replace(/\\\*/g, "*")
    // \_  → _
    .replace(/\\_/g, "_")
    // \# at start of line — keep as heading marker if intended; but if escaped,
    // MinerU sometimes escapes inappropriately. Only unescape mid-line.
    .replace(/(?!^)\\#/g, "#");
}

/**
 * Block-level reader — renders MinerU's content_list.json as a stream of
 * discrete blocks (headings, paragraphs, tables, figures, equations).
 *
 * - Single-click a paragraph → triggers onParagraphClick for translation.
 * - Outline clicks → highlightToken → scroll to best-matching block + flash.
 * - In-reader search bar (Ctrl+F-like) — highlights & navigates matches.
 */
const BlockReader = forwardRef<BlockReaderHandle, Props>(function BlockReader(
  { fallbackText, markdown, blocks, imagesDir, loading, statusMessage, onParagraphClick, highlightToken },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  // In-reader search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [searchCursor, setSearchCursor] = useState(0);

  const hasBlocks = blocks && blocks.length > 0;

  // Filter blocks to only render the readable content (skip page_number, footer noise).
  const renderBlocks = useMemo(() => {
    if (!blocks) return [];
    return blocks
      .map((b, i) => ({ ...b, _idx: i }))
      .filter((b) => {
        const t = (b.type || "").toLowerCase();
        return t !== "page_number" && t !== "header" && t !== "footer" && t !== "aside_text";
      });
  }, [blocks]);

  // Image URL helper: maps MinerU's images/xxx.jpg to /api/paper-images?...
  const imageUrl = useCallback(
    (imgPath?: string): string | null => {
      if (!imgPath || !imagesDir) return null;
      const name = imgPath.split("/").pop() || "";
      return `/api/paper-images?dir=${encodeURIComponent(imagesDir)}&name=${encodeURIComponent(name)}`;
    },
    [imagesDir]
  );

  // Imperative handle for outline clicks.
  useImperativeHandle(
    ref,
    () => ({
      scrollToText: (quote: string, keywords: string[]) => {
        if (!blocks || blocks.length === 0) return;
        const idx = findBlockIndex(blocks, quote, keywords);
        if (idx < 0) return;
        const el = blockRefs.current[idx];
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("block-flash");
          setTimeout(() => el.classList.remove("block-flash"), 2200);
          setActiveIdx(idx);
        }
      },
    }),
    [blocks]
  );

  // React to highlightToken (from outline click) — scroll & flash.
  useEffect(() => {
    if (!highlightToken || !blocks || blocks.length === 0) return;
    const { quote, keywords } = highlightToken;
    const idx = findBlockIndex(blocks, quote, keywords);
    if (idx < 0) return;
    const el = blockRefs.current[idx];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("block-flash");
      setTimeout(() => el.classList.remove("block-flash"), 2200);
      setActiveIdx(idx);
    }
  }, [highlightToken, blocks]);

  // Compute search matches whenever query or blocks change
  useEffect(() => {
    if (!searchQuery.trim() || !blocks) {
      setSearchMatches([]);
      setSearchCursor(0);
      return;
    }
    const q = searchQuery.toLowerCase();
    const idxs: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const t = (blocks[i].text || blocks[i].table_caption || blocks[i].chart_caption || "").toLowerCase();
      if (t.includes(q)) idxs.push(i);
    }
    setSearchMatches(idxs);
    setSearchCursor(0);
    if (idxs.length > 0) {
      const el = blockRefs.current[idxs[0]];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("block-flash");
        setTimeout(() => el.classList.remove("block-flash"), 1500);
        setActiveIdx(idxs[0]);
      }
    }
  }, [searchQuery, blocks]);

  const gotoMatch = (delta: number) => {
    if (searchMatches.length === 0) return;
    const next = (searchCursor + delta + searchMatches.length) % searchMatches.length;
    setSearchCursor(next);
    const idx = searchMatches[next];
    const el = blockRefs.current[idx];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("block-flash");
      setTimeout(() => el.classList.remove("block-flash"), 1500);
      setActiveIdx(idx);
    }
  };

  // Keyboard shortcut: Ctrl+F / Cmd+F to open search, Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
        setSearchQuery("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex flex-col h-full bg-muted/20">
      {/* Status bar */}
      {loading && (
        <div className="px-3 py-2 bg-blue-50 border-b border-blue-200 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-300 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {statusMessage || "MinerU 解析中（30-90 秒）…"}
        </div>
      )}

      {/* In-reader search bar */}
      {searchOpen && (
        <div className="px-3 py-2 bg-background border-b flex items-center gap-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="查找段落…"
            className="h-7 text-xs flex-1"
            autoFocus
          />
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            {searchMatches.length > 0
              ? `${searchCursor + 1}/${searchMatches.length}`
              : searchQuery
              ? "无匹配"
              : "—"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => gotoMatch(-1)}
            disabled={searchMatches.length === 0}
            title="上一个"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => gotoMatch(1)}
            disabled={searchMatches.length === 0}
            title="下一个"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={() => {
              setSearchOpen(false);
              setSearchQuery("");
            }}
            title="关闭 (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Toolbar with search toggle */}
      {!searchOpen && (
        <div className="px-3 py-1 bg-background/60 border-b flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-[11px] text-muted-foreground"
            onClick={() => setSearchOpen(true)}
            title="查找 (Ctrl+F)"
          >
            <Search className="h-3 w-3" />
            查找
          </Button>
        </div>
      )}

      {/* Reading surface */}
      <div ref={containerRef} className="flex-1 overflow-auto scrollbar-thin">
        <div className="max-w-[820px] mx-auto px-6 py-6 space-y-1.5">
          {!markdown && !fallbackText && !loading && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
              <FileText className="h-10 w-10 opacity-30" />
              <p className="text-sm">导入 PDF 后，将自动调用 MinerU 解析为分块结构</p>
              <p className="text-xs text-muted-foreground/70 max-w-[400px] text-center">
                解析完成后此处显示按段落/标题/图表/表格分块的阅读视图，点击段落即可在右侧翻译
              </p>
            </div>
          )}

          {/* Plain-text fallback (progressive) */}
          {!hasBlocks && fallbackText && (
            <div className="text-[14px] leading-[1.8] text-foreground/85 whitespace-pre-wrap">
              {loading && (
                <div className="mb-3 text-[11px] text-blue-600 dark:text-blue-400 italic">
                  ⚡ 快速预览（基于 PDF 文本层），MinerU 结构化解析仍在进行中…
                </div>
              )}
              {fallbackText}
            </div>
          )}

          {/* MinerU structured blocks */}
          {hasBlocks && (
            <>
              {renderBlocks.map((b) => (
                <BlockView
                  key={b._idx}
                  block={b}
                  index={b._idx}
                  isActive={activeIdx === b._idx}
                  isSearchHit={searchMatches.includes(b._idx)}
                  imageUrl={imageUrl(b.img_path)}
                  onParagraphClick={onParagraphClick}
                  onActivate={() => setActiveIdx(b._idx)}
                  blockRef={(el) => {
                    blockRefs.current[b._idx] = el;
                  }}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default BlockReader;

// ---------- Sub-component: renders a single block ----------

function BlockView({
  block,
  index,
  isActive,
  isSearchHit,
  imageUrl,
  onParagraphClick,
  onActivate,
  blockRef,
}: {
  block: MinerUBlock & { _idx: number };
  index: number;
  isActive: boolean;
  isSearchHit: boolean;
  imageUrl: string | null;
  onParagraphClick?: (text: string, idx: number) => void;
  onActivate?: (idx: number) => void;
  blockRef: (el: HTMLDivElement | null) => void;
}) {
  const type = (block.type || "").toLowerCase();
  const rawText = block.text || "";
  const text = cleanMinerUText(rawText);
  const level = block.text_level;

  // Headings
  if (type === "text" && level && level >= 1 && level <= 6) {
    const sizeCls =
      level === 1
        ? "text-2xl"
        : level === 2
        ? "text-xl"
        : level === 3
        ? "text-lg"
        : "text-base";
    return (
      <div ref={blockRef} data-block-idx={index} data-page={block.page_idx} className="scroll-mt-4">
        <div
          className={cn(
            "font-bold mt-5 mb-2 leading-tight",
            sizeCls,
            isActive && "text-primary"
          )}
        >
          {text}
        </div>
        {block.page_idx !== undefined && level <= 2 && (
          <div className="text-[10px] text-muted-foreground/60 -mt-1 mb-1">
            <Hash className="inline h-2.5 w-2.5" /> 第 {block.page_idx + 1} 页
          </div>
        )}
      </div>
    );
  }

  // Tables — table_body is HTML from MinerU; render via ReactMarkdown + rehypeRaw
  if (type === "table") {
    return (
      <div
        ref={blockRef}
        data-block-idx={index}
        data-page={block.page_idx}
        className={cn(
          "my-3 rounded-md border border-border/60 overflow-hidden bg-background scroll-mt-4",
          isActive && "ring-2 ring-primary/50"
        )}
      >
        {block.table_caption && typeof block.table_caption === "string" && (
          <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/40 border-b">
            <TableIcon className="inline h-3 w-3 mr-1" />
            {block.table_caption}
          </div>
        )}
        {block.table_body && (
          <div
            className="block-reader-table text-[12px] overflow-x-auto"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("td,th")) {
                const cellText = (e.target as HTMLElement).textContent || "";
                if (cellText.trim().length > 1) onParagraphClick?.(cellText.trim(), index);
              }
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {block.table_body}
            </ReactMarkdown>
          </div>
        )}
        {block.table_footnote && typeof block.table_footnote === "string" && (
          <div className="px-3 py-1 text-[10px] text-muted-foreground/80 border-t bg-muted/20">
            {block.table_footnote}
          </div>
        )}
      </div>
    );
  }

  // Images / charts
  if (type === "image" || type === "chart") {
    const caption =
      (typeof block.chart_caption === "string" && block.chart_caption) ||
      text ||
      "";
    return (
      <div
        ref={blockRef}
        data-block-idx={index}
        data-page={block.page_idx}
        className={cn(
          "my-3 flex flex-col items-center scroll-mt-4",
          isActive && "ring-2 ring-primary/50 rounded"
        )}
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt={caption || "figure"}
            className="max-w-full rounded shadow-sm border border-border/40"
            loading="lazy"
          />
        )}
        {caption && (
          <div className="text-[11px] text-muted-foreground italic mt-1.5 text-center max-w-[600px]">
            {caption}
          </div>
        )}
      </div>
    );
  }

  // Equations
  if (type === "equation") {
    return (
      <div
        ref={blockRef}
        data-block-idx={index}
        data-page={block.page_idx}
        className="my-2 px-3 py-2 bg-muted/30 rounded text-center font-mono text-[14px] overflow-x-auto scroll-mt-4"
      >
        {text.replace(/^\$\$/, "").replace(/\$\$$/, "").trim()}
      </div>
    );
  }

  // Regular text paragraphs (and ref_text etc.)
  if (type === "text" || type === "ref_text" || type === "page_footnote") {
    if (!text || !text.trim()) return null;
    return (
      <div
        ref={blockRef}
        data-block-idx={index}
        data-page={block.page_idx}
        onClick={() => {
          if (text.trim().length > 1) {
            onActivate?.(index);
            onParagraphClick?.(text.trim(), index);
          }
        }}
        className={cn(
          "group relative px-2 py-1 -mx-2 rounded cursor-pointer transition-colors scroll-mt-4",
          "hover:bg-blue-50/60 dark:hover:bg-blue-950/20",
          isActive && "bg-blue-50 dark:bg-blue-950/30",
          isSearchHit && !isActive && "bg-amber-50 dark:bg-amber-950/20"
        )}
        title="点击在右侧翻译此段"
      >
        {isActive && (
          <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r" />
        )}
        {isSearchHit && !isActive && (
          <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-500 rounded-r" />
        )}
        {/* Render inline markdown (bold/italic/sup/sub) so MinerU's **emphasis**
            and math symbols display correctly. */}
        <div className="text-[14px] leading-[1.85] text-foreground/90 prose-inline-sm">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            disallowedElements={["p", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "img", "ul", "ol", "li", "blockquote", "code", "pre"]}
            unwrapDisallowed
          >
            {text}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  // Unknown block types — render text if present
  if (text && text.trim()) {
    return (
      <div
        ref={blockRef}
        data-block-idx={index}
        data-page={block.page_idx}
        className="text-[14px] leading-[1.85] text-foreground/80 scroll-mt-4"
      >
        {text}
      </div>
    );
  }

  return null;
}

// ---------- helpers ----------

/**
 * Find the index of the block whose text best matches the given quote or
 * keywords. Uses a scoring approach:
 *
 *   - exact quote substring match  → score 1000
 *   - quote-head (first 25 chars) substring match → score 800
 *   - per-keyword substring match  → +100/keyword (longer keywords weighted more)
 *   - prefer blocks where MORE keywords match
 *
 * Returns the highest-scoring block index, or -1 if no block scored > 0.
 */
function findBlockIndex(
  blocks: MinerUBlock[],
  quote: string,
  keywords: string[]
): number {
  if (!blocks || blocks.length === 0) return -1;

  // Normalize a string for matching: lowercase, collapse whitespace
  const norm = (s: string) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

  const q = norm(quote || "");
  const qHead = q.slice(0, 25);
  const kws = (keywords || [])
    .filter((k) => k && k.length >= 2)
    .map(norm)
    .sort((a, b) => b.length - a.length); // longest first

  let bestIdx = -1;
  let bestScore = 0;

  for (let i = 0; i < blocks.length; i++) {
    const t = norm(blocks[i].text || "");
    if (!t) continue;

    let score = 0;

    // 1) Exact quote match
    if (q.length > 4 && t.includes(q)) {
      score += 1000;
    }
    // 2) Quote head match (LLM often paraphrases the tail)
    else if (qHead.length > 6 && t.includes(qHead)) {
      score += 800;
    }

    // 3) Keyword matches — longer keywords score more
    for (const kw of kws) {
      if (t.includes(kw)) {
        // Weight by length: 4-char keyword = 100, 10-char = 250
        score += Math.min(300, 25 + kw.length * 25);
      }
    }

    // 4) Token overlap bonus: split quote into words, count how many appear
    if (q.length > 4) {
      const tokens = q.split(/[,\s.;:()]+/).filter((w) => w.length > 3);
      let hits = 0;
      for (const tok of tokens) {
        if (t.includes(tok)) hits++;
      }
      if (tokens.length > 0) {
        score += Math.round((hits / tokens.length) * 200);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  // Require at least some signal — avoid jumping to block 0 on no match
  return bestScore > 0 ? bestIdx : -1;
}
