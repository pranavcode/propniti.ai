import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/platform/types";
import { openSqlite } from "@/lib/platform/sqlite";
import { ownerStatement } from "@/server/data";
import { distributeOwner, markPaymentReturned } from "@/server/money";
import { randomId } from "@/server/repo";
import { resolveWorkspace } from "@/server/workspace";
import { getMetric } from "../metrics";
import type { Actor } from "@/entities/types";
import { entitiesOf, explainLine, periodsOf, statementOf } from "./statements";
import "./metrics";

// Runs against the full generated base (in memory), so statements tie to the generator's payouts.
let db: Db;
beforeAll(() => {
  db = openSqlite(":memory:");
}, 120_000);

const c = () => ({ db, ws: null });

describe("owner statements", () => {
  it("ties every closed month to its distribution row", async () => {
    const periods = (await periodsOf(c(), "oe01")).filter((p) => p.closed).slice(0, 6);
    expect(periods.length).toBeGreaterThan(3);
    for (const p of periods) {
      const st = (await statementOf(c(), "oe01", p.period))!;
      const d = st.distribution!;
      expect(st.totals.income_cents).toBe(d.income_cents);
      expect(st.totals.vendor_cents).toBe(d.expense_cents);
      expect(st.totals.fee_cents).toBe(d.fee_cents);
      expect(st.gap_cents).toBe(0);
    }
  });

  it("finds the planted rounding cent and explains it", async () => {
    const st = (await statementOf(c(), "oe05", "2026-08"))!;
    expect(st.gap_cents).toBe(1);
    expect(st.lines.some((l) => l.key === "gap" && l.amount_cents === 1)).toBe(true);
    const x = (await explainLine(c(), "oe05", "2026-08", "gap", true))!;
    expect(x.text).toContain("$0.01");
  });

  it("opens the current month after the last payout", async () => {
    const [open] = await periodsOf(c(), "oe01");
    expect(open.closed).toBe(false);
    const st = (await statementOf(c(), "oe01", open.period))!;
    expect(st.closed).toBe(false);
    expect(st.lines.at(-1)!.key).toBe("distribution");
  });

  it("explains a line from facts with a looked-up trace, and hides staff links from portals", async () => {
    const staff = (await explainLine(c(), "oe01", "2026-10", "rent", true))!;
    expect(staff.text).toMatch(/Rent collected was \$[\d,]+\.\d\d across 4 properties/);
    expect(staff.trace.some((t) => t.href?.startsWith("/app/"))).toBe(true);
    const owner = (await explainLine(c(), "oe01", "2026-10", "distribution", false))!;
    expect(owner.trace.every((t) => !t.href)).toBe(true);
    expect(await explainLine(c(), "oe01", "1999-01", "rent", true)).toBeNull();
  });

  it("owed-now equals the sum of every entity's open statement", async () => {
    let total = 0;
    for (const e of await entitiesOf(c())) {
      const [open] = await periodsOf(c(), e.id);
      total += (await statementOf(c(), e.id, open.period))!.net_cents;
    }
    const actor = { personaId: "grace", name: "Grace Kim", role: "accountant", scope: { kind: "org", label: "" }, propertyIds: "all" } as Actor;
    const m = await getMetric("owners.owed_now")!.run({ db, ws: null, actor, propertyIds: "all", asOf: "2026-11" }, {});
    expect(Math.round((m.value ?? 0) * 100)).toBe(total);
  });

  it("counts a returned payment against income, ties to Lane A's statement and to the distribution it closes", async () => {
    const id = randomId();
    const T0 = Date.parse("2026-11-04T17:00:00Z");
    const r = await resolveWorkspace(db, new Request("http://localhost/app", { headers: { cookie: `pn_ws=${id}` } }), T0, true, false);
    if (r instanceof Response) throw new Error(`workspace not created: ${r.status}`);
    const grace = { personaId: "grace", name: "Grace Kim", role: "accountant", scope: { kind: "org", label: "All" }, propertyIds: "all" } as Actor;
    const w = { db, ws: id };
    const pay = (await db.prepare("SELECT p.id, p.amount_cents FROM payments AS p WHERE p.workspace_id = 'base' AND p.nsf = 0 AND p.property_id = 'p02' AND p.received_on >= '2026-11-01' ORDER BY p.id LIMIT 1").first<{ id: string; amount_cents: number }>())!;
    const before = (await statementOf(w, "oe01", "2026-11"))!;
    expect(await markPaymentReturned({ db, ws: id, actor: grace, nowMs: T0 }, pay.id, "NSF")).toMatchObject({ status: 200 });

    const open = (await statementOf(w, "oe01", "2026-11"))!;
    expect(open.totals.returned_cents).toBe(pay.amount_cents);
    expect(open.lines.find((l) => l.key === "returned")?.amount_cents).toBe(pay.amount_cents);
    expect(before.totals.income_cents - open.totals.income_cents).toBeLessThan(pay.amount_cents); // the fee comes back as other income
    const lane = await ownerStatement(w, "oe01");
    expect(open.totals.income_cents).toBe(lane.income_cents);
    expect(open.net_cents).toBe(lane.net_cents);
    const x = (await explainLine(w, "oe01", "2026-11", "returned", true))!;
    expect(x.text).toContain("bounced");

    // Distribute, then the closed month must tie to the distribution row, returned payment included.
    expect(await distributeOwner({ db, ws: id, actor: grace, nowMs: T0 + 1000 }, "oe01", `k${randomId().slice(0, 20)}`)).toMatchObject({ status: 200 });
    const closed = (await statementOf(w, "oe01", "2026-11"))!;
    expect(closed.closed).toBe(true);
    expect(closed.totals.income_cents).toBe(closed.distribution!.income_cents);
    expect(closed.totals.returned_cents).toBe(pay.amount_cents);
    expect(closed.distribution!.amount_cents).toBe(open.net_cents);
    expect(closed.gap_cents).toBe(0);
  });
});
