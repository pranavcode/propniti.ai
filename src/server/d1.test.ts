import { readFileSync, readdirSync } from "node:fs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { afterAll, describe, expect, it } from "vitest";
import type { Actor } from "@/entities/types";
import { SETTLE_MS } from "@/lib/ledger";
import type { Db } from "@/lib/platform/types";
import type { Base } from "@/seed/generate";
import { baseData, baseSql } from "./base";
import { chargeStatusSql, ownerStatement, trustBalances } from "./data";
import { effective } from "./effective";
import { approveAndPayWorkOrder, distributeOwner, payRent, settle } from "./money";
import { randomId } from "./repo";
import { resolveWorkspace } from "./workspace";

// The same code against Cloudflare's own D1 (workerd, via Miniflare), to check the SQL, numbered
// parameters and batch semantics the node:sqlite tests stand in for. The base is loaded with the
// same chunked statements as scripts/seed-d1.mjs, trimmed to one owner entity (p01–p04) for speed.
// Built before Miniflare starts: generating blocks the event loop long enough for workerd to
// drop an idle connection.
const KEEP = new Set(["p01", "p02", "p03", "p04"]);
const stmts = [...baseSql(slice(baseData()))];
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch: () => new Response('') }", compatibilityDate: "2026-10-28", d1Databases: { DB: "test-db" } }));
const db = (await mf.getD1Database("DB")) as unknown as Db;
afterAll(() => mf.dispose());

const T0 = Date.parse("2026-11-04T17:00:00Z");
const grace: Actor = { personaId: "grace", name: "Grace Kim", role: "accountant", scope: { kind: "org", label: "All" }, propertyIds: "all" };

function slice(b: Base): Base {
  const tables: Base["tables"] = {};
  const bills = new Set(b.tables.bills.filter((r) => KEEP.has(r.property_id as string)).map((r) => r.id));
  for (const [t, rows] of Object.entries(b.tables)) {
    tables[t] = rows.filter((r) => (t === "bill_lines" ? bills.has(r.bill_id as string) : !("property_id" in r) || r.property_id === null || KEEP.has(r.property_id as string)));
  }
  return { ...b, tables };
}

describe("on D1 (Miniflare)", () => {
  it("applies the migrations, loads the base, and moves money once on a double click", { timeout: 180_000 }, async () => {
    for (const f of readdirSync("migrations").filter((x) => x.endsWith(".sql")).sort()) {
      const sql = readFileSync(`migrations/${f}`, "utf8").replace(/--.*$/gm, "");
      await db.batch(sql.split(/;\s*\n/).filter((s) => s.trim()).map((s) => db.prepare(s)));
    }
    for (let i = 0; i < stmts.length; i += 8) await db.batch(stmts.slice(i, i + 8).map((s) => db.prepare(s)));
    expect(await db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first()).toEqual({ value: "2026-11-04" });

    const ws = randomId();
    expect(await resolveWorkspace(db, new Request("http://x", { headers: { cookie: `pn_ws=${ws}` } }), T0, true, false)).toEqual({ ws });
    const ctx = { db, ws, actor: grace, nowMs: T0 };

    const charge = await db.prepare(`SELECT c.id, c.amount_cents FROM ${effective("charges")} AS c WHERE c.period = '2026-11' AND c.property_id = 'p01' AND ${chargeStatusSql("c")} = 'Overdue' LIMIT 1`).bind(ws).first<{ id: string; amount_cents: number }>();
    const pays = await Promise.all([payRent(ctx, charge!.id), payRent(ctx, charge!.id)]);
    expect(pays.map((r) => r.status).sort()).toEqual([200, 409]);

    const wo = await db.prepare(`SELECT w.id FROM ${effective("work_orders")} AS w WHERE w.status = 'Submitted' AND w.vendor_id = 'v01' LIMIT 1`).bind(ws).first<{ id: string }>();
    const approvals = await Promise.all([approveAndPayWorkOrder(ctx, wo!.id), approveAndPayWorkOrder(ctx, wo!.id)]);
    expect(approvals.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(approvals).toContainEqual({ status: 409, error: `${wo!.id} is already approved` });

    const before = (await trustBalances({ db, ws }, "oe01")).find((b) => b.kind === "Trust")!.available_cents;
    const st = await ownerStatement({ db, ws }, "oe01");
    const owners = await Promise.all([distributeOwner(ctx, "oe01", "same-key-1234"), distributeOwner(ctx, "oe01", "same-key-1234")]);
    expect(owners.map((r) => r.status)).toEqual([200, 200]);
    expect(await db.prepare("SELECT count(*) AS n, sum(amount_cents) AS a FROM transfers WHERE workspace_id = ?1 AND key = 'owner:same-key-1234'").bind(ws).first()).toEqual({ n: 1, a: st.net_cents });

    await settle(db, ws, T0 + SETTLE_MS);
    const status = await db.prepare(`SELECT ${chargeStatusSql("c")} AS s FROM ${effective("charges")} AS c WHERE c.id = ?2`).bind(ws, charge!.id).first<{ s: string }>();
    expect(status?.s).toBe("Paid");
    expect((await db.prepare(`SELECT w.status FROM ${effective("work_orders")} AS w WHERE w.id = ?2`).bind(ws, wo!.id).first<{ status: string }>())?.status).toBe("Paid");
    // Rent pays the charge's open balance (it may be partly paid already), less the 8% fee.
    const rent = (await db.prepare("SELECT amount_cents FROM transfers WHERE workspace_id = ?1 AND key = ?2").bind(ws, `rent:${charge!.id}`).first<{ amount_cents: number }>())!.amount_cents;
    const fee = Math.floor((rent * 8 + 50) / 100);
    const after = (await trustBalances({ db, ws }, "oe01")).find((b) => b.kind === "Trust")!.available_cents;
    expect(after).toBe(before - st.net_cents + rent - fee);
  });
});
