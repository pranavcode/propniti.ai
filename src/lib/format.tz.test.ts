import { afterAll, describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatDue, formatFull, formatMonth, formatRelative } from "./format";

// Relative dates read the same in every viewer's time zone. The demo clock is demo wall time
// written as UTC (clock.ts): 20:30Z is 8:30 PM on Nov 4 in the demo, though it is already Nov 5
// in Kolkata; 00:30Z is just after midnight on Nov 4, though still Nov 3 in Los Angeles.
const original = process.env.TZ;
afterAll(() => { process.env.TZ = original; });

describe.each(["Asia/Kolkata", "America/Los_Angeles", "UTC"])("relative dates with the browser in %s", (tz) => {
  for (const now of [new Date("2026-11-04T20:30:00Z"), new Date("2026-11-04T00:30:00Z")]) {
    it(`counts days from the demo date at ${now.toISOString().slice(11, 16)} demo time`, () => {
      process.env.TZ = tz;
      expect(formatDue("2026-11-04", now)).toEqual({ text: "Due today", late: false, soon: true });
      expect(formatDue("2026-11-05", now).text).toBe("Due in 1 day");
      expect(formatDue("2026-11-03", now).text).toBe("Late by 1 day");
      expect(formatRelative("2026-11-03T09:00:00Z", now)).toBe("yesterday");
      expect(formatRelative("2026-11-05T09:00:00Z", now)).toBe("tomorrow");
      expect(formatRelative("2026-11-01T12:00:00Z", now)).toBe("3 days ago");
      expect(formatRelative("2026-11-06", now)).toBe("in 2 days");
    });

    it(`shows dates and tooltips on the demo date at ${now.toISOString().slice(11, 16)} demo time`, () => {
      process.env.TZ = tz;
      expect(formatDate("2026-11-04", "auto", now)).toBe("Nov 4");
      expect(formatDate("2025-12-31T23:30:00Z", "auto", now)).toBe("Dec 31, 2025");
      expect(formatMonth("2026-11-01")).toBe("Nov 2026");
      expect(formatDateTime("2026-11-04T20:30:00Z")).toBe("Nov 4, 8:30 PM");
      expect(formatFull("2026-11-04T20:30:00Z")).toBe("Wed, Nov 4, 2026, 8:30 PM");
      expect(formatFull("2026-11-04")).toBe("Wed, Nov 4, 2026, 12:00 AM");
    });
  }
});
