import { describe, expect, it } from "vitest";
import { categoryLabel, monthTick } from "./fmt";

describe("chart labels", () => {
  it("shows months one way on every chart and dates in words", () => {
    expect(monthTick("2025-12")).toBe("Dec ’25");
    expect(monthTick("2026-10-31")).toBe("Oct ’26");
    expect(categoryLabel("2025-12")).toBe("Dec ’25");
    expect(categoryLabel("2026-11-04")).toBe("Nov 4, 2026");
    expect(categoryLabel("Austin")).toBe("Austin");
  });
});
