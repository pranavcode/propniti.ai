import { describe, expect, it } from "vitest";
import { fillTemplate, paramsToView, readRange, readSort, readValues, viewToParams } from "./params";

describe("list URL params", () => {
  it("reads values, ranges and sort", () => {
    const sp = new URLSearchParams("f.status=Vacant,Notice&f.rent.min=1000&sort=-rent");
    expect(readValues(sp, "status")).toEqual(["Vacant", "Notice"]);
    expect(readValues(sp, "metro")).toEqual([]);
    expect(readRange(sp, "rent")).toEqual({ min: "1000", max: undefined });
    expect(readSort(sp)).toEqual(["rent", "desc"]);
  });

  it("round-trips a saved view through the URL, keeping unrelated params", () => {
    const state = { q: "lofts", filters: { status: ["Vacant", "Down"], "rent.max": "2000" }, sort: ["name", "asc"] as [string, "asc"], columns: ["name", "rent"] };
    const sp = viewToParams(new URLSearchParams("tab=units&f.old=x&page=4"), state, "v1");
    expect(sp.toString()).toBe("tab=units&q=lofts&f.status=Vacant%2CDown&f.rent.max=2000&sort=name&cols=name%2Crent&view=v1");
    expect(paramsToView(sp)).toEqual(state);
  });

  it("fills href templates", () => {
    expect(fillTemplate("/app/properties/{property_id}?tab=units", { property_id: "p 01" })).toBe("/app/properties/p%2001?tab=units");
  });
});
