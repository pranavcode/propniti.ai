import "server-only";
import { AS_OF } from "@/seed/constants";
import { row, rows, type PortalCtx } from "./context";

// Reads for the vendor portal, always filtered by vendor_id / to_id = the vendor's own id.

export type Job = {
  id: string; title: string; description: string; category: string; priority: string; status: string; property_id: string; property: string; photos: string; street: string; city: string;
  unit: string | null; sla_due_at: string | null; opened_at: string; scheduled_at: string | null; completed_at: string | null; estimate_cents: number | null; cost_cents: number | null; permission_to_enter: number; invoiced: number; owner_declined: number;
};

export const JOB_TABS = {
  new: { label: "New", statuses: ["Assigned"] },
  active: { label: "Scheduled", statuses: ["Scheduled", "In progress", "On hold"] },
  invoice: { label: "To invoice", statuses: ["Completed"] },
  done: { label: "Done", statuses: ["Submitted", "Paid", "Cancelled"] },
} as const;
export type JobTab = keyof typeof JOB_TABS;

const JOB_COLS = `w.id, w.title, w.description, w.category, w.priority, w.status, w.property_id, p.name AS property, p.photos, p.street, p.city, u.number AS unit, w.sla_due_at, w.opened_at, w.scheduled_at, w.completed_at, w.estimate_cents, w.cost_cents, w.permission_to_enter,
  EXISTS (SELECT 1 FROM {wo_events} e WHERE e.work_order_id = w.id AND e.kind = 'Submission') AS invoiced,
  EXISTS (SELECT 1 FROM {wo_events} e WHERE e.work_order_id = w.id AND e.kind = 'Approval' AND e.actor_kind = 'owner' AND json_extract(e.detail, '$.decision') = 'Declined') AS owner_declined`;
const JOB_FROM = "FROM {work_orders} w JOIN {properties} p ON p.id = w.property_id LEFT JOIN {units} u ON u.id = w.unit_id";

export async function jobCounts(c: PortalCtx) {
  const r = await rows<{ status: string; n: number; invoiced: number }>(c, `SELECT w.status, count(*) AS n, sum(EXISTS (SELECT 1 FROM {wo_events} e WHERE e.work_order_id = w.id AND e.kind = 'Submission')) AS invoiced FROM {work_orders} w WHERE w.vendor_id = ? GROUP BY w.status`, c.me);
  const count = (t: JobTab) => r.filter((x) => (JOB_TABS[t].statuses as readonly string[]).includes(x.status)).reduce((a, x) => a + x.n - (t === "invoice" ? x.invoiced : 0), 0);
  return { new: count("new"), active: count("active"), invoice: count("invoice"), done: count("done") } as Record<JobTab, number>;
}

export async function jobs(c: PortalCtx, tab: JobTab, page = 1, size = 25) {
  const statuses = JSON.stringify(JOB_TABS[tab].statuses);
  const extra = tab === "invoice" ? " AND NOT EXISTS (SELECT 1 FROM {wo_events} e WHERE e.work_order_id = w.id AND e.kind = 'Submission')" : "";
  const order = tab === "done" ? "coalesce(w.completed_at, w.opened_at) DESC" : "coalesce(w.scheduled_at, w.sla_due_at, w.opened_at)";
  const [list, total] = await Promise.all([
    rows<Job>(c, `SELECT ${JOB_COLS} ${JOB_FROM} WHERE w.vendor_id = ? AND w.status IN (SELECT value FROM json_each(?))${extra} ORDER BY ${order}, w.id LIMIT ? OFFSET ?`, c.me, statuses, size, (page - 1) * size),
    row<{ n: number }>(c, `SELECT count(*) AS n FROM {work_orders} w WHERE w.vendor_id = ? AND w.status IN (SELECT value FROM json_each(?))${extra}`, c.me, statuses),
  ]);
  return { rows: list, total: total?.n ?? 0, page, size };
}

export async function job(c: PortalCtx, id: string) {
  const j = await row<Job>(c, `SELECT ${JOB_COLS} ${JOB_FROM} WHERE w.id = ? AND w.vendor_id = ?`, id, c.me);
  if (!j) return null;
  const [events, photos] = await Promise.all([
    rows<{ id: string; at: string; actor_kind: string; kind: string; status: string | null; detail: string }>(c, "SELECT e.id, e.at, e.actor_kind, e.kind, e.status, e.detail FROM {wo_events} e WHERE e.work_order_id = ? ORDER BY e.at", id),
    rows<{ url: string; caption: string; stage: string | null }>(c, "SELECT ph.url, ph.caption, ph.stage FROM {photos} ph WHERE ph.entity_type = 'work_orders' AND ph.entity_id = ? ORDER BY ph.taken_at", id),
  ]);
  return { ...j, events, photos };
}

export type Invoice = { work_order_id: string; title: string; property: string; at: string; invoice_number: string; total_cents: number; status: string; source: string | null };

// Invoices the vendor sent through the portal (work-order submissions) and bills on file.
export async function invoices(c: PortalCtx, page = 1, size = 25) {
  const list = await rows<Invoice>(c, `SELECT * FROM (
      SELECT e.work_order_id, w.title, p.name AS property, e.at, coalesce(json_extract(e.detail, '$.invoice_number'), 'Job ' || w.id) AS invoice_number, json_extract(e.detail, '$.total_cents') AS total_cents,
        CASE WHEN EXISTS (SELECT 1 FROM {transfers} t WHERE t.key = 'vendor:' || w.id AND t.status = 'Cleared') THEN 'Paid'
             WHEN EXISTS (SELECT 1 FROM {transfers} t WHERE t.key = 'vendor:' || w.id AND t.status = 'Pending') THEN 'On its way'
             WHEN w.status = 'Submitted' THEN 'Awaiting approval' ELSE w.status END AS status,
        json_extract(e.detail, '$.read.source') AS source
      FROM {wo_events} e JOIN {work_orders} w ON w.id = e.work_order_id JOIN {properties} p ON p.id = w.property_id
      -- A submission that already became a bill is listed once, as the bill.
      WHERE e.kind = 'Submission' AND w.vendor_id = ?1 AND NOT EXISTS (SELECT 1 FROM {bills} b2 WHERE b2.work_order_id = w.id AND b2.vendor_id = ?1)
      UNION ALL
      SELECT b.work_order_id, coalesce(w.title, 'Bill ' || b.id), p.name, b.bill_date, b.invoice_number, b.amount_cents,
        CASE WHEN EXISTS (SELECT 1 FROM {transfers} t WHERE t.key = 'vendor:' || b.id AND t.status = 'Cleared') THEN 'Paid' WHEN b.status = 'Scheduled' THEN 'On its way' WHEN b.status = 'Pending approval' THEN 'Awaiting approval' ELSE b.status END, NULL
      FROM {bills} b JOIN {properties} p ON p.id = b.property_id LEFT JOIN {work_orders} w ON w.id = b.work_order_id
      WHERE b.vendor_id = ?1 AND b.status <> 'Void'
    ) ORDER BY at DESC LIMIT ?2 OFFSET ?3`, c.me, size, (page - 1) * size);
  const totals = await row<{ n: number; unpaid: number }>(c, `SELECT count(*) AS n, coalesce(sum(CASE WHEN b.status IN ('Pending approval', 'Approved', 'Draft') THEN b.amount_cents END), 0)
      + coalesce((SELECT sum(json_extract(e.detail, '$.total_cents')) FROM {wo_events} e JOIN {work_orders} w ON w.id = e.work_order_id WHERE e.kind = 'Submission' AND w.vendor_id = ?1 AND w.status = 'Submitted' AND NOT EXISTS (SELECT 1 FROM {bills} b2 WHERE b2.work_order_id = w.id)), 0) AS unpaid
    FROM {bills} b WHERE b.vendor_id = ?1 AND b.status <> 'Void'`, c.me);
  return { rows: list, total: (totals?.n ?? 0) + (await row<{ n: number }>(c, "SELECT count(*) AS n FROM {wo_events} e JOIN {work_orders} w ON w.id = e.work_order_id WHERE e.kind = 'Submission' AND w.vendor_id = ? AND NOT EXISTS (SELECT 1 FROM {bills} b2 WHERE b2.work_order_id = w.id AND b2.vendor_id = w.vendor_id)", c.me))!.n, unpaid_cents: totals?.unpaid ?? 0, page, size };
}

export async function payouts(c: PortalCtx, page = 1, size = 25) {
  const year = AS_OF.slice(0, 4);
  const [list, sums] = await Promise.all([
    rows<{ id: string; ref: string; amount_cents: number; status: string; created: string; cleared: string | null; property: string; from_name: string }>(c,
      `SELECT t.id, t.ref, t.amount_cents, t.status, t.created, t.cleared, p.name AS property, t.from_name FROM {transfers} t LEFT JOIN {properties} p ON p.id = t.property_id
       WHERE t.kind = 'Vendor payout' AND t.to_id = ? AND t.status <> 'Returned' ORDER BY t.created DESC LIMIT ? OFFSET ?`, c.me, size, (page - 1) * size),
    row<{ n: number; ytd: number; pending: number; last: string | null }>(c,
      `SELECT count(*) AS n, coalesce(sum(CASE WHEN substr(t.created, 1, 4) = ? THEN t.amount_cents END), 0) AS ytd, coalesce(sum(CASE WHEN t.status = 'Pending' THEN t.amount_cents END), 0) AS pending, max(t.created) AS last
       FROM {transfers} t WHERE t.kind = 'Vendor payout' AND t.to_id = ? AND t.status <> 'Returned'`, year, c.me),
  ]);
  return { rows: list, total: sums?.n ?? 0, ytd_cents: sums?.ytd ?? 0, pending_cents: sums?.pending ?? 0, last: sums?.last ?? null, year, page, size };
}

export async function forms1099(c: PortalCtx) {
  return rows<{ id: string; year: number; amount_cents: number; status: string; filed_on: string | null; payer: string }>(c,
    "SELECT f.id, f.year, f.amount_cents, f.status, f.filed_on, e.name AS payer FROM {vendor_1099s} f JOIN {owner_entities} e ON e.id = f.owner_entity_id WHERE f.vendor_id = ? ORDER BY f.year DESC, e.name", c.me);
}

// What was paid per payer entity in a calendar year: the 1099-NEC box 1 figure the forms are filed from.
export async function paidByPayer(c: PortalCtx, year: string) {
  return rows<{ owner_entity_id: string; payer: string; amount_cents: number }>(c,
    `SELECT t.owner_entity_id, e.name AS payer, sum(t.amount_cents) AS amount_cents FROM {transfers} t JOIN {owner_entities} e ON e.id = t.owner_entity_id
     WHERE t.kind = 'Vendor payout' AND t.to_id = ? AND t.status = 'Cleared' AND substr(t.created, 1, 4) = ? GROUP BY t.owner_entity_id ORDER BY amount_cents DESC`, c.me, year);
}

export type Coi = { id: string; carrier: string; gl_limit_cents: number; workers_comp: number; expires_on: string; status: string; days: number };

export async function cois(c: PortalCtx) {
  return rows<Coi>(c, `SELECT k.id, k.carrier, k.gl_limit_cents, k.workers_comp, k.expires_on,
      CASE WHEN k.expires_on < ?2 THEN 'Expired' WHEN julianday(k.expires_on) - julianday(?2) <= 30 THEN 'Expiring' ELSE 'Valid' END AS status,
      CAST(julianday(k.expires_on) - julianday(?2) AS INTEGER) AS days
    FROM {vendor_cois} k WHERE k.vendor_id = ?1 ORDER BY k.expires_on DESC LIMIT 20`, c.me, AS_OF);
}

export async function vendorMe(c: PortalCtx) {
  return row<{ id: string; company: string; trade: string; contact_name: string; rating: number | null; w9_on_file: number; bank_last4: string }>(c, "SELECT v.id, v.company, v.trade, v.contact_name, v.rating, v.w9_on_file, v.bank_last4 FROM {vendors} v WHERE v.id = ?", c.me);
}
