"use client";

import { GraduationCap, BookOpen, Mail, Link as LinkIcon, Heart } from "lucide-react";

export function Author() {
  return (
    <section
      id="author"
      className="paper-bg py-20 lg:py-28 border-t border-[var(--rule)]"
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        {/* 章节标头 */}
        <div className="grid grid-cols-12 gap-6 mb-14">
          <div className="col-span-12 lg:col-span-3">
            <div className="section-marker mb-2">§ VII.</div>
            <div className="journal-heading-en text-sm">About the Author / 关于作者</div>
          </div>
          <div className="col-span-12 lg:col-span-9">
            <h2 className="journal-heading text-3xl md:text-4xl lg:text-5xl mb-3">
              一人之作，致谢同仁
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-8 lg:gap-12">
          {/* 左：作者名片 */}
          <div className="col-span-12 lg:col-span-5">
            <div className="scholarly-card p-8 lg:p-10">
              {/* 头像占位 */}
              <div className="flex items-center gap-5 mb-6 pb-6 border-b border-[var(--rule)]">
                <div className="w-20 h-20 rounded-sm bg-[var(--burgundy)] text-[var(--paper)] flex items-center justify-center font-serif-cn text-3xl font-semibold shrink-0">
                  止
                </div>
                <div>
                  <div className="font-serif-cn text-2xl font-semibold text-[var(--ink)]">
                    行止集
                  </div>
                  <div className="font-serif-en italic text-sm text-[var(--burgundy)] mt-1">
                    Biorhythm
                  </div>
                  <div className="font-sans-ui text-[10px] tracking-[0.15em] uppercase text-[var(--ink-muted)] mt-1.5">
                    Builder · Reader · Author
                  </div>
                </div>
              </div>

              <ul className="space-y-4">
                <li className="flex items-start gap-3">
                  <GraduationCap className="w-4 h-4 text-[var(--burgundy)] mt-0.5 shrink-0" />
                  <div>
                    <div className="font-serif-cn text-sm font-semibold text-[var(--ink)]">
                      医学研究背景
                    </div>
                    <div className="font-serif-en italic text-xs text-[var(--ink-muted)]">
                      Medical research background · 工医交叉
                    </div>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <BookOpen className="w-4 h-4 text-[var(--moss)] mt-0.5 shrink-0" />
                  <div>
                    <div className="font-serif-cn text-sm font-semibold text-[var(--ink)]">
                      公众号「行止集」主理人
                    </div>
                    <div className="font-serif-en italic text-xs text-[var(--ink-muted)]">
                      Author of "Xing Zhi Ji" WeChat channel
                    </div>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <Mail className="w-4 h-4 text-[var(--gold)] mt-0.5 shrink-0" />
                  <div>
                    <div className="font-serif-cn text-sm font-semibold text-[var(--ink)]">
                      联系与交流
                    </div>
                    <div className="font-serif-en italic text-xs text-[var(--ink-muted)]">
                      通过公众号留言 / GitHub Issue
                    </div>
                  </div>
                </li>
              </ul>

              <div className="mt-6 pt-6 border-t border-dotted border-[var(--rule)]">
                <p className="font-serif-cn italic text-sm text-[var(--ink-soft)] leading-relaxed">
                  &ldquo;读文献是医学研究者最日常也最寂寞的劳动。希望 MedReader Agent
                  能让这份劳动稍微不那么孤独。&rdquo;
                </p>
                <p className="font-serif-en italic text-xs text-[var(--ink-muted)] mt-3 text-right">
                  — Biorhythm, 2026
                </p>
              </div>
            </div>
          </div>

          {/* 右：致谢 + 路线 */}
          <div className="col-span-12 lg:col-span-7">
            <div className="space-y-8">
              {/* 致谢 */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Heart className="w-4 h-4 text-[var(--burgundy)]" />
                  <span className="font-sans-ui text-[10px] tracking-[0.2em] uppercase text-[var(--burgundy)]">
                    Acknowledgement · 致谢
                  </span>
                </div>
                <p className="font-serif-cn text-[16px] leading-[1.95] text-[var(--ink-soft)]">
                  本项目的开发与维护得到<span className="font-semibold text-[var(--ink)]">阿里云开发者计划</span>的算力支持。感谢阿里云为开源教育工具提供的云资源赞助，让一个个人项目能够稳定地服务医学研究者群体。亦感谢所有在公众号「行止集」留言、提建议、报 bug 的读者——是你们让这个项目从一份个人脚本，逐步生长为一个可被同行使用的工具。
                </p>
              </div>

              {/* 路线图 */}
              <div className="border-t border-[var(--rule)] pt-8">
                <div className="flex items-center gap-2 mb-5">
                  <LinkIcon className="w-4 h-4 text-[var(--moss)]" />
                  <span className="font-sans-ui text-[10px] tracking-[0.2em] uppercase text-[var(--moss)]">
                    Roadmap · 项目路线
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    {
                      phase: "短期",
                      en: "Now",
                      items: ["五面板稳定版", "Docker 部署", "项目白皮书"],
                      done: true,
                    },
                    {
                      phase: "中期",
                      en: "Next",
                      items: ["多论文库管理", "本地向量检索", "团队共享工作区"],
                      done: false,
                    },
                    {
                      phase: "长期",
                      en: "Future",
                      items: ["领域知识图谱", "协作批注", "审稿辅助模式"],
                      done: false,
                    },
                  ].map((p) => (
                    <div
                      key={p.phase}
                      className={`p-5 border rounded-sm ${
                        p.done
                          ? "bg-[var(--moss)]/5 border-[var(--moss)]"
                          : "bg-[var(--paper-soft)] border-[var(--rule)]"
                      }`}
                    >
                      <div className="flex items-baseline justify-between mb-3">
                        <span
                          className={`font-serif-cn font-semibold text-base ${
                            p.done ? "text-[var(--moss)]" : "text-[var(--ink)]"
                          }`}
                        >
                          {p.phase}
                        </span>
                        <span className="font-serif-en italic text-[10px] text-[var(--ink-muted)]">
                          {p.en}
                        </span>
                      </div>
                      <ul className="space-y-1.5">
                        {p.items.map((it) => (
                          <li
                            key={it}
                            className="flex items-center gap-2 font-sans-ui text-xs text-[var(--ink-soft)]"
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                p.done ? "bg-[var(--moss)]" : "bg-[var(--rule)]"
                              }`}
                            />
                            {it}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
