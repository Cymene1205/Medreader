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
    // Next.js 16 breaking change: proxy (was "middleware" in 15.x) now
    // caps request body at 10 MB by default. Our auth proxy matches
    // /api/upload, so PDFs > 10 MB were silently truncated to 10 MB before
    // reaching the route handler, breaking `request.formData()` with
    // "Failed to parse body as FormData".
    // Bump to 50 MB to match serverActions.bodySizeLimit and MAX_UPLOAD_BYTES.
    //
    // ⚠️ Option name changed in Next.js 16:
    //   - 15.x: experimental.middlewareClientMaxBodySize
    //   - 16.x: experimental.proxyClientMaxBodySize  (middleware→proxy rename)
    // Using the old name produces a deprecation warning AND the limit
    // doesn't actually take effect, so 10+ MB uploads would still break.
    proxyClientMaxBodySize: "50mb",
  },
};

export default nextConfig;
