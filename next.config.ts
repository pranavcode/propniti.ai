import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained Node server for the Docker image (set in Dockerfile). Off for the
  // Cloudflare (vinext) build, where it would emit a Node server instead of a Worker.
  output: process.env.NEXT_STANDALONE ? "standalone" : undefined,
  /* config options here */
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
