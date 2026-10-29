import type { DemoState } from "./types";

export const STORAGE_KEY = "propniti-demo-v4";
const LEGACY_V3 = "propniti-demo-v3";

// v3 → v4: approval used to mark vendor jobs Paid immediately and add the amount to the
// vendor's ytdPaid; in-house jobs finished as "Approved". v4 keeps ytdPaid as a pre-ledger
// baseline (cleared payouts are added on top) and has Payment pending / Completed statuses.
export function migrateV3(old: DemoState): DemoState {
  const payoutTotal = (vendorId: string) =>
    old.transfers.filter((t) => t.kind === "Vendor payout" && t.to.id === vendorId && t.status !== "Returned").reduce((a, t) => a + t.amount, 0);
  const pendingPayout = (woId: string) => old.transfers.some((t) => t.kind === "Vendor payout" && t.ref === woId && t.status === "Pending");
  return {
    ...old,
    vendors: old.vendors.map((v) => ({ ...v, ytdPaid: Math.round((v.ytdPaid - payoutTotal(v.id)) * 100) / 100 })),
    workOrders: old.workOrders.map((w) => {
      const status = w.status as string;
      if (status === "Approved") return { ...w, status: w.vendorId === "in-house" ? "Completed" : "Payment pending" };
      if (status === "Paid" && pendingPayout(w.id)) return { ...w, status: "Payment pending" };
      return w;
    }),
    rev: old.rev ?? 1,
  };
}

// Reads this browser's saved demo, upgrading an older version in place.
export function loadSaved(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): DemoState | null {
  const current = storage.getItem(STORAGE_KEY);
  if (current) return JSON.parse(current) as DemoState;
  const legacy = storage.getItem(LEGACY_V3);
  if (!legacy) return null;
  const migrated = migrateV3(JSON.parse(legacy) as DemoState);
  storage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  storage.removeItem(LEGACY_V3);
  return migrated;
}
