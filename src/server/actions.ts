import { existingUnitKeys, importPortfolio, validateRows, type ImportRow } from "@/lib/importer";
import { checkInvoice, money } from "@/lib/mockAi";
import { submissionKey } from "@/lib/names";
import type { Db } from "@/lib/platform/types";
import type { DemoState, ExtractedInvoice, LineItem, RatingSubject, ValidationResult, WorkOrder } from "@/lib/types";
import type { Outcome } from "./money";
import { auditStmt, insertItems, notifyStmt, uid } from "./repo";
import { stamp } from "./workspace";

// The store's non-money actions, one function each, mirroring the old client-side updaters.

export const MAX_WORK_ORDERS = 500;
export const MAX_TENANCIES = 1_000;
const MAX_INVITED = 200;

const ok: Outcome = { status: 200 };
const missing = (what: string): Outcome => ({ status: 404, error: `${what} not found` });
// A vendor can still change an invoice until it is approved.
const EDITABLE = "status IN ('Assigned', 'In progress', 'Submitted', 'Changes requested')";

export async function nudge(db: Db, ws: string, s: DemoState, userId: string, message: string, actor: string, nowMs: number): Promise<Outcome> {
  const user = s.users.find((u) => u.id === userId);
  if (!user) return missing("User");
  const ts = stamp(nowMs);
  await db.batch([notifyStmt(db, ws, userId, message, ts), auditStmt(db, ws, ts, actor, "Nudge sent", `To ${user.name} by ${user.channel}: "${message}"`)]);
  return ok;
}

// A result is kept only if the invoice hasn't changed since it was sent for validation.
export async function setValidation(db: Db, ws: string, s: DemoState, woId: string, v: ValidationResult, forSubmission: string, nowMs: number): Promise<Outcome> {
  const wo = s.workOrders.find((w) => w.id === woId);
  if (!wo) return missing("Work order");
  if (submissionKey(wo) !== forSubmission) return ok;
  const ts = stamp(nowMs);
  const validation = JSON.stringify(v);
  await db.batch([
    db.prepare("UPDATE work_orders SET validation = ?3 WHERE workspace_id = ?1 AND id = ?2 AND submission IS ?4").bind(ws, woId, validation, wo.submission ? JSON.stringify(wo.submission) : null),
    db
      .prepare("INSERT INTO audit (workspace_id, id, ts, actor, action, detail) SELECT ?1, ?2, ?3, 'Agent', 'Invoice validated', ?4 WHERE EXISTS (SELECT 1 FROM work_orders WHERE workspace_id = ?1 AND id = ?5 AND validation IS ?6)")
      .bind(ws, uid("a"), ts, `${woId}: ${v.decision}, confidence ${Math.round(v.confidence * 100)}% (${v.source})`, woId, validation),
  ]);
  return ok;
}

export async function requestChanges(db: Db, ws: string, s: DemoState, woId: string, nowMs: number): Promise<Outcome> {
  const wo = s.workOrders.find((w) => w.id === woId);
  if (!wo) return missing("Work order");
  const vendor = s.vendors.find((v) => v.id === wo.vendorId);
  const issues = wo.validation?.issues.join("; ") || "please check the invoice against the PO";
  const ts = stamp(nowMs);
  const { meta } = await db.prepare("UPDATE work_orders SET status = 'Changes requested' WHERE workspace_id = ?1 AND id = ?2 AND status = 'Submitted'").bind(ws, woId).run();
  if (!meta.changes) return { status: 409, error: `Only submitted work can be sent back (this one is ${wo.status.toLowerCase()})` };
  await db.batch([
    ...(vendor ? [notifyStmt(db, ws, vendor.userId, `${woId} needs changes before payment: ${issues}. Please resubmit.`, ts)] : []),
    auditStmt(db, ws, ts, "Maya Patel", "Changes requested", `${woId} sent back to ${vendor?.company}`),
  ]);
  return ok;
}

async function replaceSubmission(db: Db, ws: string, woId: string, submission: NonNullable<WorkOrder["submission"]>) {
  const { meta } = await db
    .prepare(`UPDATE work_orders SET status = 'Submitted', validation = NULL, submission = ?3 WHERE workspace_id = ?1 AND id = ?2 AND ${EDITABLE}`)
    .bind(ws, woId, JSON.stringify(submission))
    .run();
  return meta.changes > 0;
}

export async function submitInvoice(db: Db, ws: string, s: DemoState, woId: string, items: LineItem[], photos: string[], invoiceNumber: string | undefined, nowMs: number): Promise<Outcome> {
  const wo = s.workOrders.find((w) => w.id === woId);
  if (!wo) return missing("Work order");
  const total = Math.round(items.reduce((a, i) => a + i.amount, 0) * 100) / 100;
  const company = s.vendors.find((v) => v.id === wo.vendorId)?.company;
  if (!(await replaceSubmission(db, ws, woId, { invoiceNumber: invoiceNumber || `INV-${Math.floor(Math.random() * 9000) + 1000}`, items, total, photos }))) {
    return { status: 409, error: `${woId} can't be changed now (it is ${wo.status.toLowerCase()})` };
  }
  const ts = stamp(nowMs);
  await db.batch([
    notifyStmt(db, ws, "u-pm", `${company} submitted an invoice for ${woId}: ${money(total)}.`, ts),
    auditStmt(db, ws, ts, company ?? "Vendor", "Invoice submitted", `${woId}: ${money(total)}, ${photos.length} photo(s)`),
  ]);
  return ok;
}

// A paper/PDF invoice read by AI replaces the submitted figures; validation must run again.
// The same consistency checks that block Apply in the browser are enforced here (legibility
// is the one the user may override).
export async function attachDocument(db: Db, ws: string, s: DemoState, woId: string, inv: ExtractedInvoice, nowMs: number): Promise<Outcome> {
  const wo = s.workOrders.find((w) => w.id === woId);
  if (!wo) return missing("Work order");
  const failed = checkInvoice(inv).filter((c) => !c.ok && !c.label.startsWith("Legible"));
  if (failed.length || !inv.lineItems.length) return { status: 409, error: `This invoice failed its checks (${failed.map((c) => c.label).join("; ") || "no line items"}). Fix it with the vendor first.` };
  const submission = { invoiceNumber: inv.invoiceNumber || "scanned", items: inv.lineItems, total: inv.total, photos: wo.submission?.photos ?? [] };
  if (!(await replaceSubmission(db, ws, woId, submission))) return { status: 409, error: `${woId} can't be changed now (it is ${wo.status.toLowerCase()})` };
  await auditStmt(db, ws, stamp(nowMs), "Agent", "Invoice document read", `${woId}: ${inv.vendor || "vendor"} invoice ${inv.invoiceNumber || ""}, total ${money(inv.total)}`).run();
  return ok;
}

// In-house maintenance jobs: start, add photos, complete.
export async function updateJob(db: Db, ws: string, s: DemoState, woId: string, status: WorkOrder["status"], photo: string | undefined, nowMs: number): Promise<Outcome> {
  const wo = s.workOrders.find((w) => w.id === woId && w.vendorId === "in-house");
  if (!wo) return missing("In-house job");
  const photos = photo ? [...(wo.submission?.photos ?? []), photo] : (wo.submission?.photos ?? []);
  const submission = photo || wo.submission ? JSON.stringify({ invoiceNumber: "in-house", items: wo.po.items, total: wo.po.total, photos }) : null;
  const { meta } = await db
    .prepare(`UPDATE work_orders SET status = ?3, submission = ?4 WHERE workspace_id = ?1 AND id = ?2 AND vendor_id IS NULL AND ${EDITABLE} AND submission IS ?5`)
    .bind(ws, woId, status, submission, wo.submission ? JSON.stringify(wo.submission) : null)
    .run();
  if (!meta.changes) return { status: 409, error: `${woId} changed or is already finished. Refresh and try again.` };
  await auditStmt(db, ws, stamp(nowMs), "Luis Romero", "Job updated", `${woId}: ${status}${photo ? ` with photo "${photo}"` : ""}`).run();
  return ok;
}

// New in-house job. Its number comes from the workspace counter, bumped in the same batch.
export async function reportIssue(db: Db, ws: string, s: DemoState, tenantId: string, text: string, nowMs: number): Promise<Outcome> {
  const t = s.tenancies.find((x) => x.tenantId === tenantId);
  const tenant = s.users.find((u) => u.id === tenantId);
  if (!t || !tenant) return missing("Tenancy");
  if (s.workOrders.length >= MAX_WORK_ORDERS) return { status: 409, error: `This demo is limited to ${MAX_WORK_ORDERS} work orders. Reset it to start over.` };
  const ts = stamp(nowMs);
  const po = JSON.stringify({ number: "PO-pending", items: [{ description: "Diagnosis", amount: 0 }], total: 0, photosRequired: 1 });
  const woId = "('WO-' || (SELECT wo_seq - 1 FROM workspaces WHERE id = ?1))";
  const created = `EXISTS (SELECT 1 FROM work_orders WHERE workspace_id = ?1 AND id = ${woId})`;
  const [, insert] = await db.batch([
    db.prepare("UPDATE workspaces SET wo_seq = wo_seq + 1 WHERE id = ?1").bind(ws),
    db
      .prepare(
        `INSERT INTO work_orders (workspace_id, id, property_id, unit, title, vendor_id, assignee_id, estimated_hours, status, po)
         SELECT ?1, ${woId}, ?2, ?3, ?4, NULL, 'u-m1', 1, 'Assigned', ?5 WHERE (SELECT count(*) FROM work_orders WHERE workspace_id = ?1) < ${MAX_WORK_ORDERS}`,
      )
      .bind(ws, t.propertyId, t.unit, text, po),
    db.prepare(`INSERT INTO notifications (workspace_id, id, user_id, channel, message, ts) SELECT ?1, ?2, id, channel, 'New job ' || ${woId} || ' at ' || ?3 || ': ' || ?4, ?5 FROM users WHERE workspace_id = ?1 AND id = 'u-m1' AND ${created}`).bind(ws, uid("n"), t.unit, text, ts),
    db.prepare(`INSERT INTO notifications (workspace_id, id, user_id, channel, message, ts) SELECT ?1, ?2, id, channel, 'Thanks — ' || ${woId} || ' is logged and assigned to Luis from maintenance.', ?4 FROM users WHERE workspace_id = ?1 AND id = ?3 AND ${created}`).bind(ws, uid("n"), tenantId, ts),
    db.prepare(`INSERT INTO audit (workspace_id, id, ts, actor, action, detail) SELECT ?1, ?2, ?3, ?4, 'Issue reported', ${woId} || ': ' || ?5 WHERE ${created}`).bind(ws, uid("a"), ts, tenant.name, text),
  ]);
  return insert.meta.changes ? ok : { status: 409, error: `This demo is limited to ${MAX_WORK_ORDERS} work orders. Reset it to start over.` };
}

// One rating per person, subject and job: rating again replaces the earlier one.
export async function rate(db: Db, ws: string, s: DemoState, by: string, subject: RatingSubject, stars: number, comment: string, ref: string | undefined, nowMs: number): Promise<Outcome> {
  const rater = s.users.find((u) => u.id === by);
  if (!rater) return missing("User");
  const ts = stamp(nowMs);
  await db.batch([
    db.prepare("DELETE FROM ratings WHERE workspace_id = ?1 AND by_id = ?2 AND subject_kind = ?3 AND subject_id = ?4 AND ref = ?5").bind(ws, by, subject.kind, subject.id, ref ?? ""),
    insertItems(db, "ratings", ws, [{ id: uid("r"), by, subject, stars, comment: comment.trim(), ref, ts }]),
    auditStmt(db, ws, ts, rater.name, "Rating", `${stars}★ for ${subject.kind} ${subject.id}${ref ? ` (${ref})` : ""}`),
  ]);
  return ok;
}

// Rows are checked again here (the preview ran in the browser), then merged by the importer.
// The unique (property, unit) index stops two imports racing into duplicates.
export async function importRows(db: Db, ws: string, s: DemoState, rows: ImportRow[], source: string, nowMs: number): Promise<Outcome> {
  const valid = validateRows(rows, existingUnitKeys(s)).filter((c) => !c.errors.length).map((c) => c.row);
  if (s.tenancies.length + valid.length > MAX_TENANCIES) return { status: 409, error: `This demo is limited to ${MAX_TENANCIES} tenancies.` };
  const { state, counts } = importPortfolio(s, valid);
  const added = <T extends { id: string }>(before: T[], after: T[]) => after.filter((x) => !before.some((b) => b.id === x.id));
  const ts = stamp(nowMs);
  const newUsers = added(s.users, state.users);
  const newProps = added(s.properties, state.properties);
  const grown = state.properties.filter((p) => s.properties.some((b) => b.id === p.id && b.units !== p.units));
  const statements = [
    ...(newUsers.length ? [insertItems(db, "users", ws, newUsers)] : []),
    ...(newProps.length ? [insertItems(db, "properties", ws, newProps)] : []),
    ...grown.map((p) => {
      const before = s.properties.find((b) => b.id === p.id)!;
      return db.prepare("UPDATE properties SET units = units + ?3, occupied = occupied + ?4 WHERE workspace_id = ?1 AND id = ?2").bind(ws, p.id, p.units - before.units, p.occupied - before.occupied);
    }),
    ...(counts.tenancies ? [insertItems(db, "tenancies", ws, added(s.tenancies, state.tenancies)), insertItems(db, "invoices", ws, added(s.invoices, state.invoices))] : []),
    db.prepare("UPDATE workspaces SET imported_rows = imported_rows + ?2 WHERE id = ?1").bind(ws, counts.tenancies),
    auditStmt(db, ws, ts, "Maya Patel", "Portfolio imported", `${counts.tenancies} tenancies, ${counts.properties} new properties from ${source}`),
  ];
  try {
    await db.batch(statements);
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return { status: 409, error: "Some of these units were just added. Refresh and import again." };
    throw e;
  }
  return ok;
}

export async function connectBank(db: Db, ws: string, bank: string, nowMs: number): Promise<Outcome> {
  await db.batch([
    db.prepare("UPDATE workspaces SET bank = ?2 WHERE id = ?1").bind(ws, bank),
    auditStmt(db, ws, stamp(nowMs), "Maya Patel", "Bank connected", `${bank} trust account linked (simulated Plaid)`),
  ]);
  return ok;
}

export async function invite(db: Db, ws: string, s: DemoState, emails: string[], nowMs: number): Promise<Outcome> {
  const invited = [...(s.setup?.invited ?? []), ...emails];
  if (invited.length > MAX_INVITED) return { status: 409, error: `This demo is limited to ${MAX_INVITED} invites.` };
  await db.batch([
    db.prepare("UPDATE workspaces SET invited = ?2 WHERE id = ?1").bind(ws, JSON.stringify(invited)),
    auditStmt(db, ws, stamp(nowMs), "Maya Patel", "Invites sent", `${emails.length} invite(s): ${emails.join(", ")}`),
  ]);
  return ok;
}

export async function finishOnboarding(db: Db, ws: string): Promise<Outcome> {
  await db.prepare("UPDATE workspaces SET setup_completed = 1 WHERE id = ?1").bind(ws).run();
  return ok;
}
