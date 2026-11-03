import { describe, expect, it } from "vitest";
import { classify, threshold1099 } from "./tax";

describe("1099 threshold detection", () => {
  it("uses $600 through 2025 and $2,000 from 2026", () => {
    expect(threshold1099(2025)).toBe(600);
    expect(threshold1099(2026)).toBe(2000);
  });

  it("classifies payments against the year's threshold", () => {
    expect(classify(600, 2025)).toBe("Reportable");
    expect(classify(599.99, 2025)).toBe("Near threshold");
    expect(classify(400, 2025)).toBe("Below threshold");
    expect(classify(1800, 2026)).toBe("Near threshold");
    expect(classify(2000, 2026)).toBe("Reportable");
  });
});
