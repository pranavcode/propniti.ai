import { describe, expect, it } from "vitest";
import { decodeRange, encodeRange, fillTemplate, parseList, toSearchParams } from "./params";

describe("list URL params", () => {
  it("parses filters, ranges, sort and paging", () => {
    const q = parseList(new URLSearchParams("q=larkin&f.status=Vacant|Notice&f.rent=1000..2000&sort=-rent&page=3&size=100&view=mine"));
    expect(q).toEqual({ q: "larkin", filters: { status: ["Vacant", "Notice"], rent: "1000..2000" }, sort: ["rent", "desc"], page: 3, size: 100, view: "mine" });
  });

  it("clamps size and page and accepts a plain record", () => {
    const q = parseList({ size: "5000", page: "-2", "f.metro": ["Austin"] });
    expect(q.size).toBe(200);
    expect(q.page).toBe(1);
    expect(q.filters).toEqual({ metro: ["Austin"] });
  });

  it("round-trips through toSearchParams", () => {
    const sp = toSearchParams({ q: "a", filters: { status: ["Vacant", "Down"], due_on: "2026-01-01.." }, sort: ["name", "asc"], page: 2, size: 25 });
    expect(sp.toString()).toBe("q=a&f.status=Vacant%7CDown&f.due_on=2026-01-01..&sort=name&page=2&size=25");
    expect(parseList(sp).filters).toEqual({ status: ["Vacant", "Down"], due_on: "2026-01-01.." });
  });

  it("encodes ranges and fills href templates", () => {
    expect(encodeRange({ max: "500" })).toBe("..500");
    expect(decodeRange("..500")).toEqual({ min: undefined, max: "500" });
    expect(fillTemplate("/app/properties/{property_id}?tab=units", { property_id: "p 01" })).toBe("/app/properties/p%2001?tab=units");
  });
});
