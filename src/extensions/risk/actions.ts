import { z } from "zod";
import { BadgeCheck, BadgeX, BellRing, CircleCheck } from "lucide-react";
import type { ActionContext, ActionResult, Role, Row } from "@/entities/types";
import { AS_OF } from "@/seed/constants";
import { overlayUpsertSql } from "@/server/effective";
import { demoNowIso } from "@/lib/clock";
import { registerAction } from "../actions";
import { formatAsOf, formatDate } from "@/lib/format";

const RISK_WRITE: Role[] = ["principal", "regional_manager", "property_manager", "maintenance_supervisor"];
const rid = () => crypto.randomUUID();
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const activity = (ws: string, entity: string, id: string, propertyId: unknown, at: string, actorId: string, verb: string, summary: string) => ({
  sql: "INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, ?, ?, '{}')",
  binds: [ws, rid(), entity, id, propertyId == null ? null : String(propertyId), at, actorId, verb, summary],
});

// Asks the vendor for a current certificate: a notification in their portal and an activity entry
// on the vendor (and the certificate, when there is one). No money moves and nothing is sent
// outside the demo. A vendor is asked at most once every REQUEST_DAYS days: the notification
// insert is the guard, and the activity rows run only if it landed, so a double click or a
// "Request all" that overlaps a single request asks once.
export const REQUEST_DAYS = 7;
const REQUEST_TITLE = "Upload a current certificate of insurance";
const LAPSING = ["Expiring", "Expired", "Missing", "Rejected"];

async function requestCertificate(ctx: ActionContext, vendor: string, company: string, when: string, coiId: string | null): Promise<ActionResult> {
  const at = demoNowIso(ctx.nowMs);
  const since = new Date(Date.parse(at) - REQUEST_DAYS * 86_400_000).toISOString();
  const recent = "SELECT max(n.at) AS at FROM notifications n WHERE n.workspace_id IN (?1, 'base') AND n.user_id = ?2 AND n.title = ?3 AND n.at >= ?4";
  const gate = rid();
  // Activity rows run only if this request's notification landed.
  const after = (entity: string, id: string, summary: string) => ({
    sql: "INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) SELECT ?, ?, ?, ?, NULL, ?, 'staff', ?, 'requested', ?, '{}' WHERE EXISTS (SELECT 1 FROM notifications WHERE workspace_id = ? AND id = ?)",
    binds: [ctx.ws, rid(), entity, id, at, ctx.actor.personaId, summary, ctx.ws, gate],
  });
  const stmts = [
    { sql: `INSERT INTO notifications (workspace_id, id, user_id, channel, title, body, href, entity_type, entity_id, at) SELECT ?1, ?5, ?2, 'In-app', ?3, ?6, '/portal/vendor/insurance', ?7, ?8, ?9 WHERE (${recent}) IS NULL`,
      binds: [ctx.ws, vendor, REQUEST_TITLE, since, gate, `Your certificate on file ${when}. Upload a renewed certificate so we can keep assigning you work.`, coiId ? "vendor_cois" : "vendors", coiId ?? vendor, at] },
    after("vendors", vendor, `${ctx.actor.name} asked for a current certificate of insurance`),
    ...(coiId ? [after("vendor_cois", coiId, `${ctx.actor.name} asked ${company} for a current certificate`)] : []),
  ];
  const [res] = await ctx.db.batch(stmts.map((s) => ctx.db.prepare(s.sql).bind(...s.binds)));
  if (!res.meta.changes) {
    const last = await ctx.db.prepare(recent).bind(ctx.ws, vendor, REQUEST_TITLE, since).first<{ at: string | null }>();
    const on = (last?.at ?? at).slice(0, 10);
    return { status: 409, error: `${company} was already asked on ${on}. You can ask again after ${REQUEST_DAYS} days.` };
  }
  return { status: 200, message: `Asked ${company} for a current certificate` };
}

registerAction({
  key: "vendor_cois.request_certificate",
  label: "Request certificate",
  entity: "vendor_cois",
  roles: RISK_WRITE,
  icon: BellRing,
  bulk: true,
  when: (r: Row) => LAPSING.includes(String(r.status)),
  confirm: { title: "Ask the vendor for a current certificate?", body: "They get a notification in the vendor portal asking them to upload a renewed certificate of insurance." },
  handler: async (ctx, row) => {
    const when = row.status === "Expiring" ? `expires ${formatDate(String(row.expires_on), "always")}` : row.status === "Missing" ? "is missing" : row.status === "Rejected" ? "was rejected" : `expired ${formatDate(String(row.expires_on), "always")}`;
    return requestCertificate(ctx, String(row.vendor_id), String(row.vendor_id__label ?? row.vendor_id), when, String(row.id));
  },
  help: { summary: `Sends the vendor a portal notification asking for a renewed certificate of insurance. Each vendor is asked at most once every ${REQUEST_DAYS} days.`, article: "vendor-insurance-certificates" },
});

// The same request from the vendor's record, including vendors with no certificate on file at all.
registerAction({
  key: "vendors.request_certificate",
  label: "Request certificate",
  entity: "vendors",
  roles: RISK_WRITE,
  icon: BellRing,
  bulk: true,
  when: (r: Row) => r.status === "Active" && (r.coi_expires == null || String(r.coi_expires) <= addDays(AS_OF, 30)),
  confirm: { title: "Ask the vendor for a current certificate?", body: "They get a notification in the vendor portal asking them to upload a renewed certificate of insurance." },
  handler: async (ctx, row) => {
    const exp = row.coi_expires == null ? null : String(row.coi_expires);
    const when = !exp ? "is missing or not verified yet" : exp < AS_OF ? `expired ${exp}` : `expires ${exp}`;
    return requestCertificate(ctx, String(row.id), String(row.company ?? row.id), when, null);
  },
  help: { summary: `Sends the vendor a portal notification asking for a renewed certificate of insurance. Each vendor is asked at most once every ${REQUEST_DAYS} days.`, article: "vendor-insurance-certificates" },
});

// Certificates a vendor submits stay "Pending verification" until compliance, accounting or admin
// staff check them against the carrier's document. Verifying records the values the reviewer
// confirmed, so what counts for dispatch is never the vendor's own entry.
const COI_COLS = ["id", "deleted", "vendor_id", "document_id", "carrier", "gl_limit_cents", "workers_comp", "expires_on", "status"] as const;
const COI_REVIEWERS: Role[] = [...RISK_WRITE, "accountant", "admin"];
const PENDING = "e.status = 'Pending verification'";

registerAction({
  key: "vendor_cois.verify",
  label: "Verify certificate",
  entity: "vendor_cois",
  roles: COI_REVIEWERS,
  icon: BadgeCheck,
  when: (r: Row) => r.review === "Pending verification",
  input: z.strictObject({
    expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    gl_limit: z.number().finite().min(100_000, "General liability under $100,000 doesn't meet the vendor requirement").max(100_000_000),
    workers_comp: z.boolean(),
  }),
  handler: async (ctx, row, input) => {
    const at = demoNowIso(ctx.nowMs);
    if (input.expires_on <= at.slice(0, 10)) return { status: 400, error: "That certificate has already expired. Reject it and ask the vendor for a current one." };
    const res = await ctx.db.prepare(overlayUpsertSql("vendor_cois", COI_COLS, { status: "'Verified'", expires_on: "?3", gl_limit_cents: "?4", workers_comp: "?5" }, PENDING))
      .bind(ctx.ws, String(row.id), input.expires_on, Math.round(input.gl_limit * 100), input.workers_comp ? 1 : 0).run();
    if (!res.meta.changes) return { status: 409, error: "This certificate was already reviewed" };
    const company = String(row.vendor_id__label ?? row.vendor_id);
    const a = activity(ctx.ws, "vendor_cois", String(row.id), null, at, ctx.actor.personaId, "verified", `${ctx.actor.name} verified the certificate: ${String(row.carrier)}, valid to ${formatAsOf(input.expires_on)}`);
    const b = activity(ctx.ws, "vendors", String(row.vendor_id), null, at, ctx.actor.personaId, "verified", `${ctx.actor.name} verified a certificate of insurance valid to ${formatAsOf(input.expires_on)}`);
    await ctx.db.batch([a, b].map((x) => ctx.db.prepare(x.sql).bind(...x.binds)));
    return { status: 200, message: `Verified ${company}'s certificate, valid to ${formatAsOf(input.expires_on)}` };
  },
  help: { summary: "Confirms the certificate against the carrier's document. Only verified certificates count when dispatching or ranking vendors.", article: "vendor-insurance-certificates" },
});

registerAction({
  key: "vendor_cois.reject",
  label: "Reject certificate",
  entity: "vendor_cois",
  roles: COI_REVIEWERS,
  icon: BadgeX,
  when: (r: Row) => r.review === "Pending verification",
  input: z.strictObject({ reason: z.string().trim().min(5, "Tell the vendor what to fix").max(500) }),
  handler: async (ctx, row, input) => {
    const at = demoNowIso(ctx.nowMs);
    const res = await ctx.db.prepare(overlayUpsertSql("vendor_cois", COI_COLS, { status: "'Rejected'" }, PENDING)).bind(ctx.ws, String(row.id)).run();
    if (!res.meta.changes) return { status: 409, error: "This certificate was already reviewed" };
    const vendor = String(row.vendor_id);
    const stmts = [
      { sql: "INSERT INTO notifications (workspace_id, id, user_id, channel, title, body, href, entity_type, entity_id, at) VALUES (?, ?, ?, 'In-app', ?, ?, '/portal/vendor', 'vendor_cois', ?, ?)",
        binds: [ctx.ws, rid(), vendor, "Your insurance certificate needs changes", input.reason, String(row.id), at] },
      activity(ctx.ws, "vendor_cois", String(row.id), null, at, ctx.actor.personaId, "rejected", `${ctx.actor.name} rejected the certificate: ${input.reason}`),
    ];
    await ctx.db.batch(stmts.map((x) => ctx.db.prepare(x.sql).bind(...x.binds)));
    return { status: 200, message: "Rejected; the vendor was told what to fix" };
  },
  help: { summary: "Sends the certificate back to the vendor with the reason. It never counts as insurance.", article: "vendor-insurance-certificates" },
});

const COMPLIANCE_COLS = ["id", "deleted", "property_id", "staff_id", "kind", "title", "due_on", "completed_on", "status", "document_id"] as const;

registerAction({
  key: "compliance_items.mark_done",
  label: "Mark done",
  entity: "compliance_items",
  roles: RISK_WRITE,
  icon: CircleCheck,
  when: (r: Row) => r.status !== "Done",
  input: z.strictObject({
    completed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
    note: z.string().trim().max(500).optional(),
  }),
  handler: async (ctx, row, input) => {
    const at = demoNowIso(ctx.nowMs);
    if (input.completed_on > at.slice(0, 10)) return { status: 400, error: "The completion date can't be in the future" };
    const res = await ctx.db.prepare(overlayUpsertSql("compliance_items", COMPLIANCE_COLS, { completed_on: "?3", status: "'Done'" }, "e.completed_on IS NULL")).bind(ctx.ws, String(row.id), input.completed_on).run();
    if (!res.meta.changes) return { status: 409, error: "This item is already done" };
    const a = activity(ctx.ws, "compliance_items", String(row.id), row.property_id, at, ctx.actor.personaId, "status_changed", `${ctx.actor.name} marked this done (completed ${formatAsOf(input.completed_on)})${input.note ? `: ${input.note}` : ""}`);
    await ctx.db.prepare(a.sql).bind(...a.binds).run();
    return { status: 200, message: `Marked "${String(row.title)}" done` };
  },
  help: { summary: "Records the completion date. Attach the certificate or inspection report on the Documents tab.", article: "compliance-items" },
});
