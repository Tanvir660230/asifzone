/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost" },
      { protocol: "https", hostname: process.env.NEXT_PUBLIC_ASSET_HOST ?? "localhost" },
    ],
  },
};

export default nextConfig;
