/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // garante que os regulamentos acompanhem as funções serverless na Vercel
    outputFileTracingIncludes: {
      "/api/analisar": ["./public/regulamentos/**"],
      "/api/perguntar": ["./public/regulamentos/**"],
    },
  },
};

export default nextConfig;
