import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoIsoIn, demoNow, demoNowIso } from "./clock";
import { formatDue, formatRelative } from "./format";

describe("demo clock", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps the seeded date and the real time of day (Pacific)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T22:00:00Z")); // Nov 6, 2:00 PM Pacific
    expect(demoNowIso()).toBe("2026-11-04T14:00:00Z");
    expect(demoNow().toISOString()).toBe("2026-11-04T14:00:00.000Z");
    expect(demoIsoIn(-86_400_000)).toBe("2026-11-03T14:00:00.000Z");
  });

  it("measures due dates and relative times against the demo day, not the real one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T22:00:00Z"));
    // The real clock would say "Late by 3 days" and "Late by 1 day".
    expect(formatDue("2026-11-03")).toEqual({ text: "Late by 1 day", late: true, soon: false });
    expect(formatDue("2026-11-05").text).toBe("Due in 1 day");
    expect(formatRelative("2026-11-04T12:00:00Z")).toBe("2h ago");
  });
});

// Real time is only for timeouts, rate limits, latency, cron claims, settle timers, ids and
// browser-local bookkeeping. Anything else must use the demo clock (src/lib/clock.ts).
const REAL_CLOCK_OK = new Set([
  "src/lib/clock.ts", // the demo clock itself reads the real time of day
  "src/lib/format.ts", // greetings: time of day only
  "src/lib/guard.ts", // rate limiting
  "src/app/(app)/app/leasing/today/page.tsx", // greeting: time of day only
  "src/app/(portal)/portal/resident/page.tsx", // greeting: time of day only
  "src/app/api/ai/sweep/route.ts", // cron trigger
  "src/app/api/ai/events/route.ts", // request clock, converted where stamped
  "src/app/api/ai/runs/[id]/stream/route.ts", // stream deadline
  "src/app/api/e/_lib/http.ts", // request clock, converted with nowIso where stamped
  "src/app/api/e/[entity]/export.csv/route.ts", // download file name
  "src/server/permissions.ts", // ACH settle timer
  "src/extensions/receivables/queries.ts", // ACH settle timer, cache TTL
  "src/extensions/platform/console.ts", // platform health check time
  "src/extensions/leasing/ai.ts", // model timeout
  "src/ai/agents/data-health.ts", // rule-check time box
  "src/extensions/residents/ai.ts", // run deadline, latency
  "src/extensions/risk/timeline.ts", // as_of fallback (risk lane)
  "src/components/public/writes.ts", // request clock
  "src/components/app/recent.ts", // recents order (browser only)
  "src/components/app/record/NotesPanel.tsx", // temporary id
  "src/components/app/record/TasksPanel.tsx", // temporary id
  "src/components/app/shell/AppShell.tsx", // request id
  "src/components/app/tour/TourEngine.tsx", // tour progress bookkeeping
  "src/components/app/data-table/views.ts", // saved view id
  "src/ai/session.ts", // request clock
  "src/ai/sweep.ts", // cron throttle
  "src/ai/views.ts", // request clock, converted for stamps and schedules
  "src/ai/orchestrator.ts", // deadlines, cron claims
  "src/ai/runtime.ts", // deadlines, latency
  "src/ai/assistant.ts", // run clock, converted where stamped
  "src/ai/datafix.ts", // run clock
  "src/ai/effects.ts", // action clock, converted where stamped
  "src/ai/providers/anthropic.ts", // latency
  "src/ai/providers/openai.ts", // latency
  "src/ai/providers/workers.ts", // latency
  "src/ai/__tests__/fixture.ts", // test fixture
]);

function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield p;
  }
}

describe("real clock use", () => {
  it("is limited to the allow-list", () => {
    const root = join(__dirname, "..", "..");
    const offenders = [...sources(join(root, "src"))]
      .map((p) => relative(root, p))
      .filter((p) => !REAL_CLOCK_OK.has(p) && /Date\.now\(\)|new Date\(\s*\)/.test(readFileSync(join(root, p), "utf8")));
    expect(offenders, "Use demoNow()/demoNowIso() from src/lib/clock.ts for anything compared with data or shown to people").toEqual([]);
  });
});
