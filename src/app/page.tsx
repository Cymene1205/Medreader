"use client";

import { SiteHeader } from "@/components/landing/site-header";
import { Hero } from "@/components/landing/hero";
import { Editorial } from "@/components/landing/editorial";
import { Features } from "@/components/landing/features";
import { Dimensions } from "@/components/landing/dimensions";
import { Workflow } from "@/components/landing/workflow";
import { TechStack } from "@/components/landing/tech-stack";
import { UseCases } from "@/components/landing/use-cases";
import { Author } from "@/components/landing/author";
import { CTA } from "@/components/landing/cta";
import { SiteFooter } from "@/components/landing/site-footer";

export default function Home() {
  return (
    <div className="paper-bg min-h-screen flex flex-col">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <Editorial />
        <Features />
        <Dimensions />
        <Workflow />
        <TechStack />
        <UseCases />
        <Author />
        <CTA />
      </main>
      <SiteFooter />
    </div>
  );
}
