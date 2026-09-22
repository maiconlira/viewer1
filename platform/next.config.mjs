/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: { unoptimized: true },
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
};
export default nextConfig;
