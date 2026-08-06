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
      { protocol: "https", hostname: process.env.NEXT_PUBLIC_ASSET_HOST ?? "localhost" },
    ],
  },
};

export default nextConfig;
