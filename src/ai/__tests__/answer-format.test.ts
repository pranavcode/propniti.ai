import { describe, expect, it } from "vitest";
import type { NoiExplanation } from "../facts";
import { explainText, money, monthName, total } from "../rules";

describe("rules answer wording", () => {
  it("writes months in words, negatives with a leading minus and totals in whole dollars like the KPI tiles", () => {
    expect(monthName("2026-10")).toBe("Oct 2026");
    expect(money(-637986)).toBe("−$6,379.86");
    expect(money(112750)).toBe("$1,127.50");
    expect(total(585569554)).toBe("$5,855,696");
    expect(total(-637986)).toBe("−$6,380");
    expect(total(-4050)).toBe("−$40.50");
    const x = {
      month: "2026-10", noi_cents: 585569554, prior_noi_cents: 573543650, change_pct: 2.1,
      drivers: [{ label: "Operating expenses", delta_cents: 8914493 }], by_property: [{ property_id: "p30", property: "Decatur Square Townhomes", change_cents: -637986 }], expense_lines: [],
    } as unknown as NoiExplanation;
    expect(explainText(x)).toBe("NOI rose 2.1% in Oct 2026, from $5,735,437 to $5,855,696. Operating expenses raised NOI by $89,145. Decatur Square Townhomes moved most (−$6,380).");
  });
});
