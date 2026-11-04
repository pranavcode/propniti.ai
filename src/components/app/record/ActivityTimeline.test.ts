import { describe, expect, it } from "vitest";
import { formatChange } from "./ActivityTimeline";

describe("activity change values", () => {
  it("reads nested values instead of printing [object Object]", () => {
    expect(formatChange({ subject: "Payment plan offer", body: "Hi Brianna" })).toBe("Payment plan offer");
    expect(formatChange({ body: "Hi Brianna, we can split your balance into three payments." })).toBe("Hi Brianna, we can split your balance into three payments.");
    expect(formatChange([{ kind: "message" }, { kind: "task" }])).toBe("2 items");
    expect(formatChange([{ kind: "message" }])).toBe("1 item");
    expect(formatChange({ a: 1, b: 2 })).toBe("2 fields");
    expect(formatChange({ body: "y".repeat(100) })).toBe(`${"y".repeat(79)}…`);
  });

  it("keeps scalars as before", () => {
    expect(formatChange(null)).toBe("empty");
    expect(formatChange("")).toBe("empty");
    expect(formatChange(1500)).toBe("1,500");
    expect(formatChange("SMS")).toBe("SMS");
  });
});
