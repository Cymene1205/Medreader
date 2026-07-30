"use client";

import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import {
  Loader2,
  FileText,
  Image as ImageIcon,
  Table as TableIcon,
  Hash,
  Type,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type MinerUBlock = {
  type: string; // text | image | table | equation | chart | header | footer | page_number | page_footnote | ref_text
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
  /** Find a block matching the given quote/keywords and scroll to it. */
  scrollToText: (quote: string, keywords: string[]) => void;
};

type Props = {
  /** Plain-text fallback (from pdfjs). Used while MinerU is still parsing. */
  fallbackText: string | null;
  /** MinerU markdown (knowledge base). */
  markdown: string | null;
  /** MinerU block-level structure (page_idx/bbox/text_level). */
  blocks: MinerUBlock[] | null;
  /** Paper ID — used for image URL routing. */
  imagesDir: string | null;
  /** Loading state. */
  loading: boolean;
  /** Parse progress message. */
  statusMessage?: string;
  /** Called when user clicks a paragraph (for translation). */
  onParagraphClick?: (text: string, blockIdx: number) => void;
  /** Block index that should be highlighted (from outline click). */
  highlightToken?: { quote: string; keywords: string[]; nonce: number } | null;
};

/**
 * Block-level reader — renders MinerU's content_list.json as a stream of
 * discrete blocks (headings, paragraphs, tables, figures, equations).
 *
 * - Single-click a paragraph → triggers onParagraphClick for translation.
 * - Outline clicks → highlightToken → scroll to matching block + flash.
 */
const BlockReader = forwardRef<BlockReaderHandle, Props>(function BlockReader(
  { fallbackText, markdown, blocks, imagesDir, loading, statusMessage, onParagraphClick, highlightToken },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blockRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  // Whether we have MinerU blocks (vs plain-text fallback only).
  const hasBlocks = blocks && blocks.length > 0;

  // Filter blocks to only render the readable content (skip page_number, footer noise).
  const renderBlocks = useMemo(() => {
    if (!blocks) return [];
    return blocks
      .map((b, i) => ({ ...b, _idx: i }))
      .filter((b) => {
        const t = (b.type || "").toLowerCase();
        // Skip pure page metadata — it's noise in the reading flow.
        return t !== "page_number" && t !== "header" && t !== "footer";
      });
  }, [blocks]);

  // Image URL helper: maps MinerU's images/xxx.jpg to /api/paper-images?...
  const imageUrl = (imgPath?: string): string | null => {
    if (!imgPath || !imagesDir) return null;
    const name = imgPath.split("/").pop() || "";
    return `/api/paper-images?dir=${encodeURIComponent(imagesDir)}&name=${encodeURIComponent(name)}`;
  };

  // Expose imperative handle for outline clicks.
  useImperativeHandle(ref, () => ({
    scrollToText: (quote: string, keywords: string[]) => {
      if (!blocks || blocks.length === 0) return;
      const idx = findBlockIndex(blocks, quote, keywords);
      if (idx < 0) return;
      const el = blockRefs.current[idx];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("block-flash");
        setTimeout(() => el.classList.remove("block-flash"), 2200);
      }
    },
  }));

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

  return (
    <div className="flex flex-col h-full bg-muted/20">
      {/* Status bar */}
      {loading && (
        <div className="px-3 py-2 bg-blue-50 border-b border-blue-200 text-xs text-blue-700 dark:bg-blue-950/30 dark:text-blue-300 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {statusMessage || "MinerU 解析中（30-90 秒）…"}
        </div>
      )}

      {/* Reading surface */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto scrollbar-thin"
      >
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

          {/* Plain-text fallback (progressive: shows immediately while MinerU is still working) */}
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
                  imageUrl={imageUrl(b.img_path)}
                  onParagraphClick={onParagraphClick}
                  onActivate={() => setActiveIdx(b._idx)}
                  blockRef={(el) => { blockRefs.current[b._idx] = el; }}
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
  imageUrl,
  onParagraphClick,
  onActivate,
  blockRef,
}: {
  block: MinerUBlock & { _idx: number };
  index: number;
  isActive: boolean;
  imageUrl: string | null;
  onParagraphClick?: (text: string, idx: number) => void;
  onActivate?: (idx: number) => void;
  blockRef: (el: HTMLDivElement | null) => void;
}) {
  const type = (block.type || "").toLowerCase();
  const text = block.text || "";
  const level = block.text_level;

  // Headings
  if (type === "text" && level && level >= 1 && level <= 6) {
    const sizeCls = level === 1 ? "text-2xl" : level === 2 ? "text-xl" : level === 3 ? "text-lg" : "text-base";
    return (
      <div ref={blockRef} data-block-idx={index} data-page={block.page_idx}>
        <div
          className={cn(
            "font-bold mt-4 mb-2 leading-tight",
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

  // Tables
  if (type === "table") {
    return (
      <div
        ref={blockRef}
        data-block-idx={index}
        data-page={block.page_idx}
        className={cn(
          "my-3 rounded-md border border-border/60 overflow-hidden bg-background",
          isActive && "ring-2 ring-primary/50"
        )}
      >
        {block.table_caption && (
          <div className="px-3 py-1.5 text-[11px] text-muted-foreground bg-muted/40 border-b">
            <TableIcon className="inline h-3 w-3 mr-1" />
            {block.table_caption}
          </div>
        )}
        {block.table_body && (
          <div
            className="block-reader-table text-[12px] overflow-x-auto"
            onClick={(e) => {
              // Only fire if user clicked on the table cell, not caption
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
        {block.table_footnote && (
          <div className="px-3 py-1 text-[10px] text-muted-foreground/80 border-t bg-muted/20">
            {block.table_footnote}
          </div>
        )}
      </div>
    );
  }

  // Images / charts
  if (type === "image" || type === "chart") {
    const caption = block.chart_caption || block.text || "";
    return (
      <div
        ref={blockRef}
        data-block-idx={index}
        data-page={block.page_idx}
        className={cn(
          "my-3 flex flex-col items-center",
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
        className="my-2 px-3 py-2 bg-muted/30 rounded text-center font-mono text-[14px] overflow-x-auto"
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
          "group relative px-2 py-1 -mx-2 rounded cursor-pointer transition-colors",
          "hover:bg-blue-50/60 dark:hover:bg-blue-950/20",
          isActive && "bg-blue-50 dark:bg-blue-950/30"
        )}
        title="点击在右侧翻译此段"
      >
        {isActive && (
          <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary rounded-r" />
        )}
        <p className="text-[14px] leading-[1.85] text-foreground/90">
          {text}
        </p>
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
        className="text-[14px] leading-[1.85] text-foreground/80"
      >
        {text}
      </div>
    );
  }

  return null;
}

// ---------- helpers ----------

/**
 * Find the index of the block whose text matches the given quote or any
 * keyword. Used by outline clicks to scroll-to-and-flash.
 */
function findBlockIndex(
  blocks: MinerUBlock[],
  quote: string,
  keywords: string[]
): number {
  // 1. Try exact quote match
  if (quote && quote.length > 4) {
    const q = quote.toLowerCase();
    for (let i = 0; i < blocks.length; i++) {
      const t = (blocks[i].text || "").toLowerCase();
      if (t.includes(q)) return i;
    }
    // Try first 20 chars of quote (LLM often paraphrases slightly)
    const qHead = q.slice(0, 20);
    if (qHead.length > 6) {
      for (let i = 0; i < blocks.length; i++) {
        const t = (blocks[i].text || "").toLowerCase();
        if (t.includes(qHead)) return i;
      }
    }
  }
  // 2. Try keyword match
  for (const kw of keywords) {
    if (!kw || kw.length < 2) continue;
    const k = kw.toLowerCase();
    for (let i = 0; i < blocks.length; i++) {
      const t = (blocks[i].text || "").toLowerCase();
      if (t.includes(k)) return i;
    }
  }
  return -1;
}
