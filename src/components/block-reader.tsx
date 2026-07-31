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
  ListTree,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  // ⚠️ MinerU emits chart_caption / image_caption as ARRAYS of strings.
  // See src/lib/mineru.ts for the rationale.
  chart_caption?: string[];
  chart_footnote?: string[];
  image_caption?: string[];
  image_footnote?: string[];
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
 * Strip MinerU's over-escaped markdown punctuation + common parsing artifacts.
 *
 * MinerU outputs things like "Ehsan Vafadarnejad,\* Giuseppe Rizzo,\* ..."
 * The backslash before * is wrong — these are author name separators, not
 * emphasis markers. Strip them so the text renders cleanly.
 *
 * Also fixes several MinerU bugs that produce visible "string residue" in
 * the reader view:
 *
 *   1. Word-internal <sup>/<sub> tags wrapping real word content.
 *      MinerU sometimes mis-detects superscript boundaries and produces
 *      garbage like:
 *        "A<sup>fter</sup> <sup>acute</sup> <sup>myocardial</sup> ...
 *         <sup>isch-</sup>emic injury ... of<sub>1–4</sub> emic"
 *      Real superscripts are citation numbers / panel labels (digits and
 *      short symbols). If a <sup>/<sub> contains 3+ word-chars in a row,
 *      it's a parsing error → strip the tags, keep the inner text.
 *
 *   2. Inline LaTeX math like "$\mathsf{Ly6C}$" or "$\text{...}$" showing
 *      as raw text. ReactMarkdown doesn't render LaTeX by default; the raw
 *      `\mathsf{...}` and surrounding $ leak through. We extract the
 *      inner text and strip the LaTeX commands so users see "Ly6C" instead.
 *
 *   3. Stray "•" characters that MinerU sometimes inserts at line starts.
 *      (Only strip if at the very start of a line and not part of a
 *      legitimate bullet list.)
 */
function cleanMinerUText(s: string): string {
  if (!s) return "";
  let out = s;

  // ── Fix 1: strip <sup>/<sub> tags whose content is real word text ──────
  // A "real" superscript is mostly digits / symbols (e.g. "1–4", "hi", "+",
  // "−"). If the inner text contains 3+ consecutive Latin/CJK letters, it's
  // almost certainly a parsing error where MinerU wrapped a real word.
  // We strip the tags but KEEP the inner text so the word is readable.
  out = out.replace(
    /<(sup|sub)>([^<]*)<\/\1>/gi,
    (fullMatch, _tag: string, inner: string) => {
      const t = inner.trim();
      if (!t) return "";
      // 3+ consecutive letters (Latin or CJK) inside a sup/sub = parsing error
      const hasLongWord = /[A-Za-z\u4e00-\u9fa5]{3,}/.test(t);
      // If it's mostly letters (ratio > 0.5), also treat as word content
      const letterCount = (t.match(/[A-Za-z]/g) || []).length;
      const isWordLike = t.length > 0 && letterCount / t.length > 0.5;
      if (hasLongWord || isWordLike) {
        // Strip the tags, keep the text — but preserve a leading space if
        // the original had one (so words don't merge).
        return inner;
      }
      // Otherwise it's a legit superscript (citation number, +/-, etc.)
      // — keep the tag intact so ReactMarkdown renders it correctly.
      return fullMatch;
    }
  );

  // ── Fix 2: convert inline LaTeX math `$\cmd{...}$` to plain text ───────
  // Examples:
  //   "$\mathsf{Ly6C}$"            → "Ly6C"
  //   "$\text{mean} \pm SD$"       → "mean ± SD"
  //   "$\mathrm{CD45}^{+}$"        → "CD45+"
  //   "$p < 0.05$"                 → "p < 0.05"
  // Strategy: for each `$...$` pair, strip LaTeX commands (\mathsf, \text,
  // \mathrm, \frac, etc.) and braces, but keep alphanumerics + operators.
  out = out.replace(/\$([^$]+)\$/g, (_m, math: string) => {
    // Remove LaTeX commands like \mathsf, \text, \mathrm, \frac, \left, \right
    let cleaned = math
      .replace(/\\[a-zA-Z]+/g, " ")
      // Remove braces
      .replace(/[{}]/g, "")
      // Replace multiple spaces with single
      .replace(/\s+/g, " ")
      .trim();
    // If the cleaned version is just a few symbols/letters, return as-is
    if (cleaned.length === 0) return "";
    return cleaned;
  });

  // ── Original fixes (MinerU escape cleanup) ─────────────────────────────
  // \*  → * (MinerU over-escapes asterisks used as author separators)
  out = out.replace(/\\\*/g, "*");
  // \_  → _
  out = out.replace(/\\_/g, "_");
  // \# at start of line — keep as heading marker if intended; but if escaped,
  // MinerU sometimes escapes inappropriately. Only unescape mid-line.
  out = out.replace(/(?!^)\\#/g, "#");

  // ── Fix 3: stray leading bullet characters MinerU sometimes inserts ────
  // Only strip "• " at the very start of a line (legit bullets are inside
  // <ul><li> which ReactMarkdown handles separately).
  out = out.replace(/^•\s+/gm, "");

  return out;
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

  // Heading navigator side-drawer state
  const [headingsOpen, setHeadingsOpen] = useState(false);
  const [activeHeadingIdx, setActiveHeadingIdx] = useState<number | null>(null);

  // Image preview dialog — clicking any figure opens a large preview
  // with the full caption rendered below.
  const [imgPreview, setImgPreview] = useState<{
    imageUrl: string;
    caption: string;
    label?: string;
  } | null>(null);

  const hasBlocks = blocks && blocks.length > 0;

  // Extract heading blocks (type === "text" with text_level >= 1) — used by
  // the side drawer. No LLM involved, just MinerU's structural metadata.
  // Each entry carries the original block index so clicking it can scroll
  // the reader to that exact block via blockRefs.
  //
  // ⚠️ Re-levelling: MinerU's text_level is unreliable for scientific PDFs
  //    (e.g. it often marks every Results subheading as level 1, making the
  //    navigator look like a flat list). We re-derive a 2-level hierarchy:
  //      - H1 = top-level structural sections (Introduction / Results /
  //        Discussion / Methods / References / Acknowledgements / ...)
  //      - H2 = sub-headings under an H1
  //    level >= 3 is collapsed into H2 (kept so the user can still click
  //    deep subsections, but rendered identically to H2 to avoid the
  //    "everything is one level" flat look).
  const headings = useMemo(() => {
    if (!blocks) return [];
    const raw = blocks
      .map((b, i) => ({ block: b, idx: i }))
      .filter(({ block }) => {
        const t = (block.type || "").toLowerCase();
        return t === "text" && typeof block.text_level === "number" && block.text_level >= 1;
      })
      .map(({ block, idx }) => ({
        idx,
        origLevel: block.text_level || 1,
        level: 1, // placeholder — re-derived below
        text: (block.text || "").trim(),
      }))
      .filter((h) => h.text.length > 0);

    if (raw.length === 0) return [];

    // Re-derive H1/H2 based on the MINIMUM level seen in the document.
    // Whatever the lowest level MinerU emitted is, treat it as H1.
    // Everything strictly greater becomes H2.
    const minLevel = raw.reduce((m, h) => Math.min(m, h.origLevel), raw[0].origLevel);
    for (const h of raw) {
      h.level = h.origLevel === minLevel ? 1 : 2;
    }

    // Heuristic: if the document has TOO FEW H1s (≤ 1), demote some H2s
    // to H1 by treating the second-lowest level as H1 too. This handles
    // papers where MinerU put the article title at level 1 and everything
    // else at level 2 — we want at least 3-4 H1 sections to navigate.
    const h1Count = raw.filter((h) => h.level === 1).length;
    if (h1Count <= 1 && raw.some((h) => h.level === 2)) {
      const h2Levels = raw
        .filter((h) => h.level === 2)
        .map((h) => h.origLevel)
        .sort((a, b) => a - b);
      const secondMin = h2Levels[0];
      for (const h of raw) {
        if (h.origLevel <= secondMin) h.level = 1;
        else h.level = 2;
      }
    }

    return raw;
  }, [blocks]);

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

  // Jump to a heading by block index — used by the side drawer.
  const jumpToHeading = useCallback((idx: number) => {
    const el = blockRefs.current[idx];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("block-flash");
      setTimeout(() => el.classList.remove("block-flash"), 2200);
      setActiveIdx(idx);
      setActiveHeadingIdx(idx);
    }
  }, []);

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
      const t = (
        blocks[i].text ||
        blocks[i].table_caption ||
        (Array.isArray(blocks[i].chart_caption) ? blocks[i].chart_caption.join(" ") : "") ||
        (Array.isArray(blocks[i].image_caption) ? blocks[i].image_caption.join(" ") : "") ||
        ""
      ).toLowerCase();
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

      {/* Toolbar with search toggle + headings drawer toggle */}
      {!searchOpen && (
        <div className="px-3 py-1 bg-background/60 border-b flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-[11px] text-muted-foreground"
            onClick={() => setHeadingsOpen(true)}
            disabled={!hasBlocks || headings.length === 0}
            title="段落导航"
          >
            <ListTree className="h-3 w-3" />
            段落导航
            {headings.length > 0 && (
              <span className="ml-0.5 text-[9.5px] text-muted-foreground/70">
                ({headings.length})
              </span>
            )}
          </Button>
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

      {/* Heading navigator side drawer */}
      <Sheet open={headingsOpen} onOpenChange={setHeadingsOpen}>
        <SheetContent side="right" className="w-[360px] sm:w-[400px] p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <ListTree className="h-4 w-4 text-sky-600" />
              段落导航
              <span className="ml-1 text-[11px] text-muted-foreground font-normal">
                · {headings.length} 个标题
              </span>
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-2">
            {headings.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-xs">
                暂无标题结构
                <div className="mt-1 text-[10px] text-muted-foreground/70">
                  MinerU 解析完成后此处显示论文大小标题
                </div>
              </div>
            ) : (
              <ul className="space-y-0">
                {headings.map((h, i) => {
                  const isActive = activeHeadingIdx === h.idx;
                  const isH1 = h.level === 1;
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => {
                          jumpToHeading(h.idx);
                          // Don't auto-close — let user click multiple headings
                        }}
                        title={h.text}
                        className={cn(
                          "w-full text-left rounded transition-colors flex items-stretch gap-2",
                          // H1: bigger padding, separator above
                          isH1
                            ? "mt-2 first:mt-0 px-1.5 py-2"
                            : "px-1.5 py-1.5",
                          isActive
                            ? "bg-sky-50 dark:bg-sky-950/40"
                            : "hover:bg-muted/60"
                        )}
                      >
                        {/* H1: left vertical bar. H2: small dot. */}
                        <span
                          className={cn(
                            "flex-shrink-0 rounded-full self-stretch",
                            isH1
                              ? isActive
                                ? "w-[3px] bg-sky-600 dark:bg-sky-400"
                                : "w-[3px] bg-sky-400/70 dark:bg-sky-700/70"
                              : cn(
                                  "w-1 h-1 mt-[7px] rounded-full",
                                  isActive ? "bg-sky-500" : "bg-muted-foreground/40"
                                )
                          )}
                        />
                        <span
                          className={cn(
                            "flex-1 min-w-0",
                            isH1
                              ? cn(
                                  "text-[13px] font-semibold leading-snug",
                                  isActive
                                    ? "text-sky-700 dark:text-sky-300"
                                    : "text-foreground"
                                )
                              : cn(
                                  "text-[12px] font-normal leading-snug",
                                  isActive
                                    ? "text-sky-700 dark:text-sky-300"
                                    : "text-foreground/75"
                                )
                          )}
                        >
                          {h.text}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

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
                  onImageClick={(url, cap) => {
                    const labelMatch = cap.match(/^\s*(?:Fig(?:ure|\.)?)\s*\d+/i);
                    setImgPreview({
                      imageUrl: url,
                      caption: cap,
                      label: labelMatch ? labelMatch[0] : undefined,
                    });
                  }}
                  blockRef={(el) => {
                    blockRefs.current[b._idx] = el;
                  }}
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Image preview dialog — large image + full caption */}
      <Dialog
        open={!!imgPreview}
        onOpenChange={(o) => !o && setImgPreview(null)}
      >
        <DialogContent className="w-[90%] max-w-[1100px] max-h-[90vh] flex flex-col p-0 gap-0">
          {imgPreview && (
            <>
              <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
                <DialogTitle className="text-base">
                  {imgPreview.label || "图片预览"}
                </DialogTitle>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                <div className="bg-muted/30 p-4 flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imgPreview.imageUrl}
                    alt={imgPreview.label || "figure"}
                    className="max-w-full max-h-[70vh] object-contain rounded shadow-sm"
                  />
                </div>
                {imgPreview.caption && (
                  <div className="px-4 py-3 text-[12px] leading-relaxed text-foreground/85 prose-inline-sm">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={{
                        p: ({ children }) => <span>{children}</span>,
                        br: () => <span> </span>,
                      }}
                    >
                      {imgPreview.caption}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
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
  onImageClick,
}: {
  block: MinerUBlock & { _idx: number };
  index: number;
  isActive: boolean;
  isSearchHit: boolean;
  imageUrl: string | null;
  onParagraphClick?: (text: string, idx: number) => void;
  onActivate?: (idx: number) => void;
  blockRef: (el: HTMLDivElement | null) => void;
  onImageClick?: (imageUrl: string, caption: string) => void;
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
          <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/40 border-b prose-inline-sm">
            <TableIcon className="inline h-3 w-3 mr-1" />
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{ p: ({ children }) => <span>{children}</span> }}>
              {block.table_caption}
            </ReactMarkdown>
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
          <div className="px-3 py-1 text-[10px] text-muted-foreground/80 border-t bg-muted/20 prose-inline-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{ p: ({ children }) => <span>{children}</span> }}>
              {block.table_footnote}
            </ReactMarkdown>
          </div>
        )}
      </div>
    );
  }

  // Images / charts
  if (type === "image" || type === "chart") {
    // chart_caption / image_caption are arrays — pick the longest item that
    // starts with "Figure N" (the real caption), or fall back to the longest
    // item, then to the block's text field.
    const captionArrs = [
      ...(Array.isArray(block.chart_caption) ? block.chart_caption : []),
      ...(Array.isArray(block.image_caption) ? block.image_caption : []),
    ].filter((s): s is string => typeof s === "string" && s.trim().length > 0);
    const figCaption = captionArrs
      .filter((s) => /^\s*(?:Fig(?:ure|\.)?)\s*\d+/i.test(s))
      .sort((a, b) => b.length - a.length)[0];
    const caption = figCaption || captionArrs.sort((a, b) => b.length - a.length)[0] || text || "";
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
            className="max-w-full rounded shadow-sm border border-border/40 cursor-zoom-in hover:shadow-md hover:border-primary/40 transition-all"
            loading="lazy"
            onClick={() => {
              if (imageUrl && onImageClick) {
                onImageClick(imageUrl, caption);
              }
            }}
          />
        )}
        {caption && (
          <div className="text-[11px] text-muted-foreground italic mt-1.5 text-center w-full prose-inline-sm">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                p: ({ children }) => <span>{children}</span>,
                br: () => <span> </span>,
              }}
            >
              {caption}
            </ReactMarkdown>
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
            and math symbols display correctly.
            ⚠️ rehypeRaw is REQUIRED here — MinerU emits raw HTML like
            `SiglecF<sup>hi</sup>`, `CD8<sup>+</sup>`, `IL-1β` etc. Without
            rehypeRaw these tags show as literal text. */}
        <div className="text-[14px] leading-[1.85] text-foreground/90 prose-inline-sm">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            disallowedElements={["p", "h1", "h2", "h3", "h4", "h5", "h6", "br", "hr", "img", "ul", "ol", "li", "blockquote", "pre"]}
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

  // Normalize a string for matching: lowercase, collapse whitespace.
  // Also strip <sup>/<sub>/<i> HTML tags so e.g. "SiglecF<sup>hi</sup>"
  // matches a search for "siglecfhi".
  const norm = (s: string) =>
    (s || "")
      .toLowerCase()
      .replace(/<\/?(?:sup|sub|i|b|em|strong|span)[^>]*>/gi, "")
      .replace(/\s+/g, " ")
      .trim();

  const q = norm(quote || "");
  const qHead = q.slice(0, 25);
  const kws = (keywords || [])
    .filter((k) => k && k.length >= 2)
    .map(norm)
    .sort((a, b) => b.length - a.length); // longest first

  // Extract any "Figure N" / "Fig N" / "Fig NA" references from the quote
  // itself — if the LLM included the figure callout in its quote, we want
  // blocks that mention the same figure to score higher.
  const figRefsInQuote = new Set<string>();
  const figRefRe = /\b(?:fig(?:ure|\.)?)\s*(\d+)\s*([a-z])?/gi;
  let m: RegExpExecArray | null;
  while ((m = figRefRe.exec(q)) !== null) {
    const num = m[1];
    const panel = m[2] || "";
    figRefsInQuote.add(`figure ${num}`);
    if (panel) {
      figRefsInQuote.add(`figure ${num}${panel}`);
      figRefsInQuote.add(`fig. ${num}`);
      figRefsInQuote.add(`fig ${num}${panel}`);
    }
  }

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

    // 5) Figure-reference bonus — if the quote mentions "Figure 1A", boost
    // blocks that also mention "Figure 1" / "Fig. 1A". This is the panel
    // jump fallback when the LLM's quote is too short or paraphrased.
    if (figRefsInQuote.size > 0) {
      for (const ref of figRefsInQuote) {
        if (t.includes(ref)) {
          score += 150;
          break;
        }
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
