import type { NextConfig } from "next";

// Inline scripts/styles are needed by Next/vinext hydration and Tailwind; everything else is same-origin.
// Google Fonts hosts are allowed because next/font falls back to them if self-hosting fails;
// Cloudflare Web Analytics is injected by the zone on propniti.ai.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Self-contained Node server for the Docker image (set in Dockerfile). Off for the
  // Cloudflare (vinext) build, where it would emit a Node server instead of a Worker.
  output: process.env.NEXT_STANDALONE ? "standalone" : undefined,
  poweredByHeader: false,
  async headers() {
    return process.env.NODE_ENV === "production" ? [{ source: "/:path*", headers: securityHeaders }] : [];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
