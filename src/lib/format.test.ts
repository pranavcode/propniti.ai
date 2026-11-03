import { describe, expect, it } from "vitest";
import { formatDate, formatDelta, formatDue, formatMoney, formatNumber, formatPct, formatRelative, initials } from "./format";

const now = new Date("2026-11-04T12:00:00");

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
    expect(formatRelative("2026-11-04T11:55:00", now)).toBe("5m ago");
    expect(formatRelative("2026-11-03T09:00:00", now)).toBe("yesterday");
    expect(formatRelative("2026-11-01T09:00:00", now)).toBe("3 days ago");
    expect(formatDue("2026-11-02", now)).toEqual({ text: "Late by 2 days", late: true, soon: false });
    expect(formatDue("2026-11-04", now).text).toBe("Due today");
  });

  it("makes initials", () => {
    expect(initials("Marcus Bell")).toBe("MB");
    expect(initials("Zoë Ødegaard")).toBe("ZØ");
  });
});
