import { afterEach, describe, expect, it, vi } from "vitest";
import { getPersona } from "@/auth/personas";
import type { Actor } from "@/entities/types";
import { generate } from "@/seed/generate";
import { get } from "../data";
import { applyFixes, issueTargets } from "../datafix";
import { healthFilters } from "../filters";
import { dataHealth, issuesPage } from "../views";
import { fixPreviewProps, NEXT_STEP, type Issue } from "../ui/IssueFix";
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

describe("Data Health in plain words", () => {
  it("names the record and its fields, and formats cents and dates, never rule keys or snake_case", async () => {
    const f = setup();
    f.raw.prepare("INSERT INTO data_rules (workspace_id, id, entity_type, name, severity, description, check_kind) VALUES ('base', 'leases.rent_outlier', 'leases', 'Rent far above market', 'warn', 'Rent over 3× market', 'computed')").run();
    f.raw.prepare("UPDATE data_issues SET suggested_fix = ? WHERE id = 'di-rent'").run(JSON.stringify({ changes: { rent_cents: 150000 }, why: ["Lease started 2025-12-16, matching term_months"] }));
    const data = { db: f.db, ws: WS, actor: DANIEL };
    const issue = (await issuesPage(data, { issue: "di-rent" })).rows[0] as unknown as Issue;
    expect(issue).toMatchObject({ record: "Lee household · #412", entity_label: "Lease" });
    const p = fixPreviewProps(issue, async () => null);
    expect(p.rule).toBeUndefined();
    expect(p.title).toBe("Rent far above market · Lease Lee household · #412 · The Lofts at Riverside");
    expect(p.changes).toEqual([{ field: "rent_cents", label: "Rent", before: "$1,400.00", after: "$1,500.00" }]);
    expect(p.why).toEqual(["Lease started Dec 16, 2025, matching term months"]);
    const health = await dataHealth(data);
    for (const m of health.modules) for (const e of m.entities) expect(e).not.toMatch(/_/);
  });
});

describe("Data Health issues with no automatic fix", () => {
  it("drop the before/after table and say what a person does next, with a link to the record", async () => {
    const f = setup();
    f.raw.prepare("INSERT INTO data_rules (workspace_id, id, entity_type, name, severity, description, check_kind) VALUES ('base', 'vendors.unverified_bank_change', 'vendors', 'Unverified vendor bank change', 'critical', 'x', 'computed')").run();
    f.raw.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, suggested_fix) VALUES ('base', 'di-bank', 'vendors.unverified_bank_change', 'vendors', 'v01', NULL, '2026-11-01', 'critical', '{}', ?)")
      .run(JSON.stringify({ action: "vendors.hold_payments", why: ["Bank details changed 6 days ago", "No callback verification on file"], confidence: 0.93, source: "data_health" }));
    const issue = (await issuesPage({ db: f.db, ws: WS, actor: DANIEL }, { issue: "di-bank" })).rows[0] as unknown as Issue;
    const p = fixPreviewProps(issue, async () => null);
    expect(p.title).toMatch(/^Unverified vendor bank change · Vendor /);
    expect(p.changes).toEqual([]);
    expect(p.onApply).toBeUndefined();
    expect(p.needsPerson).toBeNull();
    expect(p.nextStep).toEqual({ text: NEXT_STEP["vendors.unverified_bank_change"], href: "/app/maintenance/vendors/v01", label: "Open vendor" });
  });

  it("has a next step for every seeded rule whose fix is a named action", { timeout: 120_000 }, () => {
    const rules = new Set(generate().tables.data_issues.filter((i) => (JSON.parse(String(i.suggested_fix ?? "null")) as { action?: string } | null)?.action).map((i) => String(i.rule_id)));
    expect(rules.size).toBeGreaterThan(5);
    for (const rule of rules) expect(NEXT_STEP[rule], rule).toBeTruthy();
  });
});

describe("Data Health scope", () => {
  it("counts rules within the persona's properties and leaves out record types the role can't open", async () => {
    const f = setup();
    f.raw.prepare("INSERT INTO data_rules (workspace_id, id, entity_type, name, severity, description, check_kind) VALUES ('base', 'bill_lines.gl_miscoded', 'bill_lines', 'GL miscoded', 'warn', 'x', 'computed'), ('base', 'leases.rent_outlier', 'leases', 'Rent far above market', 'warn', 'x', 'computed')").run();
    const add = f.raw.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence) VALUES ('base', ?, ?, ?, ?, ?, '2026-11-01', 'warn', '{}')");
    add.run("di-gl", "bill_lines.gl_miscoded", "bill_lines", "bl1", "p01");
    add.run("di-far", "leases.rent_outlier", "leases", "l3", "p10");
    const lena = { ...MARCUS, personaId: "lena", name: "Lena Ortiz", role: "leasing_agent" as const };
    const data = { db: f.db, ws: WS, actor: lena };
    const h = await dataHealth(data);
    expect(h.rules.map((r) => r.id)).not.toContain("bill_lines.gl_miscoded");
    expect(h.rules.find((r) => r.id === "leases.rent_outlier")?.open).toBe(1); // di-rent at p01, not di-far at p10
    expect(h.rules.reduce((n, r) => n + r.open, 0)).toBeLessThanOrEqual(h.open);
    expect((await issuesPage(data, {})).rows.map((r) => (r as Record<string, unknown>).id)).not.toContain("di-gl");
    const all = await dataHealth({ db: f.db, ws: WS, actor: DANIEL });
    expect(all.rules.find((r) => r.id === "leases.rent_outlier")?.open).toBe(2);
  });
});

describe("Data Health issues on records with no property", () => {
  // A vendor bank change (no property) and lease issues at p01 (Marcus's) and p10 (not his).
  function orgIssues() {
    const f = setup();
    f.raw.prepare("INSERT INTO data_rules (workspace_id, id, entity_type, name, severity, description, check_kind) VALUES ('base', 'vendors.unverified_bank_change', 'vendors', 'Unverified vendor bank change', 'critical', 'x', 'computed'), ('base', 'leases.rent_outlier', 'leases', 'Rent far above market', 'warn', 'x', 'computed')").run();
    const add = f.raw.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, suggested_fix) VALUES ('base', ?, ?, ?, ?, ?, '2026-11-01', ?, '{}', ?)");
    add.run("di-bank", "vendors.unverified_bank_change", "vendors", "v02", null, "critical", JSON.stringify({ action: "vendors.hold_payments", why: ["Bank details changed"] }));
    add.run("di-far", "leases.rent_outlier", "leases", "l3", "p10", "warn", null);
    return f;
  }
  const ids = (rows: unknown[]) => rows.map((r) => (r as Record<string, unknown>).id);

  it("a property manager sees vendor issues their role can read, and still not other properties' issues", async () => {
    const f = orgIssues();
    const data = { db: f.db, ws: WS, actor: MARCUS };
    const list = await issuesPage(data, {});
    expect(ids(list.rows)).toContain("di-bank");
    expect(ids(list.rows)).not.toContain("di-far");
    expect(await get(data, "data_issues", "di-bank")).not.toBeNull();
    expect(await get(data, "data_issues", "di-far")).toBeNull();
    const h = await dataHealth(data);
    expect(h.rules.find((r) => r.id === "vendors.unverified_bank_change")?.open).toBe(1);
    expect(h.rules.find((r) => r.id === "leases.rent_outlier")?.open).toBe(1); // di-rent at p01 only
    expect(h.open).toBe(list.total);
    expect(h.rules.reduce((n, r) => n + r.open, 0)).toBeLessThanOrEqual(h.open);
    expect(h.modules.find((m) => m.entities.includes("vendors"))?.open).toBe(1);
  });

  it("a role that can't read vendors still doesn't see their issues", async () => {
    const f = orgIssues();
    const data = { db: f.db, ws: WS, actor: { ...MARCUS, personaId: "lena", name: "Lena Ortiz", role: "leasing_agent" as const } };
    expect(ids((await issuesPage(data, {})).rows)).not.toContain("di-bank");
    expect(await get(data, "data_issues", "di-bank")).toBeNull();
    expect((await dataHealth(data)).rules.map((r) => r.id)).not.toContain("vendors.unverified_bank_change");
  });
});

describe("Data Health fixes a person chooses between", () => {
  // The lease ended but is still marked Active: end it, or switch it to month-to-month.
  function pastEnd() {
    const f = setup();
    f.raw.prepare("UPDATE leases SET end_on = '2026-07-31' WHERE id = 'l2'").run();
    f.raw.prepare("INSERT INTO data_rules (workspace_id, id, entity_type, name, severity, description, check_kind) VALUES ('base', 'leases.past_end_date', 'leases', 'Lease still active after its end date', 'warn', 'x', 'computed')").run();
    f.raw.prepare("INSERT INTO data_issues (workspace_id, id, rule_id, entity_type, entity_id, property_id, detected_at, severity, evidence, suggested_fix) VALUES ('base', 'di-end', 'leases.past_end_date', 'leases', 'l2', 'p01', '2026-11-01', 'warn', '{}', ?)").run(JSON.stringify({
      options: [{ label: "Mark as ended", changes: { status: "Expired" }, why: "The resident moved out" }, { label: "Switch to month-to-month", changes: { status: "Month-to-month" }, why: "The resident stays on" }],
      why: ["The lease ended Jul 31, 2026 but is still marked Active"], confidence: 0.85, source: "rule",
    }));
    return f;
  }

  it("shows both choices with before and after, and the manual next step", async () => {
    const f = pastEnd();
    const issue = (await issuesPage({ db: f.db, ws: WS, actor: MARCUS }, { issue: "di-end" })).rows[0] as unknown as Issue;
    const p = fixPreviewProps(issue, async () => null);
    expect(p.onApply).toBeUndefined();
    expect(p.nextStep?.text).toBe(NEXT_STEP["leases.past_end_date"]);
    expect(p.needsPerson).toMatch(/approvals inbox/);
    expect(p.choices?.map((c) => [c.label, c.changes])).toEqual([
      ["Mark as ended", [{ field: "status", label: "Status", before: "Active", after: "Expired" }]],
      ["Switch to month-to-month", [{ field: "status", label: "Status", before: "Active", after: "Month-to-month" }]],
    ]);
  });

  it("needs a choice, queues the chosen status change for a person, and applies it only on approval", async () => {
    const f = pastEnd();
    const data = { db: f.db, ws: WS, actor: MARCUS };
    const marcus = getPersona("marcus")!;
    expect((await applyFixes(data, marcus, ["di-end"], { safeOnly: false })).results[0]).toMatchObject({ ok: false, message: "Choose a fix first: Mark as ended or Switch to month-to-month" });
    expect(await issueTargets(data, {}, "safe")).toMatchObject({ ids: expect.not.arrayContaining(["di-end"]) });
    expect(await issueTargets(data, {}, "send")).toMatchObject({ ids: expect.not.arrayContaining(["di-end"]) });
    const r = await applyFixes(data, marcus, ["di-end"], { safeOnly: false, option: 1 });
    expect(r.results[0]).toMatchObject({ ok: false, queued: true });
    const row = f.raw.prepare("SELECT * FROM ai_proposals WHERE workspace_id = ? AND id = ?").get(WS, r.results[0].proposalId!) as Record<string, unknown>;
    expect(row).toMatchObject({ assignee_role: "property_manager", risk: "High", title: "Fix: past end date on leases l2 (Switch to month-to-month)" });
    expect((await get(data, "leases", "l2"))?.status).toBe("Active");
    expect(await executeProposal(data, row, { id: "marcus", name: "Marcus Bell" })).toMatchObject({ ok: true });
    expect((await get(data, "leases", "l2"))?.status).toBe("Month-to-month");
    expect((await get(data, "data_issues", "di-end"))?.status).toBe("fixed");
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
    expect(f.raw.prepare("SELECT count(*) AS n FROM ai_decisions WHERE workspace_id = ? AND decision = 'Approved'").get(WS)).toMatchObject({ n: 31 });
    // A proposal that lost the race is closed (Rejected, noted as superseded), so nothing is left waiting.
    expect(f.raw.prepare("SELECT count(*) AS n FROM ai_proposals p WHERE workspace_id = ? AND entity_type = 'data_issues' AND NOT EXISTS (SELECT 1 FROM ai_decisions d WHERE d.workspace_id = p.workspace_id AND d.proposal_id = p.id)").get(WS)).toMatchObject({ n: 0 });
    const lena = { db: f.db, ws: WS, actor: actorOf("lena") };
    const send = await issueTargets(lena, { rule: "leases.rent_outlier" }, "send");
    const r = await applyFixes(lena, getPersona("lena")!, send.ids, { safeOnly: false });
    expect(r.queued).toBe(1);
    expect(await issueTargets(lena, { rule: "leases.rent_outlier" }, "send")).toMatchObject({ count: 0 });
  });
});
