import { SiteHeader } from "@/components/landing/site-header";
import { Hero } from "@/components/landing/hero";
import { Editorial } from "@/components/landing/editorial";
import { Features } from "@/components/landing/features";
import { Dimensions } from "@/components/landing/dimensions";
import { Workflow } from "@/components/landing/workflow";
import { TechStack } from "@/components/landing/tech-stack";
import { DeploymentSection } from "@/components/landing/deployment";
import { Roadmap } from "@/components/landing/roadmap";
import { UseCases } from "@/components/landing/use-cases";
import { Author } from "@/components/landing/author";
import { CTA } from "@/components/landing/cta";
import { SiteFooter } from "@/components/landing/site-footer";

/**
 * Landing page — v2.0 红色宣传页（burgundy 期刊风）。
 *
 * v1.0 时只在 /landing 路由访问；v2.0 解耦式架构后，/ 也渲染这个
 * 页面作为公开门面入口。已登录用户在 header 点"进入工作台"跳 /app。
 *
 * 章节顺序（v2.0 新增 Deployment + Roadmap）：
 *   Hero → Editorial → Features → Dimensions → Workflow
 *        → TechStack → Deployment → Roadmap
 *        → UseCases → Author → CTA
 */
export function LandingPage() {
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
        <DeploymentSection />
        <Roadmap />
        <UseCases />
        <Author />
        <CTA />
      </main>
      <SiteFooter />
    </div>
  );
}

// 默认导出保留，/landing 路由仍可用
export default LandingPage;
