import { env } from "cloudflare:workers";
import type { Db, Platform, RateLimiter, WorkersAI } from "./types";

// Bindings declared in cloudflare.config.ts.
export function getPlatform(): Platform {
  const e = env as unknown as { AI?: WorkersAI; AI_RATE_LIMITER?: RateLimiter; WRITE_RATE_LIMITER?: RateLimiter; DB: Db };
  return { ai: e.AI, limiter: e.AI_RATE_LIMITER, writeLimiter: e.WRITE_RATE_LIMITER, db: e.DB };
}
