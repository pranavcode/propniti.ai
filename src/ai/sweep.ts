import type { Db } from "@/lib/platform/types";
import { lastSweep, sweep, SWEEP_EVERY_MS } from "./orchestrator";

// "Run on visit": if the Cron Trigger hasn't swept in 15 minutes (local dev, or cron not wired),
// the first AI page or API request after that starts a sweep in the background. The sweep claims
// its slot atomically, so this and the cron never both run it.
let checkedAt = 0;
export function maybeSweep(db: Db, waitUntil: (p: Promise<unknown>) => void, nowMs = Date.now()) {
  if (nowMs - checkedAt < 60_000) return;
  checkedAt = nowMs;
  waitUntil(
    (async () => {
      const last = await lastSweep(db);
      if (last && nowMs - last < SWEEP_EVERY_MS) return;
      await sweep(db, nowMs, waitUntil);
    })().catch((err) => console.error("[ai] sweep on visit failed:", err)),
  );
}

// The worker entry (src/worker-entry.ts) sets this per isolate and sends it with the cron's
// internal request to /api/ai/sweep, so only the scheduled handler can trigger that path.
export const CRON_HEADER = "x-pn-cron";
export const cronToken = () => (globalThis as { __pnCronToken?: string }).__pnCronToken;
