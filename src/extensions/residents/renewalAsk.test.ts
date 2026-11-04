import { beforeAll, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import type { ActionContext, Row } from "@/entities/types";
import { getAction } from "@/extensions/actions";
import { openSqlite } from "@/lib/platform/sqlite";
import type { Db } from "@/lib/platform/types";
import { resolveActor } from "@/server/permissions";
import { randomId } from "@/server/repo";
import { resolveWorkspace } from "@/server/workspace";
import { askedThisWeek, weekOf } from "./renewalAsk";

// "Ask about renewing" from the resident portal: one message to the office per lease per week, in
// the resident's renewal conversation; not offered while a renewal offer is waiting for them.

const T0 = Date.parse("2026-11-04T17:00:00Z");
let db: Db;
beforeAll(() => {
  db = openSqlite(":memory:");
}, 600_000);

async function ctx(): Promise<ActionContext> {
  const id = randomId();
  const r = await resolveWorkspace(db, new Request("http://localhost/app", { headers: { cookie: `pn_ws=${id}` } }), T0, true, false);
  if (r instanceof Response) throw new Error(`workspace not created: ${r.status}`);
  return { db, ws: id, actor: await resolveActor(db, getPersona("resident")!, id), nowMs: T0 };
}
const ask = (c: ActionContext, row: Row) => getAction("residents.ask_renewal")!.handler(c, row, {});
const count = (sql: string, ...p: unknown[]) => db.prepare(sql).bind(...p).first<{ n: number }>().then((r) => Number(r!.n));

// A primary resident on an active lease with no renewal offer.
const noOffer = () => db.prepare(`SELECT r.id, r.first_name, r.last_name, l.id AS lease_id FROM residents r JOIN leases l ON l.workspace_id = 'base' AND l.household_id = r.household_id AND l.status = 'Active'
  WHERE r.workspace_id = 'base' AND r.is_primary = 1 AND NOT EXISTS (SELECT 1 FROM renewal_offers o WHERE o.workspace_id = 'base' AND o.lease_id = l.id) LIMIT 1`).first<Row & { lease_id: string }>();

describe("ask about renewing", () => {
  it("weeks start on Monday", () => {
    expect(weekOf("2026-11-04")).toBe("2026-11-02");
    expect(weekOf("2026-11-02")).toBe("2026-11-02");
    expect(weekOf("2026-11-08")).toBe("2026-11-02");
    expect(weekOf("2026-11-09")).toBe("2026-11-09");
  });

  it("sends one message to the office on a double click, then waits a week", async () => {
    const c = await ctx();
    const r = (await noOffer())!;
    const rs = await Promise.all([ask(c, r), ask(c, r)]);
    expect(rs.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(await count("SELECT count(*) AS n FROM messages WHERE workspace_id = ? AND direction = 'in' AND sender_id = ?", c.ws, r.id)).toBe(1);
    const t = await db.prepare("SELECT party_id, entity_type, entity_id, unread, status FROM message_threads WHERE workspace_id = ?").bind(c.ws).first();
    expect(t).toEqual({ party_id: r.id, entity_type: "leases", entity_id: r.lease_id, unread: 1, status: "Open" });
    expect(await askedThisWeek(db, c.ws, r.lease_id)).toBe(true);
    expect((await ask(c, r)).status).toBe(409);
  });

  it("isn't needed while a renewal offer is waiting", async () => {
    const c = await ctx();
    const me = (await db.prepare("SELECT * FROM residents WHERE workspace_id = 'base' AND id = 'res-p01-0001'").first<Row>())!;
    const r = await ask(c, me);
    expect(r.status).toBe(409);
    expect(await count("SELECT count(*) AS n FROM messages WHERE workspace_id = ?", c.ws)).toBe(0);
  });
});
