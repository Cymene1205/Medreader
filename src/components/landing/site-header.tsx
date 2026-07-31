"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { BookMarked, Github, ExternalLink, LogIn, ArrowRight } from "lucide-react";

const NAV_ITEMS = [
  { label: "概览", en: "Overview", href: "#overview" },
  { label: "核心功能", en: "Features", href: "#features" },
  { label: "六维分析", en: "Dimensions", href: "#dimensions" },
  { label: "工作流", en: "Workflow", href: "#workflow" },
  { label: "技术架构", en: "Stack", href: "#stack" },
  { label: "部署方案", en: "Deploy", href: "#deployment" },
  { label: "路线图", en: "Roadmap", href: "#roadmap" },
  { label: "应用场景", en: "Use Cases", href: "#usecases" },
  { label: "作者", en: "Author", href: "#author" },
];

export function SiteHeader() {
  const { data: session, status } = useSession();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[var(--paper)]/95 backdrop-blur-md border-b border-[var(--rule)]"
          : "bg-transparent"
      }`}
    >
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10">
        <div className="flex items-center justify-between h-16">
          {/* Brand */}
          <a href="#top" className="flex items-center gap-2.5 group">
            <span className="w-9 h-9 rounded-sm bg-[var(--burgundy)] text-[var(--paper)] flex items-center justify-center shadow-sm">
              <BookMarked className="w-4 h-4" strokeWidth={2.2} />
            </span>
            <div className="flex flex-col leading-tight">
              <span className="font-serif-en text-[15px] font-semibold text-[var(--ink)] tracking-tight">
                MedReader <span className="italic text-[var(--burgundy)]">Agent</span>
              </span>
              <span className="font-sans-ui text-[9px] tracking-[0.22em] uppercase text-[var(--ink-muted)]">
                Vol. I · 2026
              </span>
            </div>
          </a>

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1">
            {NAV_ITEMS.map((it) => (
              <a
                key={it.href}
                href={it.href}
                className="group relative px-3 py-2 font-sans-ui text-[12px] tracking-[0.08em] uppercase text-[var(--ink-soft)] hover:text-[var(--burgundy)] transition-colors"
              >
                {it.label}
                <span className="block font-serif-en italic text-[9px] tracking-wide text-[var(--ink-muted)] group-hover:text-[var(--burgundy-soft)] transition-colors">
                  {it.en}
                </span>
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href="https://github.com/Cymene1205/Medreader"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 font-sans-ui text-[11px] tracking-[0.08em] uppercase text-[var(--ink-soft)] border border-[var(--rule)] rounded-sm hover:border-[var(--burgundy)] hover:text-[var(--burgundy)] transition-colors"
            >
              <Github className="w-3.5 h-3.5" />
              GitHub
            </a>
            {status === "loading" ? null : session?.user ? (
              <Link
                href="/app"
                className="inline-flex items-center gap-1.5 px-4 py-2 font-sans-ui text-[11px] tracking-[0.1em] uppercase bg-[var(--burgundy)] text-[var(--paper)] rounded-sm hover:bg-[var(--burgundy-deep)] transition-colors shadow-sm"
              >
                进入工作台
                <ArrowRight className="w-3 h-3" />
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 font-sans-ui text-[11px] tracking-[0.08em] uppercase text-[var(--ink-soft)] hover:text-[var(--burgundy)] transition-colors"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  登录
                </Link>
                <Link
                  href="/register"
                  className="inline-flex items-center gap-1.5 px-4 py-2 font-sans-ui text-[11px] tracking-[0.1em] uppercase bg-[var(--burgundy)] text-[var(--paper)] rounded-sm hover:bg-[var(--burgundy-deep)] transition-colors shadow-sm"
                >
                  开始体验
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </>
            )}
            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="lg:hidden p-2 text-[var(--ink)]"
              aria-label="Toggle menu"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                {mobileOpen ? (
                  <path d="M18 6 6 18M6 6l12 12" />
                ) : (
                  <path d="M3 12h18M3 6h18M3 18h18" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <nav className="lg:hidden pb-4 pt-2 flex flex-col gap-1 border-t border-[var(--rule)]">
            {NAV_ITEMS.map((it) => (
              <a
                key={it.href}
                href={it.href}
                onClick={() => setMobileOpen(false)}
                className="px-3 py-2 font-sans-ui text-sm text-[var(--ink-soft)] hover:text-[var(--burgundy)] hover:bg-[var(--paper-dark)] rounded-sm"
              >
                {it.label}{" "}
                <span className="font-serif-en italic text-[10px] text-[var(--ink-muted)]">
                  · {it.en}
                </span>
              </a>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
