import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating Next.js dev-tools badge in the corner.
  devIndicators: false,
  // The plain Redis client (lib/store.ts) is loaded as it is, not bundled.
  serverExternalPackages: ["ioredis"],
  experimental: {
    // The proxy (proxy.ts) reads request bodies up to this size and cuts the rest off
    // (10 MB by default): the assistant's 8 MB of files arrive as about 11 MB of base64.
    proxyClientMaxBodySize: "12mb",
  },
};

export default nextConfig;
