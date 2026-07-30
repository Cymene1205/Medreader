"use client";

import { Quote } from "lucide-react";

export function Editorial() {
  return (
    <section id="overview" className="paper-bg py-20 lg:py-28 border-t border-[var(--rule)]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        {/* 章节标头 */}
        <div className="grid grid-cols-12 gap-6 mb-12">
          <div className="col-span-12 lg:col-span-3">
            <div className="section-marker mb-2">§ I.</div>
            <div className="journal-heading-en text-sm">Editorial / 项目寄语</div>
          </div>
          <div className="col-span-12 lg:col-span-9">
            <h2 className="journal-heading text-3xl md:text-4xl lg:text-5xl mb-3">
              从"读完一篇文献"到"读透一篇文献"
            </h2>
            <div className="ornament-rule max-w-md">
              <span className="font-serif-en italic text-xs">A note from the builder</span>
            </div>
          </div>
        </div>

        {/* 双栏正文 */}
        <div className="grid grid-cols-12 gap-8 lg:gap-16">
          <div className="col-span-12 lg:col-span-7">
            <div className="font-serif-cn text-[17px] leading-[1.95] text-[var(--ink-soft)] space-y-5">
              <p className="drop-cap">
                医学研究的速度从未放缓。PubMed 每天新增的文献数以千计，每一篇都试图改写某个细分领域的认知边界。然而对研究者而言，"读文献"这件事却依然停留在二十年前的范式里——下载 PDF、翻页浏览、做笔记、查词典、回头核对方法、再翻到讨论寻找局限性。一篇三十页的论文，常常需要一个下午才能勉强"读完"，却未必"读透"。
              </p>
              <p>
                MedReader Agent 想要做的事很简单：让 AI 不只是"摘要"文献，而是真正与读者一起<span className="text-[var(--burgundy)] font-semibold">逐段精读、结构化拆解、随时质疑</span>。我们设计了一个五面板协同工作区——左侧是 PDF 原文，中间是结构化解析与思维导图，右侧是 Agent 问答，下方是全文框架与段落导航。所有面板互相联动：在框架里点一个章节，原文自动滚到对应位置；在原文选中一段文字，Agent 立刻可以基于这段上下文回答问题。
              </p>
              <p>
                更进一步，我们让 Agent 基于论文的<span className="text-[var(--burgundy)] font-semibold">六个核心维度</span>——科学问题、论证思路、实验方法与结果、论证逻辑解析、创新性、局限性——主动生成结构化分析。这不是简单的"摘要"或"翻译"，而是接近同行评议深度的二次解读。研究者拿到的不再是一份文本，而是一份可对话、可质疑、可引用的知识工件。
              </p>
            </div>
          </div>

          <div className="col-span-12 lg:col-span-5 lg:border-l lg:border-[var(--rule)] lg:pl-12">
            <div className="deco-quote mb-2">&ldquo;</div>
            <blockquote className="pullquote text-xl md:text-2xl mb-10">
              文献阅读不应是一场单方面的劳作，而应是一次与作者、与 AI、与自己的三方对谈。
            </blockquote>

            <div className="space-y-6 mt-12">
              {[
                {
                  k: "01",
                  title: "阅读，而非浏览",
                  en: "Read, not skim",
                  body: "段落级精读 + 结构化拆解，让每一句话都能被追问。",
                },
                {
                  k: "02",
                  title: "对话，而非摘录",
                  en: "Converse, not excerpt",
                  body: "Agent 基于原文上下文回答，所有论断可溯源到段落。",
                },
                {
                  k: "03",
                  title: "质疑，而非接受",
                  en: "Question, not accept",
                  body: "六维度分析内置「局限性」维度，鼓励批判性阅读。",
                },
              ].map((it) => (
                <div key={it.k} className="flex gap-4 group">
                  <div className="numeral text-2xl shrink-0 w-10">{it.k}</div>
                  <div>
                    <div className="font-serif-cn font-semibold text-[var(--ink)] text-base mb-0.5">
                      {it.title}
                      <span className="ml-2 font-serif-en italic text-xs text-[var(--ink-muted)] font-normal">
                        · {it.en}
                      </span>
                    </div>
                    <p className="font-serif-cn text-sm text-[var(--ink-soft)] leading-relaxed">
                      {it.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 脚注 */}
        <div className="mt-16 pt-6 border-t border-dotted border-[var(--rule)] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <p className="font-sans-ui text-[10px] tracking-[0.15em] uppercase text-[var(--ink-muted)]">
            <Quote className="inline w-3 h-3 mr-1" />
            Editorial · By the MedReader Agent project
          </p>
          <p className="font-serif-en italic text-xs text-[var(--ink-muted)]">
            First published online · July 2026
          </p>
        </div>
      </div>
    </section>
  );
}
