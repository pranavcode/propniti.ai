import { describe, expect, it } from "vitest";
import { listScope, resultsSummary } from "./results";
import type { Facet } from "./data-table/types";

const issues = { one: "open issue", many: "open issues" };

describe("results summary", () => {
  it("states the count, the noun and the scope", () => {
    expect(resultsSummary(64, issues, "in Accounting")).toBe("Showing 64 open issues in Accounting");
    expect(resultsSummary(1, issues, "in Accounting")).toBe("Showing 1 open issue in Accounting");
    expect(resultsSummary(1699, issues)).toBe("Showing 1,699 open issues");
    expect(resultsSummary(0, issues, "in Owners")).toBe("No open issues in Owners");
  });

  it("names list filters by their labels", () => {
    const facets: Facet[] = [
      { key: "status", label: "Status", kind: "enum", options: [{ value: "active", label: "Active" }, { value: "notice", label: "On notice" }] },
      { key: "property_id", label: "Property", kind: "ref", options: [{ value: "p01", label: "Preston Hollow Plaza" }] },
      { key: "rent", label: "Rent", kind: "money" },
      { key: "end_date", label: "Ends", kind: "date" },
    ];
    const sp = new URLSearchParams("f.status=notice,active&f.property_id=p01&f.rent.min=1000&f.rent.max=2000&f.end_date.max=2026-12-31&q=oak&page=2");
    expect(listScope(sp, facets)).toBe("matching Status: On notice +1, Property: Preston Hollow Plaza, Rent 1000–2000, Ends up to 2026-12-31, “oak”");
    expect(listScope(new URLSearchParams("page=2&sort=-rent"), facets)).toBeUndefined();
  });

  it("covers a status tab field that has no facet chip", () => {
    const sp = new URLSearchParams("f.stage=Tour");
    expect(listScope(sp, [], { field: "stage", options: [{ value: "Tour", label: "Toured", tone: "info" }] })).toBe("matching Status: Toured");
  });
});
