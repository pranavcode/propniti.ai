// Runtime services that exist only on some hosts. This default (Node.js / Docker)
// version has none; the Cloudflare build swaps in ./workers.ts via vite.config.ts.
import type { Platform } from "./types";

export function getPlatform(): Platform {
  return {};
}
