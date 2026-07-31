import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * stripMarkdownInline — 把 LLM 漏到字符串字段里的 markdown 标记清掉，
 * 让文本可以安全地塞进 <button> / 行内 <span> 这种不能放块级元素的位置。
 *
 * 处理：
 *   - 代码围栏 ```...```  → 取围栏内纯文本
 *   - 散落的 ``` / `      → 删除
 *   - HTML 标签 <...>      → 删除
 *   - 行首标题 #/##/###    → 删除前缀
 *   - 加粗/斜体 **x** __x__ *x* _x_  → 保留 x，去标记
 *   - 行首列表标记 -/* /1. → 删除前缀
 *   - 引用文献 [1] [2]     → 删除（不影响 markdown 链接 [text](url)）
 *   - 显式 \n 转义         → 转成真换行
 *   - 多余空白             → 折叠
 *
 * 用于 summary / pairs / figure.question 等「应该是一行纯文本」的字段。
 * detail 字段本身就是 markdown，应直接走 ReactMarkdown，不要用这个函数。
 */
export function stripMarkdownInline(s: string | undefined | null): string {
  if (!s) return "";
  let t = String(s);
  // 1. 代码围栏块（含语言标识）→ 取中间纯文本
  t = t.replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, (_m, inner) => String(inner).trim());
  // 2. 残留的孤立 ``` 或 ` 删掉
  t = t.replace(/```/g, "").replace(/`/g, "");
  // 3. HTML 标签
  t = t.replace(/<[^>]+>/g, "");
  // 4. 显式 \n 转义 → 真换行
  t = t.replace(/\\n/g, "\n");
  // 5. 行首标题标记 ### / ## / #
  t = t.replace(/^#{1,6}\s+/gm, "");
  // 6. 加粗/斜体标记（保留内部文本）
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  t = t.replace(/__([^_\n]+)__/g, "$1");
  t = t.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1");
  t = t.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1");
  // 7. 行首列表标记
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");
  // 8. 引用文献标记 [1] [12] （不动 markdown 链接）
  t = t.replace(/\[\d+\]/g, "");
  // 9. 折叠多余空白（保留单个换行）
  t = t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return t;
}
