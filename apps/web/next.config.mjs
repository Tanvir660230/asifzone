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
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost" },
      { protocol: apiHost.protocol.replace(":", ""), hostname: apiHost.hostname },
    ],
  },
};

export default nextConfig;
