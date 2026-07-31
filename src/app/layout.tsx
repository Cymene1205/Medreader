import type { Metadata } from "next";
import { EB_Garamond, Noto_Serif_SC, Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const ebGaramond = EB_Garamond({
  variable: "--font-serif-en",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const notoSerifSC = Noto_Serif_SC({
  variable: "--font-serif-cn",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const inter = Inter({
  variable: "--font-sans-ui",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MedReader Agent — 让 AI 帮你真正读懂一篇医学文献",
  description:
    "面向医学研究者的 AI 文献阅读 Agent。五面板协同 + 六维度论文分析 + DeepSeek 大模型问答，将 PDF 转化为可对话、可导航、可质疑的知识。",
  keywords: [
    "MedReader Agent",
    "AI 文献阅读",
    "医学文献",
    "MinerU",
    "DeepSeek",
    "Next.js",
    "学术工具",
    "行止集",
    "Biorhythm",
  ],
  authors: [{ name: "行止集 Biorhythm" }],
  openGraph: {
    title: "MedReader Agent — 让 AI 帮你真正读懂一篇医学文献",
    description:
      "面向医学研究者的 AI 文献阅读 Agent。五面板协同 + 六维度论文分析。",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* ES2025 polyfills MUST run before any client JS bundle.
            pdfjs-dist v6 uses Math.sumPrecise, Map.prototype.getOrInsertComputed,
            and Iterator helpers — all Stage-3 proposals that only landed in
            Chrome 137+ (April 2025). Without this script, pdfjs throws
            `TypeError: Math.sumPrecise is not a function` on older browsers
            and PDF rendering silently fails with a blank canvas.
            Loaded synchronously in <head> so it executes before hydration. */}
        <script src="/polyfills.js" />
      </head>
      <body
        className={`${ebGaramond.variable} ${notoSerifSC.variable} ${inter.variable} antialiased bg-background text-foreground`}
      >
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
