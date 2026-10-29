import { describe, expect, it } from "vitest";
import { SETTLE_MS, TRUST, addTransfer, approveWorkOrder, disburse, managementFee, ownerStatement, settle, trustBalance, vendorPaidYtd } from "./ledger";
import { seed } from "./seed";
import type { DemoState } from "./types";

let n = 0;
const id = () => `t${++n}`;
const T0 = 1_000_000;

const payRent = (s: DemoState, invoice: string, tenancy = "t1") => {
  const inv = s.invoices.find((i) => i.id === invoice)!;
  const t = s.tenancies.find((x) => x.id === tenancy)!;
  return addTransfer(
    s,
    { key: `rent:${invoice}`, kind: "Rent", from: { kind: "tenant", id: t.tenantId, name: "Tenant" }, to: TRUST, amount: inv.amount, propertyId: t.propertyId, ref: invoice, created: "2026-10-28" },
    T0,
    id(),
  );
};

describe("ledger", () => {
  it("takes an 8% management fee", () => {
    expect(managementFee(1850)).toBe(148);
    expect(managementFee(1725)).toBe(138);
  });

  it("is idempotent: paying the same invoice twice creates one transfer", () => {
    const once = payRent(seed(), "INV-2611-01");
    const twice = payRent(once, "INV-2611-01");
    expect(twice.transfers.length).toBe(once.transfers.length);
    expect(once.transfers.length).toBe(seed().transfers.length + 1);
  });

  it("keeps rent pending until it settles, then marks the invoice paid and takes the fee", () => {
    const s = payRent(seed(), "INV-2611-01");
    expect(settle(s, T0 + SETTLE_MS - 1, "now", id).cleared).toHaveLength(0);
    const { state, cleared } = settle(s, T0 + SETTLE_MS, "now", id);
    expect(cleared).toHaveLength(1);
    expect(state.invoices.find((i) => i.id === "INV-2611-01")?.status).toBe("Paid");
    expect(state.transfers.find((t) => t.key === "fee:INV-2611-01")).toMatchObject({ amount: 148, status: "Cleared" });
  });

  it("computes each owner's statement: rent less fee and vendor bills", () => {
    const s = seed();
    // Robert: Oct rent 1850 + 1950 + 1400 cleared; fees 8%.
    expect(ownerStatement(s, "u-owner1")).toMatchObject({ rent: 5200, fees: 416, vendorBills: 0, net: 4784 });
    const withBill = addTransfer(
      s,
      { key: "vendor:WO-1041", kind: "Vendor payout", from: TRUST, to: { kind: "vendor", id: "v1", name: "CoolAir HVAC" }, amount: 635, propertyId: "p1", ref: "WO-1041", created: "2026-10-28" },
      T0,
      id(),
    );
    expect(ownerStatement(withBill, "u-owner1").net).toBe(4149);
  });

  it("pays the owner from trust once, closing the statement", () => {
    const s = seed();
    const before = trustBalance(s).available;
    const { state, amount } = disburse(s, "u-owner1", T0, "2026-10-28 10:00", "payout-1");
    expect(amount).toBe(4784);
    expect(ownerStatement(state, "u-owner1").net).toBe(0);
    expect(trustBalance(state).available).toBe(before - 4784);
    expect(disburse(state, "u-owner1", T0, "2026-10-28 10:01", "payout-2").amount).toBe(0); // nothing left to pay
  });

  it("refuses a payout larger than the trust balance", () => {
    const s = { ...seed(), transfers: seed().transfers.filter((t) => t.id !== "tr-open") }; // drop opening balance
    expect(trustBalance(s).available).toBeLessThan(ownerStatement(s, "u-owner1").net);
    expect(disburse(s, "u-owner1", T0, "x", "p").amount).toBe(0);
  });

  it("approves a submitted job once: payout pending, then Paid when it clears", () => {
    const s = seed();
    const first = approveWorkOrder(s, "WO-1041", T0, "now", "p1");
    expect(first.error).toBeUndefined();
    expect(first.state.workOrders.find((w) => w.id === "WO-1041")?.status).toBe("Payment pending");
    const again = approveWorkOrder(first.state, "WO-1041", T0, "now", "p2");
    expect(again.error).toMatch(/Only submitted work/);
    expect(again.state.transfers.length).toBe(first.state.transfers.length);
    const cleared = settle(first.state, T0 + SETTLE_MS, "later", id).state;
    expect(cleared.workOrders.find((w) => w.id === "WO-1041")?.status).toBe("Paid");
    expect(vendorPaidYtd(cleared, "v1")).toBe(vendorPaidYtd(s, "v1") + 635);
    expect(vendorPaidYtd(first.state, "v1")).toBe(vendorPaidYtd(s, "v1")); // pending isn't paid yet
  });

  it("refuses a vendor payout the trust account can't cover", () => {
    let s = seed();
    s = disburse(s, "u-owner1", T0, "a", "o1").state;
    s = disburse(s, "u-owner2", T0, "b", "o2").state;
    expect(trustBalance(s).available).toBeLessThan(635);
    const r = approveWorkOrder(s, "WO-1041", T0, "now", "p1");
    expect(r.error).toMatch(/can't cover/);
    expect(trustBalance(r.state).available).toBeGreaterThanOrEqual(0);
  });
});
