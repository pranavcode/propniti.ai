import { describe, expect, it } from "vitest";
import { fieldRows, hintsFor, humanizeKey, readableText, valueText } from "./fieldText";

describe("fieldText", () => {
  it("turns stored keys into labels", () => {
    expect(humanizeKey("term_months")).toBe("Term months");
    expect(humanizeKey("rent_cents")).toBe("Rent");
    expect(humanizeKey("due_on")).toBe("Due");
    expect(humanizeKey("invoice_number")).toBe("Invoice number");
  });

  it("formats cents, dollars, dates and booleans for people", () => {
    expect(valueText("rent_cents", 267000)).toBe("$2,670.00");
    expect(valueText("total", 3660)).toBe("$3,660.00");
    expect(valueText("start_on", "2026-11-26")).toBe("Nov 26, 2026");
    expect(valueText("changed_at", "2026-10-29T16:20:00Z")).toMatch(/^Oct 29, 2026, \d+:\d\d [AP]M$/);
    expect(valueText("w9_on_file", 0, { label: "W-9 on file", type: "bool" })).toBe("No");
    expect(valueText("term_months", 12)).toBe("12");
    expect(valueText("x", null)).toBeNull();
  });

  it("labels extracted fields from the record's def and formats each value", () => {
    const hints = hintsFor({ fields: { rent: { type: "money", label: "Monthly rent", column: "rent_cents" }, start_on: { type: "date", label: "Lease starts" } } });
    expect(fieldRows({ rent_cents: 217000, deposit_cents: 162500, start_on: "2026-11-26", term_months: 12 }, hints)).toEqual([
      { key: "rent_cents", label: "Monthly rent", text: "$2,170.00" },
      { key: "deposit_cents", label: "Deposit", text: "$1,625.00" },
      { key: "start_on", label: "Lease starts", text: "Nov 26, 2026" },
      { key: "term_months", label: "Term months", text: "12" },
    ]);
  });

  it("summarises lists of line items", () => {
    expect(fieldRows({ lines: [{ description: "Landscaping", amount: 3660 }], columns: ["unit", "rent"] })).toEqual([
      { key: "lines", label: "Lines", text: "Landscaping · $3,660.00" },
      { key: "columns", label: "Columns", text: "unit, rent" },
    ]);
  });

  it("rewrites ISO dates, bare amounts and snake_case words in rule text", () => {
    expect(readableText("Fire alarm test was due 2026-10-01")).toBe("Fire alarm test was due Oct 1, 2026");
    expect(readableText("Closest batch: Deposit 2026-10-11 for 9270.58")).toBe("Closest batch: Deposit Oct 11, 2026 for $9,270.58");
    expect(readableText("Swapping them gives a 12-month term, matching term_months")).toBe("Swapping them gives a 12-month term, matching term months");
    expect(readableText("Same vendor and invoice number as BILL-29723")).toBe("Same vendor and invoice number as BILL-29723");
  });
});
