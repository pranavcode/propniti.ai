import { describe, expect, it } from "vitest";
import { list, type DataCtx } from "../data";
import { getTool } from "../tools/registry";
import "../tools";
import type { RunContext } from "../types";
import type { Actor } from "@/entities/types";
import { DANIEL, MARCUS, openFixture, WS } from "./fixture";

// Property managers can't open banking at all; a Texas regional manager can, for Texas owners only.
const PRIYA: Actor = { personaId: "priya", name: "Priya Shah", role: "regional_manager", scope: { kind: "region", ids: ["r-tx"], label: "Texas" }, propertyIds: ["p01", "p02", "p03"] };

// Marcus manages p01–p03 (Austin). oe02 owns only p10 (Atlanta), so its distributions, bank
// account and Atlanta bills are out of his scope; the AI log tables have no property at all.
function fixture() {
  const f = openFixture();
  f.raw.exec(`
    INSERT INTO owner_distributions (workspace_id, id, owner_entity_id, transfer_id, period, income_cents, expense_cents, fee_cents, amount_cents, paid_on) VALUES
      ('base', 'od-aus', 'oe01', 't1', '2026-10', 100, 10, 8, 82, '2026-11-01'),
      ('base', 'od-atl', 'oe02', 't2', '2026-10', 100, 10, 8, 82, '2026-11-01');
    INSERT INTO bank_accounts (workspace_id, id, owner_entity_id, name, kind, bank, last4) VALUES
      ('base', 'ba-aus', 'oe01', 'Bluebonnet operating', 'Operating', 'Chase', '1111'),
      ('base', 'ba-atl', 'oe02', 'Peach State operating', 'Operating', 'Chase', '2222');
    INSERT INTO bank_transactions (workspace_id, id, bank_account_id, posted_on, description, amount_cents) VALUES
      ('base', 'bt-aus', 'ba-aus', '2026-11-01', 'Deposit', 100),
      ('base', 'bt-atl', 'ba-atl', '2026-11-01', 'Deposit', 100);
    INSERT INTO bills (workspace_id, id, property_id, owner_entity_id, vendor_id, invoice_number, bill_date, due_on, amount_cents, status) VALUES
      ('base', 'b-atl', 'p10', 'oe02', 'v01', 'ATL-1', '2026-10-28', '2026-11-15', 9000, 'Pending approval');
    INSERT INTO bill_lines (workspace_id, id, bill_id, gl_account_id, description, unit_cents, amount_cents) VALUES
      ('base', 'bl-atl', 'b-atl', 'gl-6100', 'Atlanta repair', 9000, 9000);
    INSERT INTO ai_summaries (workspace_id, id, entity_type, entity_id, summary, model, generated_at) VALUES
      ('base', 'sum-r3', 'residents', 'r3', 'Okoro (Atlanta p10) owes $2,400', 'm', '2026-11-01');
    INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, decided_at) VALUES
      ('base', 'dec-atl', 'prop-atl', 'Approved', 'daniel', '2026-11-01');
    INSERT INTO data_fix_log (workspace_id, id, issue_id, entity_type, entity_id, before_json, after_json, fixed_by, at) VALUES
      ('base', 'fix-atl', 'di-atl', 'residents', 'r3', '{"balance":2400}', '{}', 'daniel', '2026-11-01');
    INSERT INTO agent_runs (workspace_id, id, agent_key, trigger_kind, started_by, status, started_at) VALUES
      ('base', 'run-atl', 'collections', 'manual', 'daniel', 'done', '2026-11-01');
  `);
  return f;
}

const ids = (rows: { id?: unknown }[]) => rows.map((r) => String(r.id)).sort();
const tool = (key: string, data: DataCtx, input: unknown) => {
  const t = getTool(key)!;
  return t.run({ data } as unknown as RunContext, t.input.parse(input));
};

describe("AI reads follow each entity's property scope", () => {
  it("scopes owner distributions, bank transactions and bill lines like the entity API", async () => {
    const { db } = fixture();
    const m = { db, ws: WS, actor: MARCUS };
    const d = { db, ws: WS, actor: DANIEL };
    expect(ids((await list(m, "owner_distributions")).rows)).toEqual(["od-aus"]);
    expect(ids((await list({ ...m, actor: PRIYA }, "bank_transactions")).rows)).toEqual(["bt-aus"]);
    expect(ids((await list(m, "bill_lines")).rows)).toEqual(["bl1", "bl2"]);
    expect(ids((await list(d, "owner_distributions")).rows)).toEqual(["od-atl", "od-aus"]);
    expect(ids((await list(d, "bank_transactions")).rows)).toEqual(["bt-atl", "bt-aus"]);
    expect(ids((await list(d, "bill_lines")).rows)).toEqual(["bl-atl", "bl1", "bl2"]);
  });

  it("keeps out-of-scope rows out of records.search, records.get and records.related", async () => {
    const { db } = fixture();
    const m = { db, ws: WS, actor: MARCUS };
    for (const [entity, out, who] of [["owner_distributions", "od-atl", m], ["bank_transactions", "bt-atl", { ...m, actor: PRIYA }], ["bill_lines", "bl-atl", m]] as const) {
      const r = (await tool("records.search", who, { entity })) as { rows: { id: string }[] };
      expect(r.rows.length, entity).toBeGreaterThan(0);
      expect(ids(r.rows), entity).not.toContain(out);
      await expect(tool("records.get", who, { entity, id: out }), entity).rejects.toThrow(/not found or outside your scope/);
    }
    const lines = (await tool("records.related", m, { entity: "bills", id: "b-atl", related: "bill_lines" })) as { rows: unknown[] };
    expect(lines.rows).toEqual([]);
    const dists = (await tool("records.related", m, { entity: "owner_entities", id: "oe02", related: "owner_distributions" })) as { rows: unknown[] };
    expect(dists.rows).toEqual([]);
    const own = (await tool("records.related", { db, ws: WS, actor: DANIEL }, { entity: "owner_entities", id: "oe02", related: "owner_distributions" })) as { rows: { id: string }[] };
    expect(ids(own.rows)).toEqual(["od-atl"]);
  });

  it("keeps AI logs with no property out of the read tools and out of scoped roles' reads", async () => {
    const { db } = fixture();
    const m = { db, ws: WS, actor: MARCUS };
    for (const entity of ["ai_summaries", "ai_decisions", "data_fix_log", "agent_runs"]) {
      for (const key of ["records.search", "records.get"]) expect(getTool(key)!.input.safeParse({ entity, id: "x" }).success, `${key} ${entity}`).toBe(false);
      expect(getTool("records.related")!.input.safeParse({ entity: "residents", id: "r3", related: entity }).success, entity).toBe(false);
      await expect(list(m, entity as "ai_summaries"), entity).rejects.toThrow(/can't view/);
      expect((await list({ db, ws: WS, actor: DANIEL }, entity as "ai_summaries")).rows.length, entity).toBe(1);
    }
    // Reference tables with no property stay readable to every staff role.
    expect((await list(m, "help_articles")).rows.length).toBe(1);
    expect((await list(m, "data_rules")).rows.length).toBe(1);
  });
});
