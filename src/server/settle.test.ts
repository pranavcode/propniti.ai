import "@/entities";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sessionFromRequest } from "@/auth/session";
import { SETTLE_MS } from "@/lib/ledger";
import { openSqlite } from "@/lib/platform/sqlite";
import { chargeStatusSql } from "./data";
import { effective } from "./effective";
import { payRent } from "./money";
import { getRow } from "./query";
import { randomId } from "./repo";
import { resolveWorkspace } from "./workspace";

// Settle-on-read is central: any page or API request (both resolve the actor through actorFor)
// clears ACH transfers whose window has passed, so a generic read shows the charge Paid.

const { db } = vi.hoisted(() => ({ db: { current: null as ReturnType<typeof openSqlite> | null } }));
vi.mock("@/lib/platform", () => ({ getPlatform: () => ({ db: (db.current ??= openSqlite(":memory:")) }) }));
const T0 = Date.parse("2026-11-04T17:00:00Z");
beforeAll(() => {
  db.current ??= openSqlite(":memory:");
}, 240_000);
afterEach(() => vi.useRealTimers());

describe("settle on read", { timeout: 120_000 }, () => {
  it("a generic read after the ACH window shows the paid charge as Paid", async () => {
    const d = db.current!;
    const ws = randomId();
    await resolveWorkspace(d, new Request("http://x", { headers: { cookie: `pn_ws=${ws}` } }), T0, true, false);
    const req = () => new Request("http://x/api/e/charges", { headers: { cookie: `pn_ws=${ws}; pn_as=grace` } });
    const ch = (await d.prepare(`SELECT c.id FROM ${effective("charges")} AS c WHERE c.period = '2026-11' AND c.property_id = 'p02' AND ${chargeStatusSql("c")} = 'Overdue' LIMIT 1`).bind(ws).first<{ id: string }>())!;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const s0 = await sessionFromRequest(req());
    expect((await payRent({ db: d, ws, actor: s0.actor, nowMs: T0 }, ch.id)).status).toBe(200);
    expect((await getRow({ db: d, ws, actor: (await sessionFromRequest(req())).actor }, "charges", ch.id))?.status).toBe("Processing");
    vi.setSystemTime(T0 + SETTLE_MS);
    const s1 = await sessionFromRequest(req());
    expect((await getRow({ db: d, ws, actor: s1.actor }, "charges", ch.id))?.status).toBe("Paid");
    expect(Number((await d.prepare("SELECT count(*) AS n FROM transfers WHERE workspace_id = ?1 AND status = 'Pending'").bind(ws).first<{ n: number }>())!.n)).toBe(0);
  });
});
