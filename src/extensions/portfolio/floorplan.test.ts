import { describe, expect, it } from "vitest";
import { feet, planLayout } from "./floorplan";

const inside = (p: ReturnType<typeof planLayout>) => p.rooms.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= p.width + 0.2 && r.y + r.h <= p.height + 0.2 && r.w > 0 && r.h > 0);
const area = (p: ReturnType<typeof planLayout>) => p.rooms.reduce((s, r) => s + r.w * r.h, 0);

describe("planLayout", () => {
  it.each([
    [0, 1, 540],
    [1, 1, 710],
    [2, 2, 1090],
    [3, 2.5, 1360],
    [4, 3, 1900],
  ])("%i bed / %f bath / %i sq ft has one room per bedroom and bath, inside the outline", (beds, baths, sqft) => {
    const p = planLayout({ beds, baths, sqft });
    expect(p.rooms.filter((r) => r.kind === "bed")).toHaveLength(beds);
    expect(p.rooms.filter((r) => r.kind === "bath")).toHaveLength(Math.ceil(baths));
    expect(p.rooms.some((r) => r.kind === "living")).toBe(true);
    expect(p.rooms.some((r) => r.kind === "kitchen")).toBe(true);
    expect(inside(p)).toBe(true);
    expect(Math.abs(area(p) - p.width * p.height) / (p.width * p.height)).toBeLessThan(0.02);
    expect(Math.abs(p.width * p.height - sqft) / sqft).toBeLessThan(0.02);
  });

  it("lays out commercial suites without bedrooms", () => {
    const p = planLayout({ beds: 0, baths: 1, sqft: 2400 });
    expect(p.rooms.map((r) => r.kind)).toEqual(["open", "office", "bath", "storage"]);
    expect(inside(p)).toBe(true);
  });

  it("is deterministic", () => {
    expect(planLayout({ beds: 2, baths: 2, sqft: 1090 })).toEqual(planLayout({ beds: 2, baths: 2, sqft: 1090 }));
  });

  it("formats feet and inches", () => {
    expect(feet(12.5)).toBe("12'6\"");
    expect(feet(9.99)).toBe("10'0\"");
  });
});
