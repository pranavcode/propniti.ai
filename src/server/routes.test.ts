import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/entities/types";
import { openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { chargeStatusSql } from "./data";
import { effective } from "./effective";
import { approveAndPayWorkOrder, payRent, recordPayment } from "./money";
import { cookieHeader, resolveWorkspace } from "./workspace";

// Request-level behaviour of the workspace cookie and of concurrent writes from one browser.
// (The generic /api/e routes have their own tests in src/app/api/e/__tests__.)

const T0 = Date.parse("2026-11-04T17:00:00Z");
const grace: Actor = { personaId: "grace", name: "Grace Kim", role: "accountant", scope: { kind: "org", label: "All" }, propertyIds: "all" };
let db: Db;
beforeAll(() => {
  db = openSqlite(":memory:");
}, 240_000);
const count = (sql: string, ...p: unknown[]) => db.prepare(sql).bind(...p).first<{ n: number }>().then((r) => Number(r!.n));

describe("workspace cookie", { timeout: 60_000 }, () => {
  it("a first-time reader gets a cookie and base data, without a workspace row", async () => {
    const before = await count("SELECT count(*) AS n FROM workspaces");
    const r = await resolveWorkspace(db, new Request("http://x/app"), T0, false, false);
    expect(r).toMatchObject({ ws: null, setCookie: expect.stringMatching(/^[\w-]{22,}$/) });
    expect(await count("SELECT count(*) AS n FROM workspaces")).toBe(before);
    expect(cookieHeader("abc")).toMatch(/^pn_ws=abc; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000/);
  });

  it("the first write creates the workspace; later requests reuse it without a new cookie", async () => {
    const first = await resolveWorkspace(db, new Request("http://x/app"), T0, true, false);
    if (first instanceof Response) throw new Error("refused");
    expect(first.setCookie).toBe(first.ws);
    const again = await resolveWorkspace(db, new Request("http://x/app", { headers: { cookie: `pn_ws=${first.ws}` } }), T0 + 1000, true, false);
    expect(again).toEqual({ ws: first.ws });
  });

  it("refuses ids that don't match the cookie pattern and limits creates per network", async () => {
    expect(await resolveWorkspace(db, new Request("http://x", { headers: { cookie: "pn_ws=../../etc" } }), T0, false, false)).toMatchObject({ ws: null });
    const make = () => resolveWorkspace(db, new Request("http://x", { headers: { "cf-connecting-ip": "9.9.9.9" } }), T0, true, true);
    for (let i = 0; i < 30; i++) expect(await make()).not.toBeInstanceOf(Response);
    const res = (await make()) as Response;
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
  });

  it("applies writes from two tabs at once without losing either; a double approve moves money once", async () => {
    const r = await resolveWorkspace(db, new Request("http://x"), T0, true, false);
    if (r instanceof Response) throw new Error("refused");
    const ctx = { db, ws: r.ws!, actor: grace, nowMs: T0 };
    const [a, b] = (await db.prepare(`SELECT c.id FROM ${effective("charges")} AS c WHERE c.period = '2026-11' AND c.property_id = 'p03' AND ${chargeStatusSql("c")} = 'Overdue' LIMIT 2`).bind(ctx.ws).all<{ id: string }>()).results;
    const wo = await db.prepare(`SELECT w.id FROM ${effective("work_orders")} AS w WHERE w.status = 'Submitted' AND w.vendor_id = 'v01' LIMIT 1`).bind(ctx.ws).first<{ id: string }>();
    const results = await Promise.all([
      payRent(ctx, a.id),
      approveAndPayWorkOrder(ctx, wo!.id),
      approveAndPayWorkOrder(ctx, wo!.id),
      recordPayment(ctx, { chargeId: b.id, amountCents: 20_000, method: "Money order", reference: "MO 1", idempotencyKey: "tab-two" }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 200, 200, 409]);
    expect(await count("SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND key = ?2", ctx.ws, `vendor:${wo!.id}`)).toBe(1);
    expect(await count("SELECT count(*) AS n FROM payments WHERE workspace_id = ?1 AND reference = 'MO 1'", ctx.ws)).toBe(1);
    expect(await count("SELECT count(*) AS n FROM events WHERE workspace_id = ?1", ctx.ws)).toBe(3);
  });
});
