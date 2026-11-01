import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Self-contained server in .next/standalone; the Electron app ships it. `next start` and `next dev` are unaffected.
  output: "standalone",
  // Keep the shipped server small: README media, tests and the image optimizer (next/image is not used) stay out.
  outputFileTracingExcludes: {
    "*": [
      "docs/**",
      "e2e/**",
      "e2e-desktop/**",
      "electron/**",
      "dist-desktop/**",
      "scripts/**",
      "package-lock.json",
      "tsconfig.json",
      "node_modules/sharp/**",
      "node_modules/@img/**",
    ],
  },
  images: { unoptimized: true },
  experimental: {
    // src/proxy.ts makes Next.js buffer request bodies, by default only up to 10 MB, which cuts off
    // lecture uploads. The route handler reads the whole upload into memory anyway.
    proxyClientMaxBodySize: "4gb",
  },
};

export default nextConfig;
