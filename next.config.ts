import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the floating Next.js dev-tools badge in the corner.
  devIndicators: false,
  // The plain Redis client (lib/store.ts) is loaded as it is, not bundled.
  serverExternalPackages: ["ioredis"],
};

export default nextConfig;
