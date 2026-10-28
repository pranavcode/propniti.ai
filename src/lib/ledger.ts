import type { DemoState, Party, Transfer } from "./types";

// Simulated money movement through the property manager's trust account.
// Tenants pay rent into trust; the management fee, vendor bills and owner payouts come out of it.

export const MANAGEMENT_FEE_RATE = 0.08;
// ACH takes 1-2 business days; the demo settles in seconds so the flow is visible.
export const SETTLE_MS = 8_000;

export const TRUST: Party = { kind: "trust", id: "trust", name: "Summit Residential trust account" };
export const PM: Party = { kind: "pm", id: "u-pm", name: "Summit Residential (management fees)" };

const round2 = (n: number) => Math.round(n * 100) / 100;
export const managementFee = (rent: number) => round2(rent * MANAGEMENT_FEE_RATE);

type NewTransfer = Omit<Transfer, "id" | "status" | "settlesAt" | "cleared"> & { instant?: boolean };

// Adds a transfer unless one with the same key is already pending or cleared, so a
// double-click or retry can never move money twice.
export function addTransfer(s: DemoState, t: NewTransfer, nowMs: number, id: string): DemoState {
  if (s.transfers.some((x) => x.key === t.key && x.status !== "Returned")) return s;
  const { instant, ...rest } = t;
  const transfer: Transfer = instant
    ? { ...rest, id, status: "Cleared", cleared: rest.created }
    : { ...rest, id, status: "Pending", settlesAt: nowMs + SETTLE_MS };
  return { ...s, transfers: [transfer, ...s.transfers] };
}

// Clears pending transfers that are due. When rent clears, the management fee is taken
// from trust in the same step.
export function settle(s: DemoState, nowMs: number, stamp: string, newId: () => string): { state: DemoState; cleared: Transfer[] } {
  const due = s.transfers.filter((t) => t.status === "Pending" && (t.settlesAt ?? 0) <= nowMs);
  if (!due.length) return { state: s, cleared: [] };
  const dueIds = new Set(due.map((t) => t.id));
  let next: DemoState = {
    ...s,
    transfers: s.transfers.map((t) => (dueIds.has(t.id) ? { ...t, status: "Cleared", cleared: stamp } : t)),
    invoices: s.invoices.map((i) => (due.some((t) => t.kind === "Rent" && t.ref === i.id) ? { ...i, status: "Paid" } : i)),
  };
  for (const t of due.filter((x) => x.kind === "Rent")) {
    next = addTransfer(
      next,
      { key: `fee:${t.ref}`, kind: "Management fee", from: TRUST, to: PM, amount: managementFee(t.amount), propertyId: t.propertyId, ref: t.ref, created: stamp, instant: true },
      nowMs,
      newId(),
    );
  }
  return { state: next, cleared: due };
}

export function trustBalance(s: DemoState) {
  const live = s.transfers.filter((t) => t.status !== "Returned");
  const sum = (f: (t: Transfer) => boolean) => round2(live.filter(f).reduce((a, t) => a + t.amount, 0));
  const clearedIn = sum((t) => t.to.kind === "trust" && t.status === "Cleared");
  const clearedOut = sum((t) => t.from.kind === "trust" && t.status === "Cleared");
  const pendingIn = sum((t) => t.to.kind === "trust" && t.status === "Pending");
  const pendingOut = sum((t) => t.from.kind === "trust" && t.status === "Pending");
  return { cleared: round2(clearedIn - clearedOut), available: round2(clearedIn - clearedOut - pendingOut), pendingIn, pendingOut };
}

// What the owner is owed right now: cleared rent on their properties, less the management
// fee and vendor bills charged to those properties, for items not yet in a payout.
export function ownerStatement(s: DemoState, ownerId: string) {
  const props = new Set(s.properties.filter((p) => p.ownerId === ownerId).map((p) => p.id));
  const open = s.transfers.filter((t) => props.has(t.propertyId) && !t.statement && t.status !== "Returned");
  const total = (kind: Transfer["kind"], cleared: boolean) =>
    round2(open.filter((t) => t.kind === kind && (!cleared || t.status === "Cleared")).reduce((a, t) => a + t.amount, 0));
  const rent = total("Rent", true);
  const fees = total("Management fee", true);
  // Vendor bills count as soon as approved (pending or cleared): that money is committed.
  const vendorBills = total("Vendor payout", false);
  const items = open.filter((t) => t.kind !== "Owner payout" && (t.kind === "Vendor payout" || t.status === "Cleared"));
  return { rent, fees, vendorBills, net: round2(rent - fees - vendorBills), items };
}

// Pays the owner their statement balance from trust and closes the statement.
// Refuses when nothing is owed or trust can't cover it.
export function disburse(s: DemoState, ownerId: string, nowMs: number, stamp: string, id: string): { state: DemoState; amount: number } {
  const st = ownerStatement(s, ownerId);
  const owner = s.users.find((u) => u.id === ownerId);
  if (!owner || st.net <= 0 || st.net > trustBalance(s).available) return { state: s, amount: 0 };
  const included = new Set(st.items.map((t) => t.id));
  const propertyId = s.properties.find((p) => p.ownerId === ownerId)!.id;
  let next: DemoState = { ...s, transfers: s.transfers.map((t) => (included.has(t.id) ? { ...t, statement: id } : t)) };
  next = addTransfer(
    next,
    { key: `owner:${id}`, kind: "Owner payout", from: TRUST, to: { kind: "owner", id: owner.id, name: owner.name }, amount: st.net, propertyId, ref: `Statement ${stamp.slice(0, 10)}`, created: stamp },
    nowMs,
    id,
  );
  return { state: next, amount: st.net };
}
