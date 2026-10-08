import { fileURLToPath } from "node:url";

// Phase 1B: uploaded media is referenced as same-origin `/uploads/…` (resolved at runtime by lib/runtime-config.ts and
// served by nginx, or by app/uploads/[...path]/route.ts when nginx isn't in front), so next/image needs no remote host —
// nothing installation-specific is baked into this build.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["lucide-react", "@tanstack/react-query", "framer-motion"],
  },
  // jsdom (isomorphic-dompurify's server-side implementation, used to sanitize product
  // descriptions) reads assets like its default stylesheet relative to its own module directory
  // at runtime — webpack bundling that into the server chunk breaks that lookup (ENOENT). Keeping
  // it external makes Next.js `require()` it normally from node_modules instead. Promoted from
  // experimental.serverComponentsExternalPackages (Next 14) to this stable top-level option in 15.
  serverExternalPackages: ["isomorphic-dompurify", "jsdom"],
  // The shared package's ESM source, not its CommonJS build: webpack can then drop the modules a page doesn't use
  // (Bangladesh locations, product templates, …) instead of shipping all of it to every page. The API keeps using dist/.
  transpilePackages: ["@clothing-brand/shared"],
  webpack(config) {
    config.resolve.alias["@clothing-brand/shared$"] = fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url));
    return config;
  },
  images: {
    remotePatterns: [{ protocol: "http", hostname: "localhost" }],
    // AVIF first — smaller than WebP for most product photography at equivalent quality; Next
    // falls back to WebP (then the original format) for browsers that don't support it.
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
