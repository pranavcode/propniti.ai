import { readFileSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, describe, expect, it } from "vitest";
import { SETTLE_MS, trustBalance } from "@/lib/ledger";
import type { Db } from "@/lib/platform/types";
import { seed } from "@/lib/seed";
import { approveWorkOrder, disburseOwner, settle } from "./money";
import { loadState, randomId } from "./repo";
import { resolveWorkspace } from "./workspace";

// The same code against Cloudflare's own D1 implementation (workerd, via Miniflare), to check
// the SQL and batch semantics the node:sqlite tests stand in for.
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch: () => new Response('') }", compatibilityDate: "2026-10-28", d1Databases: { DB: "test-db" } }));
const db = (await mf.getD1Database("DB")) as unknown as Db;
afterAll(() => mf.dispose());

const T0 = Date.parse("2026-10-28T17:00:00Z");

describe("on D1 (Miniflare)", () => {
  it("applies the migration, clones the seed and moves money once on a double click", { timeout: 30_000 }, async () => {
    const sql = readFileSync("migrations/0001_init.sql", "utf8").replace(/--.*$/gm, "");
    await db.batch(sql.split(/;\s*\n/).filter((s) => s.trim()).map((s) => db.prepare(s)));

    const ws = randomId();
    const r = await resolveWorkspace(db, new Request("http://x", { headers: { cookie: `pn_ws=${ws}` } }), T0, true, false);
    expect(r).toEqual({ ws });
    const s = await loadState(db, ws);
    expect(s).toEqual(seed());

    const approvals = await Promise.all([approveWorkOrder(db, ws, s, "WO-1041", T0), approveWorkOrder(db, ws, s, "WO-1041", T0)]);
    expect(approvals.map((x) => x.status).sort()).toEqual([200, 409]);
    // Robert's statement now includes the approved bill: 4,784 - 635.
    const s2 = await loadState(db, ws);
    const owners = await Promise.all([disburseOwner(db, ws, s2, "u-owner1", "same-key-1234", T0), disburseOwner(db, ws, s2, "u-owner1", "same-key-1234", T0)]);
    expect(owners.map((x) => x.status)).toEqual([200, 200]);

    await settle(db, ws, T0 + SETTLE_MS);
    const after = await loadState(db, ws);
    expect(after.transfers.filter((t) => t.key === "vendor:WO-1041")).toMatchObject([{ status: "Cleared", amount: 635 }]);
    expect(after.transfers.filter((t) => t.key === "owner:same-key-1234")).toMatchObject([{ amount: 4149 }]);
    expect(after.workOrders.find((w) => w.id === "WO-1041")?.status).toBe("Paid");
    expect(trustBalance(after).available).toBe(trustBalance(s).available - 635 - 4149);
  });
});
