import { describe, expect, it } from "vitest";
import { adjacent, isModifiedClick, parsePeek, peekValue, withPeek } from "./url";

describe("peek URL", () => {
  it("writes a bare id for the page's own entity and entity:id otherwise", () => {
    expect(peekValue({ entity: "properties", id: "p01" }, "properties")).toBe("p01");
    expect(peekValue({ entity: "residents", id: "res-p01-0001" }, "properties")).toBe("residents:res-p01-0001");
    expect(peekValue({ entity: "residents", id: "res-1" }, null)).toBe("residents:res-1");
  });

  it("parses both forms back", () => {
    expect(parsePeek("p01", "properties")).toEqual({ entity: "properties", id: "p01" });
    expect(parsePeek("work_orders:wo-17", "properties")).toEqual({ entity: "work_orders", id: "wo-17" });
    expect(parsePeek("work_orders:wo-17", null)).toEqual({ entity: "work_orders", id: "wo-17" });
  });

  it("round-trips", () => {
    for (const t of [{ entity: "charges", id: "ch-1" }, { entity: "leases", id: "l:odd" }]) {
      expect(parsePeek(peekValue(t, "charges"), "charges")).toEqual(t);
      expect(parsePeek(peekValue(t, "units"), "units")).toEqual(t);
    }
  });

  it("rejects empty or unresolvable values", () => {
    expect(parsePeek(null, "properties")).toBeNull();
    expect(parsePeek("", "properties")).toBeNull();
    expect(parsePeek("p01", null)).toBeNull();
    expect(parsePeek("charges:", null)).toBeNull();
    // A colon after a non-entity prefix belongs to the id.
    expect(parsePeek("2026-01:x", "charges")).toEqual({ entity: "charges", id: "2026-01:x" });
  });

  it("rejects ids that would change the record API path", () => {
    for (const v of [".", "..", "units:.", "units:..", "a/b", "units:a/b", "units:../x"]) expect(parsePeek(v, "properties")).toBeNull();
  });

  it("sets and clears only peek, keeping filters, sort and page", () => {
    expect(withPeek("f.status=Open&sort=-rent&page=3", "p02")).toBe("?f.status=Open&sort=-rent&page=3&peek=p02");
    expect(withPeek("f.status=Open&peek=p02&page=3", "p03")).toBe("?f.status=Open&peek=p03&page=3");
    expect(withPeek("f.status=Open&peek=p02", null)).toBe("?f.status=Open");
    expect(withPeek("peek=p02", null)).toBe("");
  });

  it("steps through rows without wrapping", () => {
    const rows = ["a", "b", "c"];
    expect(adjacent(rows, "a", 1)).toBe("b");
    expect(adjacent(rows, "b", -1)).toBe("a");
    expect(adjacent(rows, "c", 1)).toBeNull();
    expect(adjacent(rows, "a", -1)).toBeNull();
    expect(adjacent(rows, "zz", 1)).toBe("a");
    expect(adjacent([], "a", 1)).toBeNull();
  });

  it("leaves modified and non-primary clicks to the browser", () => {
    const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(isModifiedClick(base)).toBe(false);
    expect(isModifiedClick({ ...base, metaKey: true })).toBe(true);
    expect(isModifiedClick({ ...base, ctrlKey: true })).toBe(true);
    expect(isModifiedClick({ ...base, button: 1 })).toBe(true);
    expect(isModifiedClick({ ...base, shiftKey: true })).toBe(true);
  });
});
