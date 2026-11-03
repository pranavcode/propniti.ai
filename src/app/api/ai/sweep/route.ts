import { PERMISSIONS } from "@/auth/personas";
import { guarded, json, readSession, waitUntil, writeSession } from "@/ai/http";
import { lastSweep, sweep } from "@/ai/orchestrator";
import { CRON_HEADER, cronToken } from "@/ai/sweep";
import { getPlatform } from "@/lib/platform";

// The 15-minute sweep. Called by the Cron Trigger through src/worker-entry.ts (internal request
// carrying the per-isolate cron token), or by an admin's "Sweep now" (forces a run).
export async function POST(request: Request) {
  return guarded(async () => {
    const token = request.headers.get(CRON_HEADER);
    if (token) {
      if (token !== cronToken()) return json({ error: "Bad cron token" }, { status: 403 });
      const report = await sweep(getPlatform().db, Date.now(), waitUntil);
      return json({ ok: true, report });
    }
    const w = await writeSession(request, null);
    if (w instanceof Response) return w;
    if (PERMISSIONS[w.s.actor.role].intelligence !== "approve") return json({ error: `${w.s.persona.title} can't start a sweep` }, { status: 403 });
    const report = await sweep(w.s.db, Date.now(), waitUntil, { force: true });
    return json({ ok: true, report }, { setCookie: w.s.setCookie });
  });
}

export async function GET(request: Request) {
  return guarded(async () => {
    const s = await readSession(request);
    if (s instanceof Response) return s;
    const last = await lastSweep(s.db);
    return json({ lastSweepAt: last ? new Date(last).toISOString() : null, everyMinutes: 15 });
  });
}
