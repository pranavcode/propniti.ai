import { describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/extensions/accounting/reports/run";
import { reportDoc } from "./reports";

// A rent roll whose total says 10 rows but whose second page comes back empty.
const rentRoll = vi.hoisted(() => vi.fn(async (_ctx: unknown, page: number) => ({ total: 10, rows: page === 1 ? [{ property: "Inman Park Flats", unit: "101" }, { property: "Inman Park Flats", unit: "102" }] : [] })));
vi.mock("@/extensions/accounting/reports/standard", async (orig) => ({ ...(await orig<object>()), rentRoll }));
vi.mock("@/extensions/accounting/reports/run", async (orig) => ({ ...(await orig<object>()), scopeProperties: async () => [] }));
vi.mock("@/server/query", async (orig) => ({ ...(await orig<object>()), asOfMonth: async () => "2026-11" }));

describe("rent roll download", () => {
  it("stops paging when a page comes back empty", async () => {
    const ctx = { db: {}, ws: "w", actor: { role: "accountant", scope: { label: "All properties" } } } as unknown as Ctx;
    const doc = await reportDoc(ctx, new URLSearchParams("r=rent_roll"), false);
    expect(doc.rows).toHaveLength(2);
    expect(rentRoll).toHaveBeenCalledTimes(2);
  });
});
