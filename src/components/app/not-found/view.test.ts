import { describe, expect, it } from "vitest";
import { notFoundView } from "./view";

const LISTS = ["/app/properties", "/app/maintenance/work-orders"];

describe("notFoundView", () => {
  it("treats a path under a list as a record and links back to that list", () => {
    expect(notFoundView("/app/properties/p10", LISTS)).toEqual({ record: true, list: "/app/properties" });
    expect(notFoundView("/app/maintenance/work-orders/WO-1/", LISTS)).toEqual({ record: true, list: "/app/maintenance/work-orders" });
  });

  it("treats any other path as a page, with no list link", () => {
    expect(notFoundView("/app/nope", LISTS)).toEqual({ record: false, list: null });
    expect(notFoundView("/app/nope/deeper", LISTS)).toEqual({ record: false, list: null });
    expect(notFoundView("/app/properties", LISTS)).toEqual({ record: false, list: null });
  });
});
