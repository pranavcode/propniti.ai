import { describe, expect, it } from "vitest";
import { formatDate } from "@/lib/format";
import { SAMPLE_INVOICES } from "./samples";

describe("sample invoices", () => {
  it("store invoice and due dates month first as printed (Lone Star: 11/02/2026, due 12/02/2026 Net 30)", () => {
    const lsp = SAMPLE_INVOICES.find((s) => s.key === "lsp-31208")!.extracted;
    expect([lsp.invoice_date, lsp.due_date]).toEqual(["2026-11-02", "2026-12-02"]);
    expect([formatDate(lsp.invoice_date, "always"), formatDate(lsp.due_date, "always")]).toEqual(["Nov 2, 2026", "Dec 2, 2026"]);
    for (const { extracted: e } of SAMPLE_INVOICES) {
      const days = (Date.parse(e.due_date) - Date.parse(e.invoice_date)) / 86_400_000;
      expect(days, e.invoice_number).toBeGreaterThanOrEqual(14);
      expect(days, e.invoice_number).toBeLessThanOrEqual(31);
    }
  });
});
