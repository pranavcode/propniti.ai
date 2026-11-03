import { beforeEach, describe, expect, it } from "vitest";
import "@/entities";
import { getPersona } from "@/auth/personas";
import { getAction } from "@/extensions/actions";
import type { ActionResult } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { actorFor } from "@/server/permissions";
import { getRow } from "@/server/query";
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

describe("vendor invoice → validate → approve and pay", () => {
  it("records the invoice, flags lines over the PO and pays exactly once", async () => {
    const r = await act("work_orders.submit_invoice", "WO-2", { invoice_number: "LSP-1", lines: [{ description: "Labor", amount: 180 }, { description: "Parts", amount: 120 }, { description: "Trip charge", amount: 45 }], total: 345, source: "manual" });
    expect(r).toMatchObject({ status: 200, message: expect.stringContaining("issue") });
    // Issues found: paying needs a reason.
    expect(await act("work_orders.approve_and_pay", "WO-2", {})).toMatchObject({ status: 409, error: expect.stringContaining("add a short note") });
    expect(await twice(() => act("work_orders.approve_and_pay", "WO-2", { note: "Trip charge agreed by phone" }))).toEqual([200, 409]);
    const t = await db.prepare("SELECT count(*) AS n, sum(amount_cents) AS c FROM transfers WHERE workspace_id = ? AND key = 'vendor:WO-2'").bind(WS).first<{ n: number; c: number }>();
    expect(t).toMatchObject({ n: 1, c: 34500 });
  });

  it("vendors can submit their own invoice but never pay it", async () => {
    expect(await act("work_orders.submit_invoice", "WO-2", { invoice_number: "LSP-2", lines: [{ description: "Labor", amount: 180 }, { description: "Parts", amount: 120 }], total: 300, source: "manual" }, "vendor")).toMatchObject({ status: 200 });
    const vendor = await actorFor(db, WS, getPersona("vendor")!);
    expect(getAction("work_orders.approve_and_pay")!.roles).not.toContain(vendor.role);
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
