// 复制 utils.ts 的 stripMarkdownInline 逻辑做快速验证
function stripMarkdownInline(s) {
  if (!s) return "";
  let t = String(s);
  t = t.replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, (_m, inner) => String(inner).trim());
  t = t.replace(/```/g, "").replace(/`/g, "");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/\\n/g, "\n");
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  t = t.replace(/__([^_\n]+)__/g, "$1");
  t = t.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1");
  t = t.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");
  t = t.replace(/\[\d+\]/g, "");
  t = t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

const cases = [
  // 1. 干净的 summary（DB 实际数据）
  "本研究利用单细胞转录组学与CITE-seq技术，系统描绘了小鼠心肌梗死后心脏和血液中性粒细胞的动态异质性。",
  // 2. LLM 漏出 markdown
  "**核心创新点**：首次揭示心肌梗死后心脏中性粒细胞的动态异质性",
  // 3. 标题 + 列表
  "### 核心科学问题\n- 第一项\n- 第二项",
  // 4. 编号列表
  "1. 样本量有限\n2. 模型局限性",
  // 5. 含 \\n 转义
  "第一段\\n第二段",
  // 6. HTML 标签
  "SiglecF<sup>hi</sup> 中性粒细胞",
  // 7. 引用文献
  "中性粒细胞在心肌梗死中发挥作用 [1][2]",
  // 8. 代码围栏
  "```json\n{\"a\":1}\n```",
  // 9. argumentSpine 实际数据
  "本文先通过Fig 1发现心肌梗死后中性粒细胞亚群动态变化，进而Fig 2证实其转录异质性及时间特异性，命门在Fig 3揭示中性粒细胞向巨噬细胞传递信号的机制【Fig 3】",
  // 10. markdown 链接（不应被破坏）
  "详见 [论文](https://example.com/paper.pdf)",
];

for (const [i, c] of cases.entries()) {
  console.log(`Case ${i+1}:`);
  console.log("  in :", JSON.stringify(c));
  console.log("  out:", JSON.stringify(stripMarkdownInline(c)));
}
