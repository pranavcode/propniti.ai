import { describe, expect, it } from "vitest";
import { ageBucket, checkPhoto, nextDue, policyCheck, upcoming, validateInvoice, vendorScore } from "./rules";

const po = { total_cents: 23500, lines: [{ description: "Labor: Kitchen sink leaking", amount_cents: 14100 }, { description: "Parts and materials", amount_cents: 9400 }] };

describe("validateInvoice", () => {
  it("approves an invoice that matches the PO by line group and total", () => {
    const v = validateInvoice(po, { total_cents: 23400, lines: [{ description: "Labor", amount_cents: 14000 }, { description: "Parts", amount_cents: 9400 }], photos: 1 });
    expect(v.decision).toBe("approve");
    expect(v.confidence).toBe(0.97);
    expect(v.issues).toEqual([]);
  });

  it("flags lines over the PO, lines not on it, bad sums and missing photos", () => {
    const v = validateInvoice(po, { total_cents: 40000, lines: [{ description: "Labor, 6 h", amount_cents: 20000 }, { description: "Trip charge", amount_cents: 9000 }, { description: "Parts", amount_cents: 9400 }], photos: 0 });
    expect(v.decision).toBe("review");
    expect(v.issues.join("\n")).toMatch(/over PO total/);
    expect(v.issues.join("\n")).toMatch(/Labor: \$200 billed vs \$141 on PO/);
    expect(v.issues.join("\n")).toMatch(/Not on PO: Trip charge/);
    expect(v.issues.join("\n")).toMatch(/add up to \$384, not the stated total \$400/);
    expect(v.issues.join("\n")).toMatch(/0 of 1 required photos were on file before the invoice/);
    expect(v.confidence).toBe(0.2);
  });

  it("asks for review when there is no PO", () => {
    expect(validateInvoice(null, { total_cents: 100, lines: [{ description: "Labor", amount_cents: 100 }], photos: 2 }).decision).toBe("review");
  });
});

describe("checkPhoto", () => {
  it("matches a leak photo to a plumbing job", () => {
    expect(checkPhoto("/img/wo/wo-leak.webp", "Plumbing")).toMatchObject({ result: "Matches", confidence: 0.93 });
    expect(checkPhoto("/img/wo/wo-leak-400.webp", "Roofing").result).toBe("Matches");
  });
  it("flags a photo of the wrong thing", () => {
    expect(checkPhoto("/img/wo/wo-hvac.webp", "Plumbing", "Toilet running").result).toBe("Mismatch");
  });
  it("is unclear for unknown subjects", () => {
    expect(checkPhoto("/img/props/p01.webp", "Plumbing").result).toBe("Unclear");
  });
});

describe("preventive dates", () => {
  it("steps by frequency and clamps month ends", () => {
    expect(nextDue("2026-11-30", "Quarterly")).toBe("2027-02-28");
    expect(nextDue("2026-01-31", "Monthly")).toBe("2026-02-28");
    expect(upcoming("2026-11-04", "Semiannual", 3)).toEqual(["2026-11-04", "2027-05-04", "2027-11-04"]);
  });
});

describe("policy and scoring", () => {
  const p = { limit_cents: 75000, owner_approval_over_cents: 250000, approver_role: "property_manager" };
  it("sorts amounts into auto, approver and owner bands", () => {
    expect(policyCheck(50000, p).level).toBe("auto");
    expect(policyCheck(90000, p).level).toBe("approver");
    expect(policyCheck(300000, p).level).toBe("owner");
    expect(policyCheck(100, null).level).toBe("approver");
  });
  it("scores vendors like the triage agent and buckets ages", () => {
    expect(vendorScore(4.5, 2)).toBe(80);
    expect(vendorScore(null, 0)).toBe(60);
    expect([0, 3, 10, 20, 45].map(ageBucket)).toEqual([0, 1, 2, 3, 4]);
  });
});
