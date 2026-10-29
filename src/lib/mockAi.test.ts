import { describe, expect, it } from "vitest";
import { mockAsk, mockValidate } from "./mockAi";
import { seed } from "./seed";
import type { WorkOrder } from "./types";

const byId = (id: string) => seed().workOrders.find((w) => w.id === id)!;

describe("mockValidate", () => {
  it("approves an invoice that matches the PO line by line with all photos", () => {
    const r = mockValidate(byId("WO-1041"));
    expect(r.decision).toBe("approve");
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    expect(r.issues).toEqual([]);
  });

  it("flags over-PO totals, changed prices, extra items and missing photos", () => {
    const r = mockValidate(byId("WO-1042"));
    expect(r.decision).toBe("review");
    expect(r.confidence).toBeLessThan(0.6);
    expect(r.issues.join("\n")).toMatch(/\$275 \(92%\) over PO/);
    expect(r.issues.join("\n")).toMatch(/Labor, 4 h @ \$90: \$360 billed vs \$180/);
    expect(r.issues.join("\n")).toMatch(/Not on PO: After-hours call-out fee/);
    expect(r.issues.join("\n")).toMatch(/Only 1 of 2 required photos/);
  });

  it("treats totals within 2% of the PO as a match", () => {
    const wo: WorkOrder = {
      ...byId("WO-1041"),
      submission: { ...byId("WO-1041").submission!, total: 645 }, // +1.6%
    };
    expect(mockValidate(wo).issues.some((i) => i.includes("over PO"))).toBe(false);
  });

  it("never approves an invoice with no lines, negative amounts or a total that doesn't add up", () => {
    const base = byId("WO-1041");
    const noLines = mockValidate({ ...base, submission: { ...base.submission!, items: [] } });
    expect(noLines.decision).toBe("review");
    expect(noLines.issues.join()).toMatch(/no line items/);
    const negative = mockValidate({ ...base, submission: { ...base.submission!, total: -635 } });
    expect(negative.decision).toBe("review");
    expect(negative.issues.join()).toMatch(/negative/);
    const badSum = mockValidate({ ...base, submission: { ...base.submission!, items: [base.submission!.items[0]], total: 635 } });
    expect(badSum.issues.join()).toMatch(/add up to \$380/);
    expect(badSum.issues.join()).toMatch(/PO item not on invoice: Labor/);
  });

  it("compares line groups one-to-one and requires the lines to add up to the cent", () => {
    const base = byId("WO-1041");
    // One "Labor" line can't cover two PO labor lines.
    const wo = { ...base, po: { ...base.po, items: [{ description: "Labor, day 1", amount: 300 }, { description: "Labor, day 2", amount: 335 }], total: 635 } };
    const r = mockValidate({ ...wo, submission: { ...base.submission!, items: [{ description: "Labor, both days", amount: 300 }, { description: "Motor", amount: 335 }], total: 635 } });
    expect(r.decision).toBe("review");
    const cents = mockValidate({ ...base, submission: { ...base.submission!, total: 629 } });
    expect(cents.issues.join()).toMatch(/add up to \$635, not the stated total \$629/);
  });

  it("asks for review when nothing has been submitted", () => {
    const r = mockValidate(byId("WO-1043"));
    expect(r.decision).toBe("review");
    expect(r.issues).toEqual(["No invoice submitted yet"]);
  });
});

describe("mockAsk", () => {
  it("lists overdue tenants", () => {
    const r = mockAsk("Who is late on rent?", seed());
    expect(r.answer).toContain("Marcus Lee");
    expect(r.answer).toContain("Aisha Khan");
  });

  it("lists leases up for renewal", () => {
    expect(mockAsk("which leases are up for renewal?", seed()).answer).toContain("Jasmine Brooks");
  });

  it("survives an empty portfolio and dangling references", () => {
    const empty = { ...seed(), properties: [], tenancies: [] };
    expect(mockAsk("hello", empty).answer).toContain("(0%)");
    expect(() => mockAsk("who is late?", empty)).not.toThrow();
  });
});
