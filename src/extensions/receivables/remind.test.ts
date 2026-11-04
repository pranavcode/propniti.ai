import { beforeAll, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import { runAction } from "@/app/api/e/_lib/actions";
import { getAction } from "@/extensions/actions";
import { openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { resolveActor } from "@/server/permissions";
import { randomId } from "@/server/repo";
import { resolveWorkspace } from "@/server/workspace";
import type { WriteCtx } from "@/server/query";
import { delinquentLeases } from "./queries";
import { recordPaymentHref, remindedToday } from "./remind";

// Delinquency row actions: Remind sends the Collections reminder once per lease per day, only for
// leases in the actor's scope that are past due; Record payment opens the form on that lease.

const T0 = Date.parse("2026-11-04T17:00:00Z");
let db: Db;
beforeAll(() => {
  db = openSqlite(":memory:");
}, 600_000);

async function ctx(persona: string): Promise<WriteCtx> {
  const id = randomId();
  const r = await resolveWorkspace(db, new Request("http://localhost/app", { headers: { cookie: `pn_ws=${id}` } }), T0, true, false);
  if (r instanceof Response) throw new Error(`workspace not created: ${r.status}`);
  return { db, ws: id, actor: await resolveActor(db, getPersona(persona)!, id), nowMs: T0 };
}
const remind = getAction("leases.remind")!;
const count = (sql: string, ...p: unknown[]) => db.prepare(sql).bind(...p).first<{ n: number }>().then((r) => Number(r!.n));
const tryRun = (c: WriteCtx, id: string) => runAction(c, remind, id, {}).catch((e: { status?: number; message: string }) => ({ status: e.status ?? 500, error: e.message }));

describe("delinquency row actions", () => {
  it("Remind sends one reminder on a double click, and the row shows it was sent", async () => {
    const c = await ctx("marcus");
    const lease = (await delinquentLeases(c, { page: 1, size: 1, sort: "days" })).rows[0];
    expect(lease).toBeTruthy();
    const rs = await Promise.all([tryRun(c, lease.lease_id), tryRun(c, lease.lease_id)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await count("SELECT count(*) AS n FROM message_threads WHERE workspace_id = ? AND entity_type = 'leases' AND entity_id = ?", c.ws, lease.lease_id)).toBe(1);
    expect(await count("SELECT count(*) AS n FROM messages m JOIN message_threads t ON t.workspace_id = m.workspace_id AND t.id = m.thread_id WHERE m.workspace_id = ? AND t.entity_id = ?", c.ws, lease.lease_id)).toBe(1);
    expect(await count("SELECT count(*) AS n FROM audit WHERE workspace_id = ? AND action = 'leases.remind' AND entity_id = ?", c.ws, lease.lease_id)).toBe(1);
    expect([...(await remindedToday(c, [lease.lease_id]))]).toEqual([lease.lease_id]);
  });

  it("refuses a lease outside the property manager's properties", async () => {
    const c = await ctx("marcus");
    const outside = await db.prepare("SELECT c.lease_id FROM charges c WHERE c.workspace_id = 'base' AND c.property_id NOT IN ('p01', 'p02', 'p03') AND c.paid_cents < c.amount_cents AND c.due_on < '2026-11-01' LIMIT 1").first<{ lease_id: string }>();
    const r = await tryRun(c, outside!.lease_id);
    expect(r.status).toBe(404);
    expect(await count("SELECT count(*) AS n FROM messages WHERE workspace_id = ?", c.ws)).toBe(0);
  });

  it("refuses a lease with nothing past due", async () => {
    const c = await ctx("grace");
    const paid = await db.prepare(`SELECT l.id FROM leases l WHERE l.workspace_id = 'base' AND l.status = 'Active'
      AND NOT EXISTS (SELECT 1 FROM charges c WHERE c.workspace_id = 'base' AND c.lease_id = l.id AND c.paid_cents < c.amount_cents AND c.due_on <= '2026-11-04') LIMIT 1`).first<{ id: string }>();
    const r = await tryRun(c, paid!.id);
    expect(r.status).toBe(409);
  });

  it("Record payment opens the form searched to that lease", () => {
    expect(recordPaymentHref("L-10329")).toBe("/app/receivables/record-payment?q=L-10329");
  });
});
