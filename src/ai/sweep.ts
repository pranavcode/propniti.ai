import type { Db } from "@/lib/platform/types";
import { lastSweep, reapStaleRuns, sweep, SWEEP_EVERY_MS, VISIT_GRACE_MS } from "./orchestrator";

// "Run on visit": if the Cron Trigger hasn't swept in 17 minutes (local dev, or cron not wired),
// the first AI page or API request after that starts a sweep in the background. It claims the
// visit slot atomically (see claimSweep), so two visits never both run, a visit never makes the
// next cron tick skip, and a tick that is on time always gets the slot first.
let checkedAt = 0;
export function maybeSweep(db: Db, waitUntil: (p: Promise<unknown>) => void, nowMs = Date.now()) {
  if (nowMs - checkedAt < 60_000) return;
  checkedAt = nowMs;
  waitUntil(
    (async () => {
      await reapStaleRuns(db, nowMs);
      const last = await lastSweep(db);
      if (last && nowMs - last < SWEEP_EVERY_MS + VISIT_GRACE_MS) return;
      // Visits only get ctx.waitUntil's 30 seconds after the response (and the sweep's own reads
      // come first); the cron gets minutes.
      await sweep(db, nowMs, waitUntil, { deadlineMs: 15_000 });
    })().catch((err) => console.error("[ai] sweep on visit failed:", err)),
  );
}

// The worker entry (src/worker-entry.ts) sets this per isolate and sends it with the cron's
// internal request to /api/ai/sweep, so only the scheduled handler can trigger that path.
export const CRON_HEADER = "x-pn-cron";
export const cronToken = () => (globalThis as { __pnCronToken?: string }).__pnCronToken;

// Constant-time comparison of the cron token (SHA-256 both sides so length doesn't leak).
export async function cronTokenOk(given: string) {
  const want = cronToken();
  if (!want) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(given)), crypto.subtle.digest("SHA-256", enc.encode(want))]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
