import { afterEach, describe, expect, it, vi } from "vitest";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { get } from "../data";
import { applyFixes, issueTargets } from "../datafix";
import { healthFilters } from "../filters";
import { issuesPage } from "../views";
import { DB_BUSY, publicError } from "../http";
import { executeProposal } from "../effects";
import { startRun } from "../orchestrator";
import { fixProposal, queueReason } from "../tools/write";
import { setModelForTests } from "../providers";
import { DANIEL, MARCUS, openFixture, WS } from "./fixture";

afterEach(() => setModelForTests(undefined));

const actorOf = (id: string): Actor => {
  const p = getPersona(id)!;
  return { ...DANIEL, personaId: id, name: p.name, role: p.role };
};

// A "rent far above market" issue: its fix changes a lease's rent, so a person decides it in the inbox.
function setup() {
  setModelForTests(null);
  const f = openFixture();
  f.raw.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, suggested_fix) VALUES ('base', ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("di-rent", "leases.rent_outlier", "leases", "l1", "p01", "2026-11-01", "warn", '{"rent_cents":140000}', JSON.stringify({ changes: { rent_cents: 150000 }, why: ["Rent far above market"] }));
  return f;
}

async function apply(personaId: string, actor: Actor, ids: string[], safeOnly = false) {
  const f = setup();
  const data = { db: f.db, ws: WS, actor };
  const r = await applyFixes(data, getPersona(personaId)!, ids, { safeOnly });
  const decisions = f.raw.prepare("SELECT count(*) AS n FROM ai_decisions WHERE workspace_id = ?").get(WS) as { n: number };
  return { ...f, data, r, decisions: decisions.n };
}

describe("applying fixes from Data Health", () => {
  it("queues a money fix from a leasing agent instead of changing the rent", async () => {
    const { r, data, raw, decisions } = await apply("lena", actorOf("lena"), ["di-rent"]);
    expect(r.applied).toBe(0);
    expect(r.results[0]).toMatchObject({ ok: false, queued: true });
    expect(r.results[0].message).toMatch(/approvals inbox/);
    expect(raw.prepare("SELECT queue_state, assignee_role FROM ai_proposals WHERE workspace_id = ? AND id = ?").get(WS, r.results[0].proposalId!)).toMatchObject({ queue_state: "needs_you", assignee_role: "accountant" });
    expect(decisions).toBe(0);
    expect((await get(data, "leases", "l1"))?.rent_cents).toBe(140000);
  });

  it("queues a money fix even for roles that may approve it: Data Health never applies one directly", async () => {
    for (const id of ["daniel", "grace"]) {
      const { r, data, decisions } = await apply(id, actorOf(id), ["di-rent"]);
      expect(r.results[0]).toMatchObject({ ok: false, queued: true });
      expect(decisions).toBe(0);
      expect((await get(data, "leases", "l1"))?.rent_cents).toBe(140000);
    }
  });

  it("applies a low-risk fix for a role with write access", async () => {
    const { r, data, decisions } = await apply("marcus", MARCUS, ["di1"]);
    expect(r.results[0]).toMatchObject({ ok: true });
    expect(r.applied).toBe(1);
    expect(decisions).toBe(1);
    expect((await get(data, "data_issues", "di1"))?.status).not.toBe("open");
  });

  it("refuses a low-risk fix for a role without write access and leaves it queued", async () => {
    const { r, data, decisions } = await apply("lena", actorOf("lena"), ["di1"]);
    expect(r.results[0]).toMatchObject({ ok: false, queued: true });
    expect(r.results[0].message).toMatch(/can't act on/);
    expect(decisions).toBe(0);
    expect((await get(data, "properties", "p02"))?.street).toBe("123 MAIN STREET.");
  });

  it("bulk safe fixes: skip money fixes, apply low-risk ones only for a role that may", async () => {
    const ok = await apply("marcus", MARCUS, ["di1", "di-rent"], true);
    expect(ok.r.applied).toBe(1);
    expect(ok.r.results.find((x) => x.id === "di-rent")).toMatchObject({ ok: false });
    expect(ok.raw.prepare("SELECT count(*) AS n FROM ai_proposals WHERE workspace_id = ? AND entity_id = 'di-rent'").get(WS)).toMatchObject({ n: 0 });
    const refused = await apply("lena", actorOf("lena"), ["di1"], true);
    expect(refused.r.applied).toBe(0);
    expect(refused.decisions).toBe(0);
  });

  it("the page's button label follows the same rule: queued exactly when applying would queue", async () => {
    for (const [id, actor] of [["lena", actorOf("lena")], ["marcus", MARCUS], ["daniel", actorOf("daniel")]] as const) {
      for (const issue of ["di1", "di-rent"]) {
        const { r, raw } = await apply(id, actor, [issue]);
        const row = raw.prepare("SELECT * FROM data_issues WHERE id = ?").get(issue) as Record<string, unknown>;
        const fix = row.suggested_fix ? row : { ...row, suggested_fix: JSON.stringify({ changes: { street: "123 Main St" } }) };
        expect(queueReason(fixProposal(fix), actor.role) !== null).toBe(!r.results[0].ok);
      }
    }
  });

  it("masks database errors but not model-provider ones", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(publicError("D1_ERROR: D1 DB is overloaded. Requests queued for too long.")).toBe(DB_BUSY);
    expect(publicError("SQLITE_BUSY: database is locked")).toBe(DB_BUSY);
    expect(publicError("Anthropic API: overloaded_error")).toBe("Anthropic API: overloaded_error");
    expect(publicError("Already fixed")).toBe("Already fixed");
    quiet.mockRestore();
  });

  it("treats payables, GL and cents changes, and fixes with no concrete change, as always-human", () => {
    const issue = (rule: string, table: string, fix: object) => ({ id: "x", rule_id: rule, entity_type: table, entity_id: "e1", severity: "warn", suggested_fix: JSON.stringify(fix) });
    expect(fixProposal(issue("bill_lines.gl_miscoded", "bill_lines", { changes: { gl_account_id: "gl-6100" } })).alwaysHuman).toBe(true);
    expect(fixProposal(issue("bills.something", "bills", { changes: { memo: "x" } })).alwaysHuman).toBe(true);
    expect(fixProposal(issue("units.rent_typo", "units", { changes: { market_rent_cents: 150000 } })).alwaysHuman).toBe(true);
    expect(fixProposal(issue("vendors.bank_format", "vendors", { changes: { bank_last4: "1234" } })).alwaysHuman).toBe(true);
    const dup = fixProposal(issue("residents.possible_duplicate", "residents", { action: "residents.merge", params: { keep: "r1", merge: "r2" } }));
    expect(dup.alwaysHuman).toBe(true);
    expect((dup.payload as { effects: { kind: string }[] }).effects.map((e) => e.kind)).toEqual(["task"]);
    expect(fixProposal(issue("properties.address_format", "properties", { changes: { street: "1 Main St" } })).alwaysHuman).toBe(false);
  });

  it("the agent, auto within policy, never auto-applies a GL recode or an action-only fix", async () => {
    const f = setup();
    const add = (id: string, rule: string, table: string, entityId: string, fix: object) =>
      f.raw.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, suggested_fix) VALUES ('base', ?, ?, ?, ?, 'p01', '2026-11-01', 'warn', '{}', ?)").run(id, rule, table, entityId, JSON.stringify(fix));
    add("di-gl", "bill_lines.gl_miscoded", "bill_lines", "bl1", { changes: { gl_account_id: "gl-6100" } });
    add("di-dup", "residents.possible_duplicate", "residents", "r2", { action: "residents.merge", params: { keep: "r1", merge: "r2" } });
    await (await startRun({ db: f.db, ws: WS, actor: DANIEL, agent: "data_health", trigger: { kind: "manual" } })).done;
    const data = { db: f.db, ws: WS, actor: DANIEL };
    expect((await get(data, "bill_lines", "bl1"))?.gl_account_id).toBe("gl-6300");
    for (const id of ["di-gl", "di-dup", "di-rent"]) expect((await get(data, "data_issues", id))?.status).toBe("open");
    expect(f.raw.prepare("SELECT count(*) AS n FROM ai_proposals WHERE workspace_id = ? AND entity_id IN ('di-gl', 'di-dup') AND queue_state = 'auto_handled'").get(WS)).toMatchObject({ n: 0 });
  });

  it("executeProposal returns a friendly message, not raw D1 text, when the database fails", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = setup();
    const data = { db: f.db, ws: WS, actor: MARCUS };
    await applyFixes({ ...data, actor: actorOf("lena") }, getPersona("lena")!, ["di1"], { safeOnly: false });
    const row = f.raw.prepare("SELECT * FROM ai_proposals WHERE workspace_id = ? AND entity_id = 'di1'").get(WS) as Record<string, unknown>;
    const failing = { prepare: (q: string) => f.db.prepare(q), batch: async () => { throw new Error("D1_ERROR: D1 DB is overloaded. Requests queued for too long."); } };
    expect(await executeProposal({ ...data, db: failing }, row, { id: "marcus", name: "Marcus Bell" })).toMatchObject({ ok: false, message: DB_BUSY });
    quiet.mockRestore();
  });
});

describe("Data Health filters and bulk actions across pages", () => {
  // 30 address fixes at p02 (low risk), the rent fix (money) and di1 from the fixture.
  function many() {
    const f = setup();
    const add = f.raw.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, suggested_fix) VALUES ('base', ?, 'properties.address_format', 'properties', 'p02', 'p02', '2026-10-01', 'info', '{}', ?)");
    for (let i = 0; i < 30; i++) add.run(`di-a${i}`, JSON.stringify({ changes: { street: `${i} Main St` } }));
    return f;
  }

  it("reads the record, rule and issue links other pages send", () => {
    expect(healthFilters({ "f.entity_id": "l1", "f.rule_id": "leases.rent_outlier" })).toEqual({ entity_id: "l1", rule: "leases.rent_outlier" });
    expect(healthFilters(new URLSearchParams("issue=di1&severity=warn&page=2"))).toEqual({ issue: "di1", severity: "warn" });
  });

  it("filters the issue list by record and by issue", async () => {
    const f = many();
    const data = { db: f.db, ws: WS, actor: DANIEL };
    expect((await issuesPage(data, { entity_id: "l1" })).rows.map((r) => (r as Record<string, unknown>).id)).toEqual(["di-rent"]);
    expect((await issuesPage(data, { issue: "di-a3" })).rows.map((r) => (r as Record<string, unknown>).id)).toEqual(["di-a3"]);
    expect((await issuesPage(data, { entity_id: "p02" })).total).toBe(31);
  });

  it("counts safe fixes and fixes to send on every page, by role", async () => {
    const f = many();
    const marcus = { db: f.db, ws: WS, actor: MARCUS };
    expect(await issueTargets(marcus, {}, "safe")).toMatchObject({ count: 31, more: false });
    expect(await issueTargets(marcus, {}, "send")).toMatchObject({ count: 1, ids: ["di-rent"] });
    expect(await issueTargets(marcus, { rule: "leases.rent_outlier" }, "safe")).toMatchObject({ count: 0 });
    expect(await issueTargets(marcus, {}, "safe", 10)).toMatchObject({ count: 10, more: true });
    // A leasing agent can't apply fixes: everything with a fix is one to send.
    const lena = { db: f.db, ws: WS, actor: actorOf("lena") };
    expect(await issueTargets(lena, {}, "safe")).toMatchObject({ count: 0 });
    expect(await issueTargets(lena, {}, "send")).toMatchObject({ count: 32 });
  });

  it("applies all safe matching fixes once and sends the rest, skipping ones already waiting", async () => {
    const f = many();
    const data = { db: f.db, ws: WS, actor: MARCUS };
    const t = await issueTargets(data, { entity_id: "p02" }, "safe");
    const [a, b] = await Promise.all([applyFixes(data, getPersona("marcus")!, t.ids, { safeOnly: true }), applyFixes(data, getPersona("marcus")!, t.ids, { safeOnly: true })]);
    expect(a.applied + b.applied).toBe(31);
    expect(f.raw.prepare("SELECT count(*) AS n FROM ai_decisions WHERE workspace_id = ?").get(WS)).toMatchObject({ n: 31 });
    const lena = { db: f.db, ws: WS, actor: actorOf("lena") };
    const send = await issueTargets(lena, { rule: "leases.rent_outlier" }, "send");
    const r = await applyFixes(lena, getPersona("lena")!, send.ids, { safeOnly: false });
    expect(r.queued).toBe(1);
    expect(await issueTargets(lena, { rule: "leases.rent_outlier" }, "send")).toMatchObject({ count: 0 });
  });
});
