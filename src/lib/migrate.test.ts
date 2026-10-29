import { describe, expect, it } from "vitest";
import { loadSaved, migrateV3, STORAGE_KEY } from "./migrate";
import { seed } from "./seed";
import type { DemoState } from "./types";

// A v3 snapshot: CoolAir's ytdPaid included every payout, WO-1041 was marked Paid on approval
// while its payout was still pending, and a finished in-house job was "Approved".
function v3Snapshot(): DemoState {
  const s = seed();
  return {
    ...s,
    vendors: s.vendors.map((v) => (v.id === "v1" ? { ...v, ytdPaid: 4860 + 635 } : v)),
    workOrders: s.workOrders.map((w) =>
      w.id === "WO-1041" ? { ...w, status: "Paid" } : w.id === "WO-1045" ? { ...w, status: "Approved" as unknown as "Completed" } : w,
    ),
    transfers: [
      { id: "x", key: "vendor:WO-1041", kind: "Vendor payout", from: s.transfers[0].to, to: { kind: "vendor", id: "v1", name: "CoolAir HVAC" }, amount: 635, propertyId: "p1", ref: "WO-1041", status: "Pending", created: "2026-10-28", settlesAt: 0 },
      ...s.transfers,
    ],
  };
}

describe("migrateV3", () => {
  it("rebases vendor totals and maps legacy statuses", () => {
    const m = migrateV3(v3Snapshot());
    expect(m.vendors.find((v) => v.id === "v1")?.ytdPaid).toBe(3620); // 5,495 − 1,240 − 635
    expect(m.workOrders.find((w) => w.id === "WO-1041")?.status).toBe("Payment pending");
    expect(m.workOrders.find((w) => w.id === "WO-1045")?.status).toBe("Completed");
  });

  it("loads v4 as-is, or upgrades v3 once and removes it", () => {
    const store = new Map<string, string>([["propniti-demo-v3", JSON.stringify(v3Snapshot())]]);
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    expect(loadSaved(storage)?.workOrders.find((w) => w.id === "WO-1041")?.status).toBe("Payment pending");
    expect(store.has("propniti-demo-v3")).toBe(false);
    expect(store.has(STORAGE_KEY)).toBe(true);
  });
});
