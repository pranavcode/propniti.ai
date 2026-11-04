import { DEMO_RESET_TZ } from "@/lib/seed";
import { AS_OF } from "@/seed/constants";

// The demo clock, shared by server and browser. The seeded data is frozen at AS_OF, so "now" is
// AS_OF plus the real time of day in DEMO_RESET_TZ, written as UTC. Seeded past events on AS_OF
// sit before 08:00Z (midnight Pacific), and overlays reset at that same midnight, so the clock
// never runs behind the data. Use real time (Date.now) only for timeouts, rate limits, latency,
// cron claims and ACH settle timers; everything compared with data or shown to people uses this.

// Wall-clock time of `ms` in `tz`, expressed as a UTC timestamp.
export function wallClock(ms: number, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
      .formatToParts(ms)
      .map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

export const demoNowIso = (realMs: number = Date.now()) => `${AS_OF}T${new Date(wallClock(realMs, DEMO_RESET_TZ)).toISOString().slice(11, 19)}Z`;
export const demoNow = (realMs: number = Date.now()) => new Date(demoNowIso(realMs));
// The demo instant `offsetMs` from now, as ISO (e.g. an SLA due in 4 hours, a 24-hour window).
export const demoIsoIn = (offsetMs: number, realMs: number = Date.now()) => new Date(demoNow(realMs).getTime() + offsetMs).toISOString();
