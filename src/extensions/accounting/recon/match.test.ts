import { describe, expect, it } from "vitest";
import { matchLines, score, type LedgerItem, type StatementLine } from "./match";

const line = (id: string, posted_on: string, amount_cents: number, description: string, transfer_id: string | null = null): StatementLine => ({ id, posted_on, description, amount_cents, transfer_id });
const tr = (id: string, on: string, amount_cents: number, to_name: string, from_name = "Operating trust", ref = ""): LedgerItem => ({ id, on, amount_cents, kind: amount_cents > 0 ? "Rent" : "Vendor payout", from_name, to_name, ref });

describe("bank reconciliation matching", () => {
  it("keeps existing links as matches", () => {
    const r = matchLines([line("b1", "2026-10-02", 120000, "ACH CREDIT", "t1")], [tr("t1", "2026-10-01", 120000, "Operating trust")]);
    expect(r.matches[0]).toMatchObject({ status: "Matched", confidence: 1 });
    expect(r.unmatchedLedger).toHaveLength(0);
  });

  it("suggests the exact amount nearby, scoring payee words", () => {
    const r = matchLines(
      [line("b1", "2026-10-15", -48000, "ACH DEBIT LONE STAR PLUMBING")],
      [tr("t1", "2026-10-14", -48000, "Lone Star Plumbing", "Operating trust", "BILL-20001"), tr("t2", "2026-10-14", -48000, "Hill Country HVAC")],
    );
    expect(r.matches[0].status).toBe("Suggested");
    expect(r.matches[0].transfer?.id).toBe("t1");
    expect(r.matches[0].why).toContain("Same amount");
    expect(r.matches[0].why.some((w) => w.startsWith("Payee matches"))).toBe(true);
    expect(r.matches[0].confidence).toBeGreaterThan(0.9);
  });

  it("uses each ledger transfer once, best score first", () => {
    const r = matchLines(
      [line("b1", "2026-10-03", 50000, "DEPOSIT"), line("b2", "2026-10-01", 50000, "DEPOSIT")],
      [tr("t1", "2026-10-01", 50000, "Operating trust")],
    );
    expect(r.matches.find((m) => m.line.id === "b2")?.transfer?.id).toBe("t1");
    expect(r.matches.find((m) => m.line.id === "b1")).toMatchObject({ status: "Unmatched", unexplained: true });
  });

  it("ignores the wrong sign, more than $25 apart or more than 3 days apart", () => {
    const l = line("b1", "2026-10-10", 50000, "DEPOSIT");
    expect(score(l, tr("t", "2026-10-10", -50000, "x"))).toBeNull();
    expect(score(l, tr("t", "2026-10-10", 52600, "x"))).toBeNull();
    expect(score(l, tr("t", "2026-10-14", 50000, "x"))).toBeNull();
    expect(score(l, tr("t", "2026-10-11", 50400, "x"))?.why[0]).toBe("Amounts differ by $4.00");
  });

  it("flags deposits with no candidate as unexplained, not withdrawals", () => {
    const r = matchLines([line("b1", "2026-10-10", 31337, "MOBILE DEPOSIT"), line("b2", "2026-10-10", -2500, "SERVICE FEE")], []);
    expect(r.matches.map((m) => m.unexplained)).toEqual([true, false]);
  });
});
