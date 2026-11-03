import { z } from "zod";
import { BadgeCheck, BadgeX, BellRing, CircleCheck } from "lucide-react";
import type { Role, Row } from "@/entities/types";
import { overlayUpsertSql } from "@/server/effective";
import { registerAction } from "../actions";

const RISK_WRITE: Role[] = ["principal", "regional_manager", "property_manager", "maintenance_supervisor"];
const rid = () => crypto.randomUUID();
const activity = (ws: string, entity: string, id: string, propertyId: unknown, at: string, actorId: string, verb: string, summary: string) => ({
  sql: "INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, ?, ?, '{}')",
  binds: [ws, rid(), entity, id, propertyId == null ? null : String(propertyId), at, actorId, verb, summary],
});

// Asks the vendor for a current certificate: a notification in their portal and an activity entry
// on both the certificate and the vendor. No money moves and nothing is sent outside the demo.
registerAction({
  key: "vendor_cois.request_certificate",
  label: "Request a current certificate",
  entity: "vendor_cois",
  roles: RISK_WRITE,
  icon: BellRing,
  when: (r: Row) => ["Expiring", "Expired", "Missing", "Rejected"].includes(String(r.status)),
  confirm: { title: "Ask the vendor for a current certificate?", body: "They get a notification in the vendor portal asking them to upload a renewed certificate of insurance." },
  handler: async (ctx, row) => {
    const at = new Date(ctx.nowMs).toISOString();
    const vendor = String(row.vendor_id);
    const company = String(row.vendor_id__label ?? vendor);
    const when = row.status === "Expiring" ? `expires ${row.expires_on}` : row.status === "Missing" ? "is missing" : `expired ${row.expires_on}`;
    const stmts = [
      { sql: "INSERT INTO notifications (workspace_id, id, user_id, channel, title, body, href, entity_type, entity_id, at) VALUES (?, ?, ?, 'In-app', ?, ?, '/portal/vendor', 'vendor_cois', ?, ?)",
        binds: [ctx.ws, rid(), vendor, "Upload a current certificate of insurance", `Your certificate on file ${when}. Upload a renewed certificate so we can keep assigning you work.`, String(row.id), at] },
      activity(ctx.ws, "vendor_cois", String(row.id), null, at, ctx.actor.personaId, "requested", `${ctx.actor.name} asked ${company} for a current certificate`),
      activity(ctx.ws, "vendors", vendor, null, at, ctx.actor.personaId, "requested", `${ctx.actor.name} asked for a current certificate of insurance`),
    ];
    await ctx.db.batch(stmts.map((s) => ctx.db.prepare(s.sql).bind(...s.binds)));
    return { status: 200, message: `Asked ${company} for a current certificate` };
  },
  help: { summary: "Sends the vendor a portal notification asking for a renewed certificate of insurance.", article: "vendor-insurance-certificates" },
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
    const at = new Date(ctx.nowMs).toISOString();
    if (input.expires_on <= at.slice(0, 10)) return { status: 400, error: "That certificate has already expired. Reject it and ask the vendor for a current one." };
    const res = await ctx.db.prepare(overlayUpsertSql("vendor_cois", COI_COLS, { status: "'Verified'", expires_on: "?3", gl_limit_cents: "?4", workers_comp: "?5" }, PENDING))
      .bind(ctx.ws, String(row.id), input.expires_on, Math.round(input.gl_limit * 100), input.workers_comp ? 1 : 0).run();
    if (!res.meta.changes) return { status: 409, error: "This certificate was already reviewed" };
    const company = String(row.vendor_id__label ?? row.vendor_id);
    const a = activity(ctx.ws, "vendor_cois", String(row.id), null, at, ctx.actor.personaId, "verified", `${ctx.actor.name} verified the certificate: ${String(row.carrier)}, valid to ${input.expires_on}`);
    const b = activity(ctx.ws, "vendors", String(row.vendor_id), null, at, ctx.actor.personaId, "verified", `${ctx.actor.name} verified a certificate of insurance valid to ${input.expires_on}`);
    await ctx.db.batch([a, b].map((x) => ctx.db.prepare(x.sql).bind(...x.binds)));
    return { status: 200, message: `Verified ${company}'s certificate, valid to ${input.expires_on}` };
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
    const at = new Date(ctx.nowMs).toISOString();
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
    const at = new Date(ctx.nowMs).toISOString();
    if (input.completed_on > at.slice(0, 10)) return { status: 400, error: "The completion date can't be in the future" };
    const res = await ctx.db.prepare(overlayUpsertSql("compliance_items", COMPLIANCE_COLS, { completed_on: "?3", status: "'Done'" }, "e.completed_on IS NULL")).bind(ctx.ws, String(row.id), input.completed_on).run();
    if (!res.meta.changes) return { status: 409, error: "This item is already done" };
    const a = activity(ctx.ws, "compliance_items", String(row.id), row.property_id, at, ctx.actor.personaId, "status_changed", `${ctx.actor.name} marked this done (completed ${input.completed_on})${input.note ? `: ${input.note}` : ""}`);
    await ctx.db.prepare(a.sql).bind(...a.binds).run();
    return { status: 200, message: `Marked "${String(row.title)}" done` };
  },
  help: { summary: "Records the completion date. Attach the certificate or inspection report on the Documents tab.", article: "compliance-items" },
});
