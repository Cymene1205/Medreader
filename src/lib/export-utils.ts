/**
 * Client-side export utilities for the MedReader analysis output.
 *
 * Two export formats are supported:
 *
 * 1. **Markdown (智能分析版本)** — a structured Markdown document containing
 *    the 4-layer analysis (问题与背景 · 论证主线 · 创新性 · 局限与机会),
 *    including figure captions and pair-wise 限制/机会 entries. Suitable
 *    for opening in any Markdown editor or pasting into a notes app.
 *
 * 2. **HTML 思维导图** — a standalone, self-contained HTML file that renders
 *    the same 4-layer analysis as a poster-style mindmap (similar to the
 *    in-app mindmap view). Opens in any browser; no server needed.
 *
 * Both formats are generated entirely on the client (no API call) so the
 * download is instant and works offline once the analysis is loaded.
 */

import type { Outline } from "@/components/outline-panel";
import type { Figure } from "@/components/figure-chain";

// ── Helpers ────────────────────────────────────────────────────────────────

/** Strip markdown inline formatting (**bold**, *italic*, `code`) for plain-
 *  text contexts where formatting isn't supported (e.g. inside HTML <title>). */
function stripMd(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\([^)]+\)/g, "$1")
    .replace(/<sup>(.+?)<\/sup>/g, "^$1")
    .replace(/<sub>(.+?)<\/sub>/g, "_$1")
    .replace(/<[^>]+>/g, "");
}

/** Escape a string for safe inclusion in HTML text content. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Convert simple markdown (**bold**, *italic*, <sup>) to HTML for the
 *  mindmap card body. We don't run a full markdown parser — the LLM output
 *  uses a small subset of markdown that we can handle inline. */
function mdToHtml(s: string | null | undefined): string {
  if (!s) return "";
  let out = escapeHtml(s);
  // <sup>/<sub> tags were escaped — restore them
  out = out
    .replace(/&lt;sup&gt;(.*?)&lt;\/sup&gt;/g, "<sup>$1</sup>")
    .replace(/&lt;sub&gt;(.*?)&lt;\/sub&gt;/g, "<sub>$1</sub>");
  // **bold** → <strong>
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // *italic* → <em>
  out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // `code` → <code>
  out = out.replace(/`(.+?)`/g, "<code>$1</code>");
  // Paragraph breaks
  out = out.replace(/\n\n+/g, "</p><p>");
  // Single newlines → <br>
  out = out.replace(/\n/g, "<br>");
  return `<p>${out}</p>`;
}

/** Trigger a browser download of a string blob. */
function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sanitize a paper title into a safe filename component. */
function safeFileName(title: string): string {
  return (title || "paper")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80) || "paper";
}

// ── Markdown export ────────────────────────────────────────────────────────

export function exportAnalysisMarkdown(
  outline: Outline,
  figures: Figure[] = []
): void {
  const lines: string[] = [];
  const title = outline.title || "未命名文献";
  lines.push(`# ${title}`);
  lines.push("");
  lines.push("> 由 MedReader Agent 自动生成 · 4 层结构化分析");
  lines.push("");
  lines.push("---");
  lines.push("");

  // 1. 问题与背景
  if (outline.questionBackground) {
    lines.push("## 1. 问题与背景");
    lines.push("");
    if (outline.questionBackground.summary) {
      lines.push(`> ${stripMd(outline.questionBackground.summary)}`);
      lines.push("");
    }
    // Prefer structured subsections (new format) over flat detail markdown
    if (outline.questionBackground.subsections && outline.questionBackground.subsections.length > 0) {
      outline.questionBackground.subsections.forEach((sub, i) => {
        lines.push(`### ${i + 1}. ${stripMd(sub.heading)}`);
        lines.push("");
        if (sub.body) {
          lines.push(sub.body);
          lines.push("");
        }
        if (sub.bullets && sub.bullets.length > 0) {
          sub.bullets.forEach((b) => {
            lines.push(`- ${stripMd(b)}`);
          });
          lines.push("");
        }
      });
    } else if (outline.questionBackground.detail) {
      lines.push(outline.questionBackground.detail);
      lines.push("");
    }
  }

  // 2. 论证主线
  if (outline.argumentSpine) {
    lines.push("## 2. 论证主线");
    lines.push("");
    if (outline.argumentSpine.summary) {
      lines.push(`> ${stripMd(outline.argumentSpine.summary)}`);
      lines.push("");
    }
    if (outline.argumentSpine.linchpinFigure) {
      lines.push(`**命门图：** ${stripMd(outline.argumentSpine.linchpinFigure)}`);
      lines.push("");
    }
    // Figure chain
    if (figures.length > 0) {
      const sorted = [...figures].sort((a, b) => {
        const an = parseInt(a.label.replace(/\D/g, ""), 10) || 0;
        const bn = parseInt(b.label.replace(/\D/g, ""), 10) || 0;
        return an - bn;
      });
      lines.push("### 图表链");
      lines.push("");
      for (const f of sorted) {
        lines.push(`#### ${f.label}${f.isLinchpin ? " (命门)" : ""}`);
        if (f.role) lines.push(`- 角色：${f.role}`);
        if (f.method) lines.push(`- 方法：${f.method}`);
        if (f.question) lines.push(`- 问题：${stripMd(f.question)}`);
        if (f.caption) lines.push(`- 图注：${f.caption}`);
        lines.push(`- 位置：第 ${f.pageIndex} 页`);
        if (f.panelCount > 0) {
          lines.push(`- 面板数：${f.panelCount}`);
        }
        lines.push("");
      }
    }
  }

  // 3. 创新性
  if (outline.novelty) {
    lines.push("## 3. 创新性");
    lines.push("");
    if (outline.novelty.summary) {
      lines.push(`> ${stripMd(outline.novelty.summary)}`);
      lines.push("");
    }
    if (outline.novelty.subsections && outline.novelty.subsections.length > 0) {
      outline.novelty.subsections.forEach((sub, i) => {
        lines.push(`### ${i + 1}. ${stripMd(sub.heading)}`);
        lines.push("");
        if (sub.body) {
          lines.push(sub.body);
          lines.push("");
        }
        if (sub.bullets && sub.bullets.length > 0) {
          sub.bullets.forEach((b) => {
            lines.push(`- ${stripMd(b)}`);
          });
          lines.push("");
        }
      });
    } else if (outline.novelty.detail) {
      lines.push(outline.novelty.detail);
      lines.push("");
    }
  }

  // 4. 局限与机会
  if (outline.limitsOpportunities) {
    lines.push("## 4. 局限与机会");
    lines.push("");
    if (outline.limitsOpportunities.summary) {
      lines.push(`> ${stripMd(outline.limitsOpportunities.summary)}`);
      lines.push("");
    }
    if (outline.limitsOpportunities.subsections && outline.limitsOpportunities.subsections.length > 0) {
      outline.limitsOpportunities.subsections.forEach((sub, i) => {
        lines.push(`### ${i + 1}. ${stripMd(sub.heading)}`);
        lines.push("");
        if (sub.body) {
          lines.push(sub.body);
          lines.push("");
        }
        if (sub.bullets && sub.bullets.length > 0) {
          sub.bullets.forEach((b) => {
            lines.push(`- ${stripMd(b)}`);
          });
          lines.push("");
        }
      });
    } else if (outline.limitsOpportunities.detail) {
      lines.push(outline.limitsOpportunities.detail);
      lines.push("");
    }
    if (
      outline.limitsOpportunities.pairs &&
      outline.limitsOpportunities.pairs.length > 0
    ) {
      lines.push("### 限制 → 机会 对照表");
      lines.push("");
      lines.push("| # | 局限 | 机会 |");
      lines.push("|---|------|------|");
      outline.limitsOpportunities.pairs.forEach((p, i) => {
        lines.push(
          `| ${i + 1} | ${stripMd(p.limitation).replace(/\|/g, "\\|")} | ${stripMd(p.opportunity).replace(/\|/g, "\\|")} |`
        );
      });
      lines.push("");
    }
  }

  // Failed parts (if any)
  if (outline.failedParts && outline.failedParts.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## 附录：生成失败的部分");
    lines.push("");
    lines.push("以下部分在 LLM 分析过程中失败，可重试生成：");
    lines.push("");
    for (const p of outline.failedParts) {
      lines.push(`- \`${p}\``);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(`*生成时间：${new Date().toLocaleString("zh-CN")}*`);

  const md = lines.join("\n");
  downloadBlob(md, `${safeFileName(title)}_智能分析.md`, "text/markdown;charset=utf-8");
}

// ── HTML mindmap export ────────────────────────────────────────────────────

const SECTION_PALETTE = [
  { color: "#5B7C99", soft: "#EAF0F5", border: "#C7D5E0" }, // 问题与背景
  { color: "#B8845C", soft: "#F7EFE7", border: "#E0CBB4" }, // 论证主线
  { color: "#7B6BA8", soft: "#EFEAF5", border: "#D5CCE6" }, // 创新性
  { color: "#5F8B7B", soft: "#E9F2EE", border: "#C4D9D0" }, // 局限与机会
];

export function exportMindmapHtml(
  outline: Outline,
  figures: Figure[] = []
): void {
  const title = outline.title || "未命名文献";
  const sections: Array<{
    index: number;
    title: string;
    color: string;
    soft: string;
    border: string;
    summary: string;
    bodyHtml: string;
  }> = [];

  // Helper: render subsections array as a chain of cards (mirror the
  // SubsectionChain UI in outline-panel.tsx). Falls back to mdToHtml(detail)
  // when subsections is missing (old/cached analyses).
  const renderSubsections = (
    subs: Array<{ heading: string; body: string; bullets: string[] }> | undefined,
    detail: string,
    color: string,
    soft: string,
    border: string
  ): string => {
    if (!subs || subs.length === 0) {
      return mdToHtml(detail || "");
    }
    return `<div class="subsec-chain">${subs
      .map((s, i) => {
        const bulletsHtml =
          s.bullets && s.bullets.length > 0
            ? `<ul class="subsec-bullets">${s.bullets
                .map((b) => `<li><span class="bullet-dot" style="background:${color}"></span><span>${escapeHtml(stripMd(b))}</span></li>`)
                .join("")}</ul>`
            : "";
        return `
        <div class="subsec-card" style="border-color:${border}">
          <div class="subsec-header" style="background:${soft}">
            <span class="subsec-idx" style="background:${color}">${i + 1}</span>
            <span class="subsec-heading" style="color:${color}">${escapeHtml(stripMd(s.heading))}</span>
          </div>
          <div class="subsec-body">
            ${mdToHtml(s.body || "")}
            ${bulletsHtml}
          </div>
        </div>`;
      })
      .join("")}</div>`;
  };

  if (outline.questionBackground) {
    sections.push({
      index: 1,
      title: "问题与背景",
      ...SECTION_PALETTE[0],
      summary: stripMd(outline.questionBackground.summary || ""),
      bodyHtml: renderSubsections(
        outline.questionBackground.subsections,
        outline.questionBackground.detail || "",
        SECTION_PALETTE[0].color,
        SECTION_PALETTE[0].soft,
        SECTION_PALETTE[0].border
      ),
    });
  }
  if (outline.argumentSpine) {
    const sorted = [...figures].sort((a, b) => {
      const an = parseInt(a.label.replace(/\D/g, ""), 10) || 0;
      const bn = parseInt(b.label.replace(/\D/g, ""), 10) || 0;
      return an - bn;
    });
    const figHtml = sorted
      .map((f) => {
        const roleColor =
          f.role === "关键证据" ? "#5B7C99"
          : f.role === "验证" ? "#B8845C"
          : f.role === "延伸" ? "#7B6BA8"
          : "#94A3B8";
        return `
        <div class="fig-card" style="border-color:${SECTION_PALETTE[1].border}">
          <div class="fig-header" style="background:${SECTION_PALETTE[1].soft}">
            <span class="fig-label" style="color:${SECTION_PALETTE[1].color}">${escapeHtml(f.label)}</span>
            ${f.isLinchpin ? '<span class="linchpin">命门</span>' : ""}
            ${f.role ? `<span class="fig-role" style="color:${roleColor}">${escapeHtml(f.role)}</span>` : ""}
          </div>
          ${f.question ? `<div class="fig-q"><span class="q-marker">Q</span>${escapeHtml(stripMd(f.question))}</div>` : ""}
          ${f.caption ? `<div class="fig-cap">${escapeHtml(f.caption)}</div>` : ""}
          <div class="fig-meta">第 ${f.pageIndex} 页${f.panelCount > 0 ? ` · ${f.panelCount} 个面板` : ""}</div>
        </div>`;
      })
      .join("");

    sections.push({
      index: 2,
      title: "论证主线",
      ...SECTION_PALETTE[1],
      summary: stripMd(outline.argumentSpine.summary || ""),
      bodyHtml: figHtml
        ? `<div class="fig-chain">${figHtml}</div>`
        : mdToHtml(outline.argumentSpine.summary || ""),
    });
  }
  if (outline.novelty) {
    sections.push({
      index: 3,
      title: "创新性",
      ...SECTION_PALETTE[2],
      summary: stripMd(outline.novelty.summary || ""),
      bodyHtml: renderSubsections(
        outline.novelty.subsections,
        outline.novelty.detail || "",
        SECTION_PALETTE[2].color,
        SECTION_PALETTE[2].soft,
        SECTION_PALETTE[2].border
      ),
    });
  }
  if (outline.limitsOpportunities) {
    // Prefer subsections rendering; fall back to pairs table if no subsections
    const hasSubs =
      outline.limitsOpportunities.subsections &&
      outline.limitsOpportunities.subsections.length > 0;
    const bodyHtml = hasSubs
      ? renderSubsections(
          outline.limitsOpportunities.subsections,
          outline.limitsOpportunities.detail || "",
          SECTION_PALETTE[3].color,
          SECTION_PALETTE[3].soft,
          SECTION_PALETTE[3].border
        )
      : (() => {
          const pairsHtml = (outline.limitsOpportunities.pairs || [])
            .map(
              (p, i) => `
            <div class="pair-card" style="border-color:${SECTION_PALETTE[3].border}">
              <div class="pair-header" style="background:${SECTION_PALETTE[3].soft};color:${SECTION_PALETTE[3].color}">
                <span class="pair-idx">${i + 1}</span>
                <span class="pair-label">局限 → 机会</span>
              </div>
              <div class="pair-row limit">
                <span class="pair-badge" style="background:#C8556C">L</span>
                <span>${escapeHtml(stripMd(p.limitation))}</span>
              </div>
              <div class="pair-row opp">
                <span class="pair-badge" style="background:${SECTION_PALETTE[3].color}">O</span>
                <span>${escapeHtml(stripMd(p.opportunity))}</span>
              </div>
            </div>`
            )
            .join("");
          return pairsHtml || mdToHtml(outline.limitsOpportunities.detail || "");
        })();

    sections.push({
      index: 4,
      title: "局限与机会",
      ...SECTION_PALETTE[3],
      summary: stripMd(outline.limitsOpportunities.summary || ""),
      bodyHtml,
    });
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} · 思维导图</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
    color: #1e293b;
    margin: 0;
    padding: 32px 16px;
    line-height: 1.6;
  }
  .container { max-width: 900px; margin: 0 auto; }
  .header {
    text-align: center;
    margin-bottom: 32px;
    padding: 24px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }
  .header h1 {
    font-size: 22px;
    margin: 0 0 8px;
    color: #0f172a;
    font-weight: 600;
  }
  .header .meta {
    font-size: 12px;
    color: #64748b;
  }
  .section {
    margin-bottom: 16px;
    background: white;
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    border-left: 4px solid var(--accent);
  }
  .section-header {
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--soft);
    border-bottom: 1px solid var(--border);
  }
  .section-idx {
    width: 22px;
    height: 22px;
    border-radius: 5px;
    color: white;
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    flex-shrink: 0;
  }
  .section-title {
    font-size: 15px;
    font-weight: 600;
    color: var(--accent);
  }
  .section-body { padding: 12px 16px; }
  .section-summary {
    font-size: 13px;
    color: #475569;
    margin-bottom: 8px;
    padding: 8px 12px;
    background: var(--soft);
    border-radius: 6px;
    border-left: 3px solid var(--accent);
  }
  .section-detail {
    font-size: 13px;
    color: #334155;
    line-height: 1.7;
  }
  .section-detail p { margin: 8px 0; }
  .section-detail strong { color: #0f172a; }
  .section-detail code {
    background: rgba(0,0,0,0.05);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, monospace;
  }
  .section-detail sup, .section-detail sub { font-size: 0.75em; }
  .fig-chain { display: flex; flex-direction: column; gap: 8px; }
  .fig-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
  }
  .fig-header {
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid #e2e8f0;
  }
  .fig-label { font-weight: 700; font-size: 13px; }
  .linchpin {
    background: #fecdd3;
    color: #9f1239;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
  }
  .fig-role { font-size: 11px; }
  .fig-q {
    padding: 6px 12px;
    font-size: 12.5px;
    display: flex;
    gap: 6px;
  }
  .q-marker {
    color: #5B7C99;
    font-weight: 700;
    flex-shrink: 0;
  }
  .fig-cap {
    padding: 6px 12px;
    font-size: 11.5px;
    color: #64748b;
    border-top: 1px dashed #e2e8f0;
  }
  .fig-meta {
    padding: 4px 12px;
    font-size: 10.5px;
    color: #94a3b8;
    border-top: 1px solid #f1f5f9;
  }
  .pair-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .pair-header {
    padding: 6px 12px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .pair-idx {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    background: var(--accent, #5F8B7B);
  }
  .pair-row {
    padding: 8px 12px;
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: 12.5px;
  }
  .pair-row.limit { border-bottom: 1px dashed #e2e8f0; }
  .pair-row.opp { background: rgba(0,0,0,0.02); }
  .pair-badge {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 1px;
  }
  /* Subsection chain — multi-level collapsible cards rendered as static
     stacked cards in the exported HTML. Mirrors the in-app SubsectionChain
     UI so the exported mindmap looks identical to what the user sees. */
  .subsec-chain {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .subsec-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
  }
  .subsec-header {
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid #e2e8f0;
  }
  .subsec-idx {
    width: 20px;
    height: 20px;
    border-radius: 4px;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .subsec-heading {
    font-size: 13px;
    font-weight: 600;
  }
  .subsec-body {
    padding: 10px 14px;
    font-size: 12.5px;
    color: #334155;
    line-height: 1.7;
  }
  .subsec-body p { margin: 6px 0; }
  .subsec-body strong { color: #0f172a; }
  .subsec-body sup, .subsec-body sub { font-size: 0.75em; }
  .subsec-bullets {
    list-style: none;
    padding: 4px 0 2px;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .subsec-bullets li {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    color: #475569;
  }
  .bullet-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin-top: 7px;
    flex-shrink: 0;
  }
  .footer {
    text-align: center;
    margin-top: 32px;
    padding: 16px;
    color: #94a3b8;
    font-size: 11px;
  }
  @media print {
    body { background: white; padding: 0; }
    .section { box-shadow: none; border: 1px solid #e2e8f0; page-break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">MedReader 智能分析 · 4 层结构化思维导图 · ${new Date().toLocaleString("zh-CN")}</div>
  </div>
  ${sections
    .map(
      (s) => `
  <div class="section" style="--accent:${s.color};--soft:${s.soft};--border:${s.border}">
    <div class="section-header">
      <span class="section-idx">${s.index}</span>
      <span class="section-title">${escapeHtml(s.title)}</span>
    </div>
    <div class="section-body">
      ${s.summary ? `<div class="section-summary">${escapeHtml(s.summary)}</div>` : ""}
      <div class="section-detail">${s.bodyHtml}</div>
    </div>
  </div>`
    )
    .join("")}
  <div class="footer">
    由 MedReader Agent 自动生成 · 可在浏览器中打印为 PDF（Ctrl+P / Cmd+P）
  </div>
</div>
</body>
</html>`;

  downloadBlob(
    html,
    `${safeFileName(title)}_思维导图.html`,
    "text/html;charset=utf-8"
  );
}
