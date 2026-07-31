import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
  // 医学 PDF 普遍 5-30 MB，Next.js 默认 1 MB body 限制会让上传必挂。
  // 上限 50 MB 与 src/app/api/upload/route.ts 的 MAX_UPLOAD_BYTES 一致。
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
