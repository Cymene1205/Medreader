import { LandingPage } from "@/app/landing/page";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Home page — v2.0 解耦式架构下的"红色宣传页入口"。
 *
 * v1.0 时 / 直接 redirect 到 /app，理由是 dev-server 编译 landing 包
 * 太慢会 OOM。v2.0 改为：/ 永远渲染 landing 宣传页（公开门面），
 * 已登录用户在 header 上点"进入工作台"才跳到 /app。
 *
 * 这样设计的根本原因：
 *   1. Landing 是公开门面，未登录访客也应该看到（GitHub 引流、
 *      搜索引擎索引、社交分享卡片预览）。
 *   2. 已登录用户访问 / 也看到 landing 是有意为之 —— 宣传页本身
 *      就是"项目主页"，已登录用户也可能想再读一遍 features/roadmap。
 *      不强制跳 /app 给用户多一个选择。
 *   3. 真正"进入工作台"的动作让用户主动点击 header 上的按钮完成，
 *      符合 v2.0 解耦式架构：Landing 与 App 是两个独立区域。
 *
 * 唯一例外：URL 里带 ?paperId=xxx 的分享链接直接跳 /app 加载分享
 * 论文（保持 v1.0 的分享功能行为）。
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ paperId?: string; p?: string }>;
}) {
  const sp = await searchParams;
  const sharedId = sp.paperId || sp.p;
  if (sharedId) {
    // 分享链接：跳到 /app 加载分享的论文
    redirect(`/app?paperId=${sharedId}`);
  }

  // 检查登录态，用于 header 显示"进入工作台"或"登录/注册"
  // 注意：这里不强制 redirect —— 已登录用户访问 / 也可以看 landing
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    // ignore — 未登录态，照常渲染 landing
  }
  void session; // session 传给 LandingPage 内部组件（通过 useSession 即可，这里只做存在性确认）

  return <LandingPage />;
}
