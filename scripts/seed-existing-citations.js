// One-shot: backfill citationsJson for existing papers using the current
// align-citations logic. Same approach as seed-existing-figures.js —
// inline the logic (can't require TS directly from Node).

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const CITATION_RE =
  /(?:(?:Fig(?:ure|s|\.)?|Extended\s+Data\s+Figure|Supplementary\s+Figure)\s*S?\d+(?:[A-Za-z,\s\u2013\-–—andand]+)?)/gi;

function buildPageIndexMap(text) {
  const map = [];
  const re = /\[Page\s+(\d+)\]/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    map.push({ offset: m.index, page: parseInt(m[1], 10) });
  }
  return map;
}

function pageAtOffset(map, offset) {
  let page = 0;
  for (const { offset: o, page: p } of map) {
    if (o <= offset) page = p;
    else break;
  }
  return page;
}

function sentenceAround(text, offset) {
  let start = 0;
  for (let i = offset - 1; i > 0; i--) {
    const c = text[i];
    const prev = text[i - 1] || "";
    if (
      (prev === "." || prev === "!" || prev === "?") &&
      /\s/.test(c) &&
      /[A-Z\u4e00-\u9fff]/.test(text[i + 1] || "")
    ) {
      start = i + 1;
      break;
    }
    if (c === "\n" && i < offset - 1 && /[.!?\n]/.test(text[i - 1] || "")) {
      start = i + 1;
      break;
    }
  }
  let end = text.length;
  for (let i = offset + 1; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1] || "";
    if ((c === "." || c === "!" || c === "?") && (/\s/.test(next) || next === "")) {
      end = i + 1;
      break;
    }
  }
  const snippet = text.slice(start, end).trim();
  return snippet.length > 300 ? snippet.slice(0, 300) + "…" : snippet;
}

function parsePanels(panelStr) {
  const panels = new Set();
  const rangeRe = /([A-Za-z])\s*[–\-—]\s*([A-Za-z])/g;
  let m;
  let working = panelStr;
  const expanded = [];
  let lastIdx = 0;
  while ((m = rangeRe.exec(working)) !== null) {
    expanded.push(working.slice(lastIdx, m.index));
    const start = m[1].toUpperCase().charCodeAt(0) - 64;
    const end = m[2].toUpperCase().charCodeAt(0) - 64;
    if (start > 0 && end >= start && end - start < 26) {
      for (let i = start; i <= end; i++) {
        expanded.push(String.fromCharCode(64 + i));
      }
    } else {
      expanded.push(m[1].toUpperCase(), m[2].toUpperCase());
    }
    lastIdx = m.index + m[0].length;
  }
  expanded.push(working.slice(lastIdx));
  working = expanded.join(" ");
  const letterRe = /\b([A-Za-z])\b/g;
  while ((m = letterRe.exec(working)) !== null) {
    const letter = m[1].toUpperCase();
    if (/^[A-Z]$/.test(letter)) panels.add(letter);
  }
  return Array.from(panels).sort();
}

function expandMatch(raw) {
  const out = [];
  const trimmed = raw.trim();
  const isSupp =
    /\bS\d/i.test(trimmed) ||
    /Extended\s+Data/i.test(trimmed) ||
    /Supplementary/i.test(trimmed);
  const cleaned = trimmed
    .replace(/Extended\s+Data\s+/gi, "")
    .replace(/Supplementary\s+/gi, "");
  const figRe = /Fig(?:ure|s|\.)?\s*(S?\d+)\s*([A-Za-z,\s\u2013\-–—and]+)?/gi;
  let m;
  while ((m = figRe.exec(cleaned)) !== null) {
    const numStr = m[1];
    const panelStr = m[2] || "";
    const isThisSupp = isSupp || /^S/i.test(numStr);
    const num = numStr.replace(/^S/i, "");
    const label = isThisSupp ? `Figure S${num}` : `Figure ${num}`;
    const panels = parsePanels(panelStr);
    out.push({ label, isSupp: isThisSupp, panels });
  }
  return out;
}

function extractCitations(text) {
  if (!text) return [];
  const pageMap = buildPageIndexMap(text);
  const out = [];
  let m;
  const re = new RegExp(CITATION_RE.source, "gi");
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const offset = m.index;
    const expanded = expandMatch(raw);
    const sentence = sentenceAround(text, offset);
    const page = pageAtOffset(pageMap, offset);
    for (const e of expanded) {
      out.push({
        figureLabel: e.label,
        panels: e.panels,
        sentence,
        pageIndex: page,
        isSupp: e.isSupp,
      });
    }
  }
  return out;
}

async function main() {
  const papers = await prisma.paper.findMany({
    where: { markdown: { not: null } },
    select: { id: true, title: true, markdown: true, parsedText: true, citationsJson: true },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Found ${papers.length} papers with markdown`);

  for (const p of papers) {
    const source = (p.markdown && p.markdown.trim()) || (p.parsedText && p.parsedText.trim()) || "";
    if (!source) {
      console.log(`\nPaper ${p.id}: no source text, skip`);
      continue;
    }
    const citations = extractCitations(source);
    const mainCount = citations.filter((c) => !c.isSupp).length;
    const suppCount = citations.filter((c) => c.isSupp).length;
    const existing = p.citationsJson ? JSON.parse(p.citationsJson).length : 0;
    console.log(
      `\nPaper ${p.id} · ${(p.title || "").slice(0, 50)}\n  existing: ${existing}, new: ${citations.length} (main=${mainCount}, supp=${suppCount})`
    );
    if (citations.length === 0) continue;
    await prisma.paper.update({
      where: { id: p.id },
      data: { citationsJson: JSON.stringify(citations) },
    });
    // Show first 3 non-supp
    const main = citations.filter((c) => !c.isSupp).slice(0, 3);
    for (const c of main) {
      console.log(`  ${c.figureLabel} panels=[${c.panels.join(",")}] p${c.pageIdx || c.pageIndex}: ${c.sentence.slice(0, 80)}…`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
