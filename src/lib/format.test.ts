import { describe, expect, it } from "vitest";
import { formatDate, formatDelta, formatDue, formatMoney, formatNumber, formatPct, formatRelative, greeting, initials, personaGreeting, personaTimeZone } from "./format";

const now = new Date("2026-11-04T12:00:00Z");

describe("format", () => {
  it("formats money in every style", () => {
    expect(formatMoney(12450)).toBe("$12,450.00");
    expect(formatMoney(-1240)).toBe("−$1,240.00");
    expect(formatMoney(-1240, "accounting")).toBe("($1,240.00)");
    expect(formatMoney(1_240_000, "compact")).toBe("$1.24M");
    expect(formatMoney(8400, "compact")).toBe("$8,400");
    expect(formatMoney(null)).toBe("—");
  });

  it("formats numbers, percents and deltas", () => {
    expect(formatNumber(3312)).toBe("3,312");
    expect(formatNumber(48_200, { compact: true })).toBe("48.2K");
    expect(formatPct(0.953)).toBe("95.3%");
    expect(formatPct(95)).toBe("95%");
    expect(formatDelta(105, 100)).toBe("+5%");
    expect(formatDelta(97, 100)).toBe("−3%");
    expect(formatDelta(5, 0)).toBeNull();
  });

  it("formats dates relative to now", () => {
    expect(formatDate("2026-11-04", "auto", now)).toBe("Nov 4");
    expect(formatDate("2025-03-09", "auto", now)).toBe("Mar 9, 2025");
    expect(formatRelative("2026-11-04T11:55:00Z", now)).toBe("5m ago");
    expect(formatRelative("2026-11-03T09:00:00Z", now)).toBe("yesterday");
    expect(formatRelative("2026-11-01T09:00:00Z", now)).toBe("3 days ago");
    // A stamp a little ahead of "now" (another machine's clock) is still "just now", never "in 1m".
    expect(formatRelative("2026-11-04T12:01:30Z", now)).toBe("just now");
    expect(formatRelative("2026-11-04T12:30:00Z", now)).toBe("in 30m");
    expect(formatDue("2026-11-02", now)).toEqual({ text: "Late by 2 days", late: true, soon: false });
    expect(formatDue("2026-11-04", now).text).toBe("Due today");
  });

  it("makes initials", () => {
    expect(initials("Marcus Bell")).toBe("MB");
    expect(initials("Zoë Ødegaard")).toBe("ZØ");
  });

  it("greets in the persona's metro time zone, not the server's", () => {
    const t = new Date("2026-11-04T21:45:00Z"); // 3:45 pm Central, 4:45 pm Eastern, 2:45 pm Phoenix
    expect(personaGreeting({ name: "Marcus Bell", scope: { label: "3 Austin properties" } }, t)).toBe("Good afternoon, Marcus");
    expect(personaGreeting({ name: "Priya Shah", scope: { label: "Texas · 14 properties" } }, t)).toBe("Good afternoon, Priya");
    expect(personaTimeZone({ scope: { label: "All 30 properties · 4 metros" } })).toBe("America/Chicago");
    expect(personaTimeZone({ scope: { label: "Own lease" }, title: "Applicant · Peachtree Lofts, Atlanta" })).toBe("America/New_York");
    expect(greeting("Daniel Reyes", "America/Chicago", new Date("2026-11-04T14:30:00Z"))).toBe("Good morning, Daniel");
    expect(greeting("Daniel Reyes", "America/Phoenix", new Date("2026-11-05T01:30:00Z"))).toBe("Good evening, Daniel");
  });
});
