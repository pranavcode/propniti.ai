import { beforeEach, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import { getAction } from "@/extensions/actions";
import type { ActionResult } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { actorFor } from "@/server/permissions";
import { getRow, updateRecord } from "@/server/query";
import { emptyDb, seed, WS } from "@/server/query.fixture";

// Maintenance actions on the visitor overlay: double clicks change things once, money moves once.

let db: Db;
const NOW = Date.parse("2026-10-28T15:00:00Z");

async function act(key: string, id: string, input: unknown = {}, persona = "tom"): Promise<ActionResult> {
  const actor = await actorFor(db, WS, getPersona(persona)!);
  const a = getAction(key)!;
  const row = await getRow({ db, ws: WS, actor }, a.entity, id);
  if (!row) return { status: 404, error: "not in scope" };
  if (a.when && !a.when(row)) return { status: 409, error: "not available" };
  return a.handler({ db, ws: WS, actor, nowMs: NOW }, row, a.input ? a.input.parse(input) : input);
}
const twice = async (f: () => Promise<ActionResult>) => (await Promise.all([f(), f()])).map((r) => r.status).sort();

beforeEach(async () => {
  db = emptyDb();
  await seed(db);
  await db.batch([
    db.prepare("INSERT INTO vendors (workspace_id, id, company, trade, metros, status, rating) VALUES ('base', 'v01', 'Lone Star Plumbing', 'Plumbing', '[\"Austin\"]', 'Active', 4.6), ('base', 'v02', 'Lapsed Plumbing', 'Plumbing', '[\"Austin\"]', 'Active', 4.9)"),
    db.prepare("INSERT INTO vendor_cois (workspace_id, id, vendor_id, carrier, gl_limit_cents, expires_on, status) VALUES ('base', 'coi-v01', 'v01', 'Hartwell', 100000000, '2027-06-30', 'Valid'), ('base', 'coi-v02', 'v02', 'Hartwell', 100000000, '2026-09-30', 'Expired')"),
    db.prepare("INSERT INTO approval_policies (workspace_id, id, owner_entity_id, category, limit_cents, approver_role, owner_approval_over_cents) VALUES ('base', 'pol-org-maintenance-spend', NULL, 'Maintenance spend', 75000, 'property_manager', 250000)"),
    db.prepare("INSERT INTO base_balances (account_id, cleared_cents) VALUES ('ba-oe01-trust', 5000000)"),
    db.prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, opened_at, sla_due_at) VALUES ('base', 'WO-1', 'p01', 'Kitchen sink leaking', 'General', 'Normal', 'New', '2026-10-28T09:00:00Z', '2026-10-31T09:00:00Z')"),
    db.prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, vendor_id, opened_at, sla_due_at) VALUES ('base', 'WO-2', 'p01', 'Toilet running', 'Plumbing', 'Normal', 'In progress', 'v01', '2026-10-20T09:00:00Z', '2026-10-23T09:00:00Z')"),
    db.prepare("INSERT INTO purchase_orders (workspace_id, id, property_id, vendor_id, work_order_id, number, status, total_cents, issued_on) VALUES ('base', 'po-1', 'p01', 'v01', 'WO-2', 'PO-5001', 'Open', 30000, '2026-10-21')"),
    db.prepare("INSERT INTO po_lines (workspace_id, id, po_id, gl_account_id, description, unit_cents, amount_cents) VALUES ('base', 'po-1-1', 'po-1', 'gl-6000', 'Labor: Toilet running', 18000, 18000), ('base', 'po-1-2', 'po-1', 'gl-6000', 'Parts and materials', 12000, 12000)"),
    db.prepare("INSERT INTO photos (workspace_id, id, entity_type, entity_id, property_id, url, stage) VALUES ('base', 'ph-2', 'work_orders', 'WO-2', 'p01', '/img/wo/wo-toilet.webp', 'Before')"),
    db.prepare("INSERT INTO staff (workspace_id, id, org_id, name, title, email) VALUES ('base', 't-andre', 'org1', 'Andre Washington', 'Technician', 'a@x.example'), ('base', 't-gus', 'org1', 'Gus Ortega', 'Technician', 'g@x.example')"),
    db.prepare("INSERT INTO role_assignments (workspace_id, id, staff_id, role, scope_kind, scope_id) VALUES ('base', 'ra-1', 't-andre', 'maintenance_supervisor', 'property', 'p01'), ('base', 'ra-2', 't-gus', 'maintenance_supervisor', 'region', 'r-se')"),
    db.prepare("INSERT INTO pm_schedules (workspace_id, id, property_id, name, category, frequency, next_due_on, checklist) VALUES ('base', 'pms-1', 'p01', 'HVAC filter change', 'HVAC', 'Quarterly', '2026-11-01', '[\"Replace filters\"]')"),
  ]);
});

describe("dispatch", () => {
  it("refuses a vendor without current insurance", async () => {
    expect(await act("work_orders.dispatch", "WO-1", { vendor_id: "v02", priority: "Urgent", category: "Plumbing", estimate: 300 })).toMatchObject({ status: 409, error: expect.stringContaining("insurance") });
  });

  it("dispatches once on a double click and holds jobs over the owner's limit", async () => {
    expect(await twice(() => act("work_orders.dispatch", "WO-1", { vendor_id: "v01", priority: "Urgent", category: "Plumbing", estimate: 300 }))).toEqual([200, 409]);
    const n = await db.prepare("SELECT count(*) AS n FROM wo_events WHERE workspace_id = ? AND work_order_id = 'WO-1' AND kind = 'Assigned'").bind(WS).first<{ n: number }>();
    expect(n?.n).toBe(1);
    const wo = await db.prepare("SELECT status, sla_due_at FROM work_orders WHERE workspace_id = ? AND id = 'WO-1'").bind(WS).first<{ status: string; sla_due_at: string }>();
    expect(wo).toMatchObject({ status: "Assigned", sla_due_at: "2026-10-29T09:00:00Z" });
    expect(await act("work_orders.dispatch", "WO-1", { vendor_id: "v01", priority: "Normal", category: "Plumbing", estimate: 3000 })).toMatchObject({ status: 200, message: expect.stringContaining("on hold until the owner approves") });
  });
});

describe("in-house dispatch", () => {
  it("accepts only technicians assigned to the work order's property", async () => {
    expect(await act("work_orders.dispatch", "WO-1", { vendor_id: null, assignee_id: "t-gus", priority: "Normal", category: "Plumbing" })).toMatchObject({ status: 403, error: expect.stringContaining("doesn't work at this property") });
    expect(await act("work_orders.dispatch", "WO-1", { vendor_id: null, assignee_id: "t-nobody", priority: "Normal", category: "Plumbing" })).toMatchObject({ status: 403 });
    expect(await act("work_orders.dispatch", "WO-1", { vendor_id: null, assignee_id: "t-andre", priority: "Normal", category: "Plumbing" })).toMatchObject({ status: 200 });
  });
});

describe("vendor invoice → validate → approve and pay", () => {
  it("records the invoice, flags lines over the PO and pays exactly once", async () => {
    const r = await act("work_orders.submit_invoice", "WO-2", { invoice_number: "LSP-1", lines: [{ description: "Labor", amount: 180 }, { description: "Parts", amount: 120 }, { description: "Trip charge", amount: 45 }], total: 345, source: "manual" });
    expect(r).toMatchObject({ status: 200, message: expect.stringContaining("issue") });
    // Issues found: paying needs a reason.
    expect(await act("work_orders.approve_and_pay", "WO-2", {})).toMatchObject({ status: 409, error: expect.stringContaining("add a short note") });
    expect(await act("work_orders.approve_and_pay", "WO-2", { note: "Trip charge agreed by phone", expected_cents: 30000 })).toMatchObject({ status: 409, error: expect.stringContaining("changed since you opened it") });
    expect(await twice(() => act("work_orders.approve_and_pay", "WO-2", { note: "Trip charge agreed by phone", expected_cents: 34500 }))).toEqual([200, 409]);
    const t = await db.prepare("SELECT count(*) AS n, sum(amount_cents) AS c FROM transfers WHERE workspace_id = ? AND key = 'vendor:WO-2'").bind(WS).first<{ n: number; c: number }>();
    expect(t).toMatchObject({ n: 1, c: 34500 });
  });

  it("vendors can submit their own invoice but never pay it", async () => {
    expect(await act("work_orders.submit_invoice", "WO-2", { invoice_number: "LSP-2", lines: [{ description: "Labor", amount: 180 }, { description: "Parts", amount: 120 }], total: 300, source: "manual" }, "vendor")).toMatchObject({ status: 200 });
    const vendor = await actorFor(db, WS, getPersona("vendor")!);
    expect(getAction("work_orders.approve_and_pay")!.roles).not.toContain(vendor.role);
  });
});

describe("payee is the vendor who invoiced", () => {
  const invoice = { invoice_number: "LSP-9", lines: [{ description: "Labor", amount: 180 }, { description: "Parts", amount: 120 }], total: 300, source: "manual" };
  const paidTo = (vendor: string) => db.prepare("SELECT count(*) AS n FROM transfers WHERE workspace_id = ? AND to_id = ?").bind(WS, vendor).first<{ n: number }>().then((r) => r?.n);

  it("refuses a vendor swap through the record API on a submitted job, and pays nobody", async () => {
    expect(await act("work_orders.submit_invoice", "WO-2", invoice, "vendor")).toMatchObject({ status: 200 });
    const tom = { db, ws: WS, actor: await actorFor(db, WS, getPersona("tom")!), nowMs: NOW };
    await expect(updateRecord(tom, "work_orders", "WO-2", { vendor_id: "v02" })).rejects.toMatchObject({ status: expect.any(Number) });
    await expect(updateRecord(tom, "work_orders", "WO-2", { title: "Toilet running (edited)" })).rejects.toMatchObject({ status: 409 });
    expect((await getRow({ db, ws: WS, actor: tom.actor }, "work_orders", "WO-2"))?.vendor_id).toBe("v01");
  });

  it("pays only the vendor on the latest invoice, checked in SQL", async () => {
    expect(await act("work_orders.submit_invoice", "WO-2", invoice, "vendor")).toMatchObject({ status: 200 });
    // Whatever path changes the job's vendor after the invoice, the payment insert refuses it.
    await db.prepare("UPDATE work_orders SET vendor_id = 'v02' WHERE workspace_id = ? AND id = 'WO-2'").bind(WS).run();
    expect(await act("work_orders.approve_and_pay", "WO-2", { note: "Photos checked on site", expected_cents: 30000 })).toMatchObject({ status: 409 });
    expect(await paidTo("v02")).toBe(0);
    const n = await db.prepare("SELECT count(*) AS n FROM transfers WHERE workspace_id = ? AND key = 'vendor:WO-2'").bind(WS).first<{ n: number }>();
    expect(n?.n).toBe(0);
  });
});

describe("photos, turnovers, preventive schedules", () => {
  it("checks photos against the job's trade", async () => {
    expect(await act("work_orders.check_photos", "WO-2")).toMatchObject({ status: 200, message: expect.stringContaining("all match") });
    expect(await act("work_orders.add_photo", "WO-2", { url: "/img/wo/wo-hvac.webp", stage: "After" })).toMatchObject({ status: 200, message: expect.stringContaining("mismatch") });
  });

  it("creates one preventive work order per schedule until it closes", async () => {
    expect(await twice(() => act("pm_schedules.generate", "pms-1"))).toEqual([200, 409]);
    expect(await act("pm_schedules.generate", "pms-1")).toMatchObject({ status: 409, error: expect.stringContaining("already has an open work order") });
    const s = await db.prepare("SELECT next_due_on FROM pm_schedules WHERE workspace_id = ? AND id = 'pms-1'").bind(WS).first<{ next_due_on: string }>();
    expect(s?.next_due_on).toBe("2027-02-01");
  });
});

describe("invoice photo requirement", () => {
  it("counts only photos on file before the invoice, and vendors can't add photos after it", async () => {
    await act("work_orders.submit_invoice", "WO-2", { invoice_number: "LSP-3", lines: [{ description: "Labor", amount: 180 }, { description: "Parts", amount: 120 }], total: 300, source: "manual" }, "vendor");
    expect(await act("work_orders.add_photo", "WO-2", { url: "/img/wo/wo-toilet.webp", stage: "After" }, "vendor")).toMatchObject({ status: 409 });
    // The seeded before photo has no timestamp, so nothing was on file before the invoice: payment needs a reason.
    expect(await act("work_orders.approve_and_pay", "WO-2", {})).toMatchObject({ status: 409, error: expect.stringContaining("add a short note") });
    // A staff photo added now is accepted but still doesn't satisfy the invoice's requirement.
    expect(await act("work_orders.add_photo", "WO-2", { url: "/img/wo/wo-toilet.webp", stage: "After" })).toMatchObject({ status: 200 });
    expect(await act("work_orders.approve_and_pay", "WO-2", {})).toMatchObject({ status: 409, error: expect.stringContaining("add a short note") });
  });

  it("passes when a photo was on file before the invoice", async () => {
    await db.prepare("UPDATE photos SET taken_at = '2026-10-21T09:00:00Z' WHERE id = 'ph-2'").run();
    await act("work_orders.submit_invoice", "WO-2", { invoice_number: "LSP-4", lines: [{ description: "Labor", amount: 180 }, { description: "Parts", amount: 120 }], total: 300, source: "manual" });
    expect(await act("work_orders.approve_and_pay", "WO-2", { expected_cents: 30000 })).toMatchObject({ status: 200 });
  });
});

describe("dispatch as suggested", () => {
  const suggest = (id: string, wo: string, vendor: string | null, amount: number, conf = 0.86) =>
    db.prepare("INSERT INTO ai_proposals (workspace_id, id, agent, entity_type, entity_id, property_id, action, title, payload, confidence, amount_cents, queue_state, assignee_role, run_id, created_at) VALUES ('base', ?, 'maintenance_triage', 'work_orders', ?, 'p01', 'work_orders.assign_vendor', ?, ?, ?, ?, 'needs_you', 'maintenance_supervisor', 'run-1', '2026-10-28T09:05:00Z')")
      .bind(id, wo, `Assign ${vendor ?? "in-house tech"} to ${wo}`, JSON.stringify({ effects: [{ kind: "update", table: "work_orders", id: wo, changes: vendor ? { status: "Assigned", vendor_id: vendor } : { status: "Assigned" } }] }), conf, amount);
  const wo = (id: string, title = "Leak") => db.prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, opened_at) VALUES ('base', ?, 'p01', ?, 'Plumbing', 'Urgent', 'New', '2026-10-28T09:00:00Z')").bind(id, title);
  const decisions = async (pid: string) => (await db.prepare("SELECT count(*) AS n FROM ai_decisions WHERE workspace_id = ? AND proposal_id = ?").bind(WS, pid).first<{ n: number }>())?.n;

  it("dispatches the suggested vendor once and records the decision", async () => {
    await db.batch([wo("WO-10"), suggest("prop-10", "WO-10", "v01", 30000)]);
    expect(await twice(() => act("work_orders.dispatch_suggested", "WO-10"))).toEqual([200, 409]);
    expect(await db.prepare("SELECT status, vendor_id FROM work_orders WHERE workspace_id = ? AND id = 'WO-10'").bind(WS).first()).toEqual({ status: "Assigned", vendor_id: "v01" });
    expect(await decisions("prop-10")).toBe(1);
  });

  it("follows the approvals rule: approve access dispatches, write access leaves it in Approvals", async () => {
    await db.batch([wo("WO-11"), suggest("prop-11", "WO-11", "v01", 120000)]);
    // Marcus (property manager) has write access to maintenance, not approve: nothing is dispatched
    // and the proposal isn't re-addressed to him or anyone else.
    const r = await act("work_orders.dispatch_suggested", "WO-11", {}, "marcus");
    expect(r).toMatchObject({ status: 202, message: expect.stringContaining("stays in Approvals") });
    expect(await db.prepare("SELECT status FROM work_orders WHERE workspace_id = ? AND id = 'WO-11'").bind(WS).first()).toBeNull();
    expect(await db.prepare("SELECT assignee_role FROM ai_proposals WHERE workspace_id = ? AND id = 'prop-11'").bind(WS).first()).toBeNull();
    expect(await decisions("prop-11")).toBe(0);
    // Tom (maintenance supervisor) has approve access: his click dispatches.
    expect((await act("work_orders.dispatch_suggested", "WO-11")).status).toBe(200);
  });

  it("holds a job over the owner's limit for the owner", async () => {
    await db.batch([wo("WO-12"), suggest("prop-12", "WO-12", "v01", 300000)]);
    expect(await act("work_orders.dispatch_suggested", "WO-12")).toMatchObject({ status: 200, message: expect.stringContaining("on hold until the owner approves") });
  });

  it("checks the confidence threshold on the server for Accept N", async () => {
    await db.batch([wo("WO-17"), suggest("prop-17", "WO-17", "v01", 30000, 0.6)]);
    expect(await act("work_orders.dispatch_suggested", "WO-17", { high_confidence_only: true })).toMatchObject({ status: 409, error: expect.stringContaining("below 80% confidence") });
    // One at a time, a person may still accept a lower-confidence suggestion.
    expect((await act("work_orders.dispatch_suggested", "WO-17")).status).toBe(200);
  });

  it("won't dispatch an uninsured vendor, an in-house suggestion, or a decided one", async () => {
    await db.batch([wo("WO-13"), suggest("prop-13", "WO-13", "v02", 30000), wo("WO-14"), suggest("prop-14", "WO-14", null, 30000), wo("WO-15")]);
    expect(await act("work_orders.dispatch_suggested", "WO-13")).toMatchObject({ status: 409, error: expect.stringContaining("insurance") });
    expect(await act("work_orders.dispatch_suggested", "WO-14")).toMatchObject({ status: 409, error: expect.stringContaining("in-house") });
    expect(await act("work_orders.dispatch_suggested", "WO-15")).toMatchObject({ status: 409, error: expect.stringContaining("no open AI suggestion") });
  });

  it("stays inside the supervisor's scope", async () => {
    await db.batch([db.prepare("INSERT INTO work_orders (workspace_id, id, property_id, title, category, priority, status, opened_at) VALUES ('base', 'WO-16', 'p05', 'Leak', 'Plumbing', 'Urgent', 'New', '2026-10-28T09:00:00Z')"), suggest("prop-16", "WO-16", "v01", 30000)]);
    expect((await act("work_orders.dispatch_suggested", "WO-16")).status).toBe(404);
  });
});

describe("escalate a late make-ready", () => {
  const turn = (id: string, vendor: string | null, target = "2026-10-20") =>
    db.prepare("INSERT INTO turnovers (workspace_id, id, property_id, unit_id, move_out_on, target_ready_on, status, vendor_id) VALUES ('base', ?, 'p01', 'p01-u1', '2026-10-10', ?, 'In progress', ?)").bind(id, target, vendor);

  it("notifies the turn vendor once on a double click, with activity", async () => {
    await db.batch([turn("to-1", "v01")]);
    expect(await twice(() => act("turnovers.escalate", "to-1"))).toEqual([200, 409]);
    expect(await db.prepare("SELECT user_id, href FROM notifications WHERE workspace_id = ? AND entity_type = 'turnovers' AND entity_id = 'to-1'").bind(WS).all().then((r) => r.results)).toEqual([{ user_id: "v01", href: "/portal/vendor/jobs" }]);
    expect((await db.prepare("SELECT count(*) AS n FROM activity_events WHERE workspace_id = ? AND entity_id = 'to-1' AND verb = 'escalated'").bind(WS).first<{ n: number }>())?.n).toBe(1);
  });

  it("needs a turn vendor and a make-ready past its target", async () => {
    await db.batch([turn("to-2", null), turn("to-3", "v01", "2026-12-01")]);
    expect(await act("turnovers.escalate", "to-2")).toMatchObject({ status: 409, error: expect.stringContaining("no turn vendor") });
    expect((await act("turnovers.escalate", "to-3")).status).toBe(409);
  });
});
