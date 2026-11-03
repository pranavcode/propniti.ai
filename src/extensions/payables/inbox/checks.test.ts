import { describe, expect, it } from "vitest";
import { hardStop, median, proposeGl, runChecks, type GlOption, type VendorFacts } from "./checks";

const gls: GlOption[] = [
  { id: "gl-6000", number: "6000", name: "Repairs and maintenance", type: "Expense" },
  { id: "gl-6100", number: "6100", name: "Landscaping", type: "Expense" },
  { id: "gl-6210", number: "6210", name: "Utilities — electric", type: "Expense" },
  { id: "gl-1500", number: "1500", name: "Building improvements", type: "Asset" },
];
const plumber: VendorFacts = { id: "v01", company: "Lone Star Plumbing", trade: "Plumbing", status: "Active", medianCents: 31300, paidCount: 337, usualGl: "gl-6000", usualGlShare: 0.98, bankLast4: "3888", bankChangedDays: null, bankVerified: false };
const line = (amount_cents: number, gl_account_id = "gl-6000") => ({ description: "Replace kitchen faucet", gl_account_id, amount_cents });

describe("payables checks", () => {
  it("passes a clean bill", () => {
    const c = runChecks({ vendor: plumber, amountCents: 41250, lines: [line(41250)], scannedTotalCents: 41250, gls });
    expect(c.every((x) => x.level === "ok")).toBe(true);
  });

  it("flags an amount over 2.4× the vendor's median", () => {
    const c = runChecks({ vendor: plumber, amountCents: 75200, lines: [line(75200)], gls });
    expect(c.find((x) => x.key === "amount")?.level).toBe("warn");
    expect(runChecks({ vendor: plumber, amountCents: 75000, lines: [line(75000)], gls }).find((x) => x.key === "amount")?.level).toBe("ok");
  });

  it("flags a duplicate invoice number and a total mismatch", () => {
    const c = runChecks({ vendor: plumber, amountCents: 30000, lines: [line(30000)], duplicateOf: { id: "BILL-1", status: "Paid" }, scannedTotalCents: 31000, gls });
    expect(c.find((x) => x.key === "duplicate")?.level).toBe("warn");
    expect(c.find((x) => x.key === "total")?.level).toBe("warn");
  });

  it("stops on an unverified bank change or a different remit account", () => {
    expect(hardStop(runChecks({ vendor: { ...plumber, bankChangedDays: 6 }, amountCents: 100, lines: [line(100)], gls }))?.key).toBe("bank");
    expect(hardStop(runChecks({ vendor: { ...plumber, bankChangedDays: 6, bankVerified: true }, amountCents: 100, lines: [line(100)], gls }))).toBeNull();
    expect(hardStop(runChecks({ vendor: { ...plumber, bankChangedDays: 90 }, amountCents: 100, lines: [line(100)], gls }))).toBeNull();
    expect(hardStop(runChecks({ vendor: plumber, amountCents: 100, lines: [line(100)], remitLast4: "0442", gls }))?.key).toBe("bank");
  });

  it("flags a plumbing line coded to landscaping and proposes repairs", () => {
    expect(runChecks({ vendor: plumber, amountCents: 100, lines: [line(100, "gl-6100")], gls }).find((x) => x.key === "gl")?.level).toBe("warn");
    expect(proposeGl(plumber, "Clear main drain", gls)?.gl_account_id).toBe("gl-6000");
  });

  it("codes utility lines by service and capitalises replacements", () => {
    const util: VendorFacts = { ...plumber, company: "Arizona Desert Power", trade: "Utilities", usualGl: null, usualGlShare: 0 };
    expect(proposeGl(util, "Electric service · 2026-10", gls)?.gl_account_id).toBe("gl-6210");
    expect(proposeGl(plumber, "Replacement of the roof, building B", gls)?.gl_account_id).toBe("gl-1500");
  });

  it("needs 3 paid bills for a median", () => {
    expect(median([1, 2])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
  });
});
