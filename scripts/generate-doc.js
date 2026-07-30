// MedReader Agent — Project Documentation Generator
// Generates a complete whitepaper-style .docx file
// Style: Product brand (medical purple accent), Word output

const {
  Document, Packer, Paragraph, TextRun, Header, Footer,
  AlignmentType, HeadingLevel, PageNumber, PageBreak,
  Table, TableRow, TableCell, TableLayoutType, WidthType,
  BorderStyle, ShadingType, SectionType, NumberFormat,
  TableOfContents, Tab, LevelFormat,
} = require("docx");
const fs = require("fs");

// ─────────────────────────────────────────────────────────────────────────────
// 1. PALETTE — Medical Blue (CM-2 inspired, dark cover + light body tables)
// ─────────────────────────────────────────────────────────────────────────────
const P = {
  bg: "0F1B2D",         // cover background (deep navy)
  primary: "FFFFFF",    // cover title color (white on dark)
  accent: "7C3AED",     // medical purple accent
  body: "1F2937",       // body text (slate-800)
  secondary: "6B7280",  // captions (slate-500)
  surface: "F5F3FF",    // table alt rows (purple-50)
  // Cover-specific colors
  coverTitle: "FFFFFF",
  coverSubtitle: "C7D2FE",   // indigo-200
  coverMeta: "94A3B8",       // slate-400
  coverFooter: "64748B",     // slate-500
  // Table colors
  tableHeaderBg: "5B21B6",   // purple-800
  tableHeaderText: "FFFFFF",
  tableAccentLine: "7C3AED",
  tableInnerLine: "EDE9FE",  // purple-100
};

const allNoBorders = {
  top: { style: BorderStyle.NONE },
  bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE },
  right: { style: BorderStyle.NONE },
  insideHorizontal: { style: BorderStyle.NONE },
  insideVertical: { style: BorderStyle.NONE },
};
const noBorders = {
  top: { style: BorderStyle.NONE },
  bottom: { style: BorderStyle.NONE },
  left: { style: BorderStyle.NONE },
  right: { style: BorderStyle.NONE },
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. COMPONENT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 480, after: 200 },
    children: [new TextRun({
      text, bold: true, size: 36, color: P.accent,
      font: { ascii: "Calibri", eastAsia: "SimHei" },
    })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 140 },
    children: [new TextRun({
      text, bold: true, size: 28, color: P.body,
      font: { ascii: "Calibri", eastAsia: "SimHei" },
    })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 240, after: 100 },
    children: [new TextRun({
      text, bold: true, size: 24, color: P.body,
      font: { ascii: "Calibri", eastAsia: "SimHei" },
    })],
  });
}

function body(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { firstLine: 480 },
    spacing: { line: 312, after: 80 },
    children: [new TextRun({
      text, size: 24, color: P.body,
      font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" },
    })],
  });
}

// Bullet-style paragraph (no first-line indent, left dash)
function bullet(text) {
  return new Paragraph({
    spacing: { line: 312, after: 60 },
    indent: { left: 480, hanging: 240 },
    children: [
      new TextRun({ text: "• ", size: 24, color: P.accent, bold: true }),
      new TextRun({ text, size: 24, color: P.body,
        font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" } }),
    ],
  });
}

// Bullet with bold lead (e.g., "**核心特性：** 内容...")
function bulletKV(label, value) {
  return new Paragraph({
    spacing: { line: 312, after: 60 },
    indent: { left: 480, hanging: 240 },
    children: [
      new TextRun({ text: "• ", size: 24, color: P.accent, bold: true }),
      new TextRun({ text: label, size: 24, color: P.body, bold: true,
        font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" } }),
      new TextRun({ text: " " + value, size: 24, color: P.body,
        font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" } }),
    ],
  });
}

function blockQuote(text) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 312, before: 120, after: 160 },
    indent: { left: 360, right: 360 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 24, color: P.accent, space: 12 },
    },
    shading: { type: ShadingType.CLEAR, fill: P.surface },
    children: [new TextRun({
      text, size: 22, italics: true, color: P.body,
      font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" },
    })],
  });
}

// Simple 2-column table (label | value)
function infoTable(rows) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: P.accent },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: P.accent },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: P.tableInnerLine },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: rows.map(([label, value], i) => new TableRow({
      cantSplit: true,
      children: [
        new TableCell({
          width: { size: 28, type: WidthType.PERCENTAGE },
          margins: { top: 100, bottom: 100, left: 160, right: 100 },
          shading: i === 0
            ? { type: ShadingType.CLEAR, fill: P.tableHeaderBg }
            : { type: ShadingType.CLEAR, fill: P.surface },
          children: [new Paragraph({
            children: [new TextRun({
              text: label,
              bold: true, size: 22,
              color: i === 0 ? P.tableHeaderText : P.body,
              font: { ascii: "Calibri", eastAsia: "SimHei" },
            })],
          })],
        }),
        new TableCell({
          width: { size: 72, type: WidthType.PERCENTAGE },
          margins: { top: 100, bottom: 100, left: 160, right: 160 },
          shading: i === 0
            ? { type: ShadingType.CLEAR, fill: P.tableHeaderBg }
            : { type: ShadingType.CLEAR, fill: "FFFFFF" },
          children: [new Paragraph({
            children: [new TextRun({
              text: value, size: 22,
              color: i === 0 ? P.tableHeaderText : P.body,
              font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" },
            })],
          })],
        }),
      ],
    })),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. COVER — Dark navy background + purple accent + left-aligned title
// ─────────────────────────────────────────────────────────────────────────────
function buildCover() {
  const padL = 1200, padR = 800;
  const accentLeft = { style: BorderStyle.SINGLE, size: 8, color: P.accent, space: 12 };

  const children = [];

  // Top whitespace
  children.push(new Paragraph({ spacing: { before: 2400 } }));

  // English label with accent bottom border
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    spacing: { after: 600 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: P.accent, space: 8 } },
    children: [new TextRun({
      text: "M  E  D  R  E  A  D  E  R    A  G  E  N  T",
      size: 18, color: P.accent, characterSpacing: 40,
      font: { ascii: "Calibri", eastAsia: "SimHei" },
    })],
  }));

  // Main title (line 1)
  children.push(new Paragraph({
    indent: { left: padL },
    spacing: { after: 100, line: 920, lineRule: "atLeast" },
    children: [new TextRun({
      text: "MedReader Agent",
      size: 80, bold: true, color: P.coverTitle,
      font: { ascii: "Arial", eastAsia: "SimHei" },
    })],
  }));

  // Subtitle (Chinese)
  children.push(new Paragraph({
    indent: { left: padL },
    spacing: { after: 200, line: 560, lineRule: "atLeast" },
    children: [new TextRun({
      text: "智能文献阅读 Agent",
      size: 44, bold: true, color: P.coverSubtitle,
      font: { ascii: "Arial", eastAsia: "SimHei" },
    })],
  }));

  // Tagline
  children.push(new Paragraph({
    indent: { left: padL },
    spacing: { after: 800 },
    children: [new TextRun({
      text: "让每一篇论文都被真正读懂、用透",
      size: 24, color: P.coverMeta,
      font: { ascii: "Arial", eastAsia: "Microsoft YaHei" },
    })],
  }));

  // Meta info with left accent border
  const metaLines = [
    "项目类型：智能文献阅读 Agent / 科研辅助工具",
    "开发者：陈禹墨",
    "所属机构：华中科技大学同济医学院",
    "文档版本：v1.0",
    "日期：2026 年",
  ];
  for (const line of metaLines) {
    children.push(new Paragraph({
      indent: { left: padL + 200 },
      spacing: { after: 100 },
      border: { left: accentLeft },
      children: [new TextRun({
        text: line, size: 22, color: P.coverMeta,
        font: { ascii: "Arial", eastAsia: "Microsoft YaHei" },
      })],
    }));
  }

  // Bottom whitespace
  children.push(new Paragraph({ spacing: { before: 3000 } }));

  // Footer with top accent separator
  children.push(new Paragraph({
    indent: { left: padL, right: padR },
    border: { top: { style: BorderStyle.SINGLE, size: 2, color: P.accent, space: 8 } },
    spacing: { before: 200 },
    children: [
      new TextRun({ text: "行止集 BioRhythm / 计算医学", size: 16, color: P.coverFooter, font: { ascii: "Arial", eastAsia: "Microsoft YaHei" } }),
      new TextRun({ text: "                                                  " }),
      new TextRun({ text: "Project Whitepaper · 2026", size: 16, color: P.coverFooter, font: { ascii: "Arial" } }),
    ],
  }));

  // Single 16838 wrapper table — full-page dark background
  return [new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: allNoBorders,
    rows: [new TableRow({
      height: { value: 16838, rule: "exact" },
      children: [new TableCell({
        shading: { type: ShadingType.CLEAR, fill: P.bg },
        borders: noBorders,
        children,
      })],
    })],
  })];
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. TOC SECTION
// ─────────────────────────────────────────────────────────────────────────────
function buildToc() {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 360 },
      children: [new TextRun({
        text: "目  录", bold: true, size: 36, color: P.body,
        font: { ascii: "Calibri", eastAsia: "SimHei" },
      })],
    }),
    new TableOfContents("Table of Contents", {
      hyperlink: true,
      headingStyleRange: "1-3",
      stylesWithLevels: [],
    }),
    new Paragraph({
      spacing: { before: 200 },
      children: [new TextRun({
        text: "（提示：右键点击目录 → 「更新域」可刷新页码）",
        italics: true, size: 18, color: P.secondary,
        font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" },
      })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. BODY CONTENT — Chapters
// ─────────────────────────────────────────────────────────────────────────────
// Loaded from external module to keep this file readable
const { buildBody } = require("./generate-doc-body.js");

// ─────────────────────────────────────────────────────────────────────────────
// 6. ASSEMBLE DOCUMENT
// ─────────────────────────────────────────────────────────────────────────────
const doc = new Document({
  creator: "陈禹墨",
  title: "MedReader Agent 项目白皮书",
  description: "智能文献阅读 Agent 项目文档",
  styles: {
    default: {
      document: {
        run: {
          font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" },
          size: 24, color: P.body,
        },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: {
          font: { ascii: "Calibri", eastAsia: "SimHei" },
          size: 36, bold: true, color: P.accent,
        },
        paragraph: { spacing: { before: 480, after: 200 } },
      },
      heading2: {
        run: {
          font: { ascii: "Calibri", eastAsia: "SimHei" },
          size: 28, bold: true, color: P.body,
        },
        paragraph: { spacing: { before: 320, after: 140 } },
      },
      heading3: {
        run: {
          font: { ascii: "Calibri", eastAsia: "SimHei" },
          size: 24, bold: true, color: P.body,
        },
        paragraph: { spacing: { before: 240, after: 100 } },
      },
    },
  },
  sections: [
    // ── Section 1: Cover (no page number, margin 0) ──
    {
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 0, bottom: 0, left: 0, right: 0 },
        },
      },
      children: buildCover(),
    },
    // ── Section 2: TOC (Roman numerals) ──
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
          pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN },
        },
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({
              children: [PageNumber.CURRENT], size: 18, color: P.secondary,
            })],
          })],
        }),
      },
      children: buildToc(),
    },
    // ── Section 3: Body (Arabic, reset to 1) ──
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, bottom: 1440, left: 1701, right: 1417 },
          pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: P.accent, space: 4 } },
            children: [new TextRun({
              text: "MedReader Agent · 项目白皮书",
              size: 18, color: P.secondary,
              font: { ascii: "Calibri", eastAsia: "Microsoft YaHei" },
            })],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "— ", size: 18, color: P.secondary }),
              new TextRun({ children: [PageNumber.CURRENT], size: 18, color: P.secondary }),
              new TextRun({ text: " —", size: 18, color: P.secondary }),
            ],
          })],
        }),
      },
      children: buildBody({
        h1, h2, h3, body, bullet, bulletKV, blockQuote, infoTable, P,
      }),
    },
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. WRITE FILE
// ─────────────────────────────────────────────────────────────────────────────
const outputPath = "/home/z/my-project/download/MedReader-Agent-项目白皮书.docx";
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outputPath, buf);
  console.log("✅ Generated:", outputPath);
  console.log("   Size:", (buf.length / 1024).toFixed(1), "KB");
}).catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
