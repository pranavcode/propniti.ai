import { z } from "zod";
import { BellRing, CircleCheck } from "lucide-react";
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
  when: (r: Row) => ["Expiring", "Expired", "Missing"].includes(String(r.status)),
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
