import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // 允许预览平台的 cross-origin 域名加载 _next 资源
  // 否则 Next.js 16 在 dev 模式下会拒绝来自 preview-*.space-z.ai 的请求
  allowedDevOrigins: [
    "https://preview-chat-3b1ea00c-b251-4552-821c-6ab4e7024475.space-z.ai",
    "https://*.space-z.ai",
    "http://*.space-z.ai",
  ],
};

export default nextConfig;
