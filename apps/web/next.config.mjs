// Uploaded banner/category/logo/editor images are always served from the same origin the API
// itself answers on (see apps/api/src/modules/uploads/upload.service.ts's processSiteImage), so
// next/image just needs that origin whitelisted — derived from NEXT_PUBLIC_API_URL rather than a
// separate env var, so it can never drift out of sync with wherever the API actually is.
const apiHost = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000");

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
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost" },
      { protocol: apiHost.protocol.replace(":", ""), hostname: apiHost.hostname },
    ],
    // AVIF first — smaller than WebP for most product photography at equivalent quality; Next
    // falls back to WebP (then the original format) for browsers that don't support it.
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
