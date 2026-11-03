import { z } from "zod";
import type { ActionContext, ActionResult, EntityKey, Role, Row } from "@/entities/types";
import type { DbStatement } from "@/lib/platform/types";
import { triage } from "@/ai/agents/maintenance";
import { AS_OF } from "@/seed/constants";
import { effective, overlayUpsertSql } from "@/server/effective";
import { eventStmt, notifyStmt, payRent, uid } from "@/server/money";
import { nowIso } from "@/server/workspace";
import { registerAction } from "../actions";
import { dollars, notifyManager, ownerLimitCents } from "./actions";

// Portal self-service. Every portal action runs on the user's own record (owners/ow01,
// residents/res-…, vendors/v01, applicants/apl-…): the generic action route only finds that row
// for them (scope "self"), and each handler checks that the record it touches belongs to it.

const Id = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/);
const Body = z.string().trim().min(1).max(2000);
// Photos are downscaled in the browser; the cap keeps two of them under the 64 KB write limit.
const Photo = z.string().max(30_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, "Photos must be JPEG, PNG or WebP");

const WO_COLS = ["id", "deleted", "property_id", "unit_id", "service_request_id", "pm_schedule_id", "turnover_id", "title", "description", "category", "priority", "source", "status", "vendor_id", "assignee_id", "estimate_cents", "cost_cents", "sla_due_at", "opened_at", "scheduled_at", "completed_at", "permission_to_enter"];
const THREAD_COLS = ["id", "deleted", "property_id", "party_kind", "party_id", "subject", "entity_type", "entity_id", "assigned_to", "status", "last_message_at", "unread"];
const RESIDENT_COLS = ["id", "deleted", "household_id", "property_id", "first_name", "last_name", "email", "phone", "preferred_channel", "language", "is_primary", "status", "autopay", "risk_score"];
const OFFER_COLS = ["id", "deleted", "lease_id", "property_id", "version", "term_months", "rent_cents", "current_rent_cents", "market_rent_cents", "status", "sent_at", "responded_at", "expires_on"];

const ok = (message: string, href?: string): ActionResult => ({ status: 200, message, href });
const no = (status: 400 | 404 | 409, error: string): ActionResult => ({ status, error });
const one = <T = Row>(ctx: ActionContext, sql: string, ...binds: unknown[]) => ctx.db.prepare(sql).bind(ctx.ws, ...binds).first<T>();

// ---------------------------------------------------------------------------------------------
// Messages (all four portals)
// ---------------------------------------------------------------------------------------------

type Party = "owner" | "resident" | "vendor" | "applicant";
const MessageInput = z.object({ threadId: Id.optional(), subject: z.string().trim().min(1).max(200).optional(), body: Body }).refine((v) => v.threadId || v.subject, "Add a subject");

function messageAction(entity: EntityKey, party: Party, role: Role, propertyOf: (ctx: ActionContext, row: Row) => Promise<string | null>) {
  registerAction({
    key: `${entity}.send_message`,
    label: "Send message",
    entity,
    roles: [role],
    input: MessageInput,
    handler: async (ctx, row, input) => {
      const at = nowIso(ctx.nowMs);
      const partyId = String(row.id);
      let threadId = input.threadId;
      const stmts: DbStatement[] = [];
      if (threadId) {
        const t = await one<{ id: string; subject: string }>(ctx, `SELECT id, subject FROM ${effective("message_threads")} AS t WHERE t.id = ?2 AND t.party_kind = ?3 AND t.party_id = ?4`, threadId, party, partyId);
        if (!t) return no(404, "Conversation not found");
        stmts.push(ctx.db.prepare(overlayUpsertSql("message_threads", THREAD_COLS, { status: "'Open'", last_message_at: "?3", unread: "1" })).bind(ctx.ws, threadId, at));
      } else {
        threadId = uid("thr");
        stmts.push(ctx.db.prepare("INSERT INTO message_threads (workspace_id, id, property_id, party_kind, party_id, subject, status, last_message_at, unread) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'Open', ?7, 1)")
          .bind(ctx.ws, threadId, await propertyOf(ctx, row), party, partyId, input.subject, at));
      }
      stmts.push(ctx.db.prepare("INSERT INTO messages (workspace_id, id, thread_id, channel, direction, sender_kind, sender_id, body, sent_at) VALUES (?1, ?2, ?3, 'Portal', 'in', ?4, ?5, ?6, ?7)")
        .bind(ctx.ws, uid("msg"), threadId, party, partyId, input.body, at));
      await ctx.db.batch(stmts);
      return ok("Message sent. The team usually replies within one business day.", `?thread=${threadId}`);
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Owner: approve or decline maintenance spend over the approval limit
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "owners.decide_spend",
  label: "Decide on a repair",
  entity: "owners",
  roles: ["owner"],
  input: z.object({ workOrderId: Id, decision: z.enum(["Approved", "Declined"]), note: z.string().trim().max(500).default("") }),
  handler: async (ctx, row, input) => {
    const wo = await one<{ id: string; title: string; status: string; property_id: string; owner_entity_id: string; estimate_cents: number | null; cost_cents: number | null; vendor_id: string | null; property: string }>(ctx,
      `SELECT w.id, w.title, w.status, w.property_id, p.owner_entity_id, w.estimate_cents, w.cost_cents, w.vendor_id, p.name AS property
       FROM ${effective("work_orders")} AS w JOIN ${effective("properties")} AS p ON p.id = w.property_id JOIN ${effective("owner_entities")} AS e ON e.id = p.owner_entity_id
       WHERE w.id = ?2 AND e.owner_id = ?3`, input.workOrderId, row.id);
    if (!wo) return no(404, "Repair not found");
    if (["Completed", "Paid", "Cancelled"].includes(wo.status)) return no(409, `${wo.id} is already ${wo.status.toLowerCase()}`);
    const amount = wo.estimate_cents ?? wo.cost_cents ?? 0;
    const limit = await ownerLimitCents(ctx, wo.owner_entity_id);
    if (limit == null || amount <= limit) return no(409, `${wo.id} is within your approval limit; the property team handles it.`);
    const at = nowIso(ctx.nowMs);
    const eventId = uid("woe");
    const next = input.decision === "Declined" ? "On hold" : wo.status === "On hold" ? (wo.vendor_id ? "Assigned" : "Triaged") : wo.status;
    // One owner decision per work order: the guarded insert decides; the rest is gated on it.
    const [ins] = await ctx.db.batch([
      ctx.db.prepare(`INSERT INTO wo_events (workspace_id, id, work_order_id, property_id, at, actor_kind, actor_id, kind, status, detail)
        SELECT ?1, ?2, ?3, ?4, ?5, 'owner', ?6, 'Approval', ?7, ?8
        WHERE NOT EXISTS (SELECT 1 FROM ${effective("wo_events")} AS e WHERE e.work_order_id = ?3 AND e.kind = 'Approval' AND e.actor_kind = 'owner')`)
        .bind(ctx.ws, eventId, wo.id, wo.property_id, at, row.id, next, JSON.stringify({ decision: input.decision, amount_cents: amount, limit_cents: limit, note: input.note })),
      ctx.db.prepare(overlayUpsertSql("work_orders", WO_COLS, { status: "?3" }, "EXISTS (SELECT 1 FROM wo_events WHERE workspace_id = ?1 AND id = ?4)")).bind(ctx.ws, wo.id, next, eventId),
    ]);
    if (!ins.meta.changes) return no(409, `You already decided on ${wo.id}.`);
    await ctx.db.batch([
      eventStmt(ctx.db, ctx.ws, at, `wo.owner_${input.decision.toLowerCase()}`, "work_orders", wo.id, wo.property_id, { amount_cents: amount, note: input.note }),
      notifyManager(ctx, wo.property_id, `Owner ${input.decision.toLowerCase()} ${wo.id}`, `${String(row.name)} ${input.decision.toLowerCase()} ${dollars(amount)} for "${wo.title}" at ${wo.property}.${input.note ? ` Note: ${input.note}` : ""}`, `/app/maintenance/work-orders/${wo.id}`, ["work_orders", wo.id]),
    ]);
    return ok(input.decision === "Approved" ? `Approved ${dollars(amount)} for ${wo.title}. The property team will schedule it.` : `Declined ${wo.title}. The property team has been told.`);
  },
  help: { summary: "Repairs over the owner's approval limit wait for the owner's decision in the owner portal.", article: "owner-portal" },
});

messageAction("owners", "owner", "owner", async (ctx, row) => (await one<{ id: string }>(ctx, `SELECT min(p.id) AS id FROM ${effective("properties")} AS p JOIN ${effective("owner_entities")} AS e ON e.id = p.owner_entity_id WHERE e.owner_id = ?2`, row.id))?.id ?? null);

// ---------------------------------------------------------------------------------------------
// Resident
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "residents.pay_charges",
  label: "Pay rent",
  entity: "residents",
  roles: ["resident"],
  money: true,
  input: z.object({ chargeIds: z.array(Id).min(1).max(12) }),
  handler: async (ctx, row, input) => {
    const own = await ctx.db.prepare(`SELECT c.id FROM ${effective("charges")} AS c WHERE c.household_id = ?2 AND c.id IN (SELECT value FROM json_each(?3))`).bind(ctx.ws, row.household_id, JSON.stringify(input.chargeIds)).all<{ id: string }>();
    if (own.results.length !== new Set(input.chargeIds).size) return no(404, "One of those charges isn't on your account");
    const paid: string[] = [];
    const errors: string[] = [];
    // Each charge is its own guarded transfer (key rent:<charge>), so a retry pays nothing twice.
    for (const id of input.chargeIds) {
      const r = await payRent(ctx, id);
      if (r.status === 200) paid.push(r.message ?? id);
      else errors.push(r.error);
    }
    if (!paid.length) return no(409, errors[0] ?? "Nothing was paid");
    return ok(errors.length ? `${paid.length} paid; ${errors.join(" ")}` : paid.length === 1 ? paid[0] : `${paid.length} payments are processing.`);
  },
  help: { summary: "Pays open charges by ACH into the property's trust account. Each charge can only be paid once.", article: "resident-portal" },
});

registerAction({
  key: "residents.set_autopay",
  label: "Change autopay",
  entity: "residents",
  roles: ["resident"],
  input: z.object({ enabled: z.boolean() }),
  handler: async (ctx, row, input) => {
    await ctx.db.prepare(overlayUpsertSql("residents", RESIDENT_COLS, { autopay: "?3" })).bind(ctx.ws, row.id, input.enabled ? 1 : 0).run();
    return ok(input.enabled ? "Autopay is on. Rent will be paid on the 1st from your bank account on file." : "Autopay is off. Pay each month from this page.");
  },
});

const Request = z.object({
  description: z.string().trim().min(8, "Tell us a little more").max(1000),
  location: z.string().trim().max(80).default(""),
  permissionToEnter: z.boolean(),
  photos: z.array(Photo).max(2).default([]),
});

registerAction({
  key: "residents.request_maintenance",
  label: "Request maintenance",
  entity: "residents",
  roles: ["resident"],
  input: Request,
  handler: async (ctx, row, input) => {
    const lease = await one<{ unit_id: string; property_id: string; number: string }>(ctx,
      `SELECT l.unit_id, l.property_id, u.number FROM ${effective("leases")} AS l JOIN ${effective("units")} AS u ON u.id = l.unit_id WHERE l.household_id = ?2 AND l.status IN ('Active', 'Notice', 'Month-to-month') ORDER BY l.start_on DESC LIMIT 1`, row.household_id);
    if (!lease) return no(409, "We couldn't find an active lease for you. Call the office.");
    const text = `${input.location} ${input.description}`.trim();
    const t = triage(text, Number(AS_OF.slice(5, 7)));
    const max = await one<{ n: number | null }>(ctx, `SELECT max(CAST(substr(w.id, 4) AS INTEGER)) AS n FROM ${effective("work_orders")} AS w WHERE w.id LIKE 'WO-%'`);
    const woId = `WO-${(max?.n ?? 10000) + 1}`;
    const srId = uid("sr");
    const at = nowIso(ctx.nowMs);
    const slaHours = t.priority === "Emergency" ? 4 : t.priority === "Urgent" ? 24 : 72;
    const title = (input.description.split(/[.!?\n]/)[0] ?? input.description).slice(0, 80);
    const stmts: DbStatement[] = [
      ctx.db.prepare("INSERT INTO service_requests (workspace_id, id, property_id, unit_id, resident_id, body, category, urgency, status, work_order_id, submitted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'Converted', ?9, ?10)")
        .bind(ctx.ws, srId, lease.property_id, lease.unit_id, row.id, text, t.trade, t.priority, woId, at),
      ctx.db.prepare(`INSERT INTO work_orders (workspace_id, id, property_id, unit_id, service_request_id, title, description, category, priority, source, status, sla_due_at, opened_at, permission_to_enter)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'Resident', 'New', ?10, ?11, ?12)`)
        .bind(ctx.ws, woId, lease.property_id, lease.unit_id, srId, title, text, t.trade, t.priority, new Date(Date.parse(at) + slaHours * 3_600_000).toISOString(), at, input.permissionToEnter ? 1 : 0),
      ...input.photos.map((url, i) => ctx.db.prepare("INSERT INTO photos (workspace_id, id, entity_type, entity_id, property_id, url, caption, stage, taken_at) VALUES (?1, ?2, 'work_orders', ?3, ?4, ?5, ?6, 'Before', ?7)")
        .bind(ctx.ws, uid("ph"), woId, lease.property_id, url, `Resident photo ${i + 1}`, at)),
      eventStmt(ctx.db, ctx.ws, at, "wo.created", "work_orders", woId, lease.property_id, { source: "Resident", category: t.trade, priority: t.priority, safety: t.safety }),
      notifyManager(ctx, lease.property_id, `New request: ${title}`, `#${lease.number}: ${t.priority} ${t.trade.toLowerCase()} request from the resident portal.`, `/app/maintenance/work-orders/${woId}`, ["work_orders", woId]),
    ];
    await ctx.db.batch(stmts);
    return ok(t.safety ? `${woId} created and marked an emergency. If you smell gas or see fire, leave and call 911.` : `${woId} created. We'll confirm a time within ${slaHours === 72 ? "3 days" : `${slaHours} hours`}.`, `/portal/resident/requests?wo=${woId}`);
  },
  help: { summary: "Creates a work order from the resident portal. AI suggests the trade and urgency; the team confirms.", article: "resident-portal" },
});

registerAction({
  key: "residents.respond_renewal",
  label: "Respond to renewal offer",
  entity: "residents",
  roles: ["resident"],
  input: z.object({ offerId: Id, decision: z.enum(["Accepted", "Declined"]) }),
  handler: async (ctx, row, input) => {
    const offer = await one<{ id: string; lease_id: string; property_id: string; term_months: number; rent_cents: number; status: string; expires_on: string | null }>(ctx,
      `SELECT o.* FROM ${effective("renewal_offers")} AS o JOIN ${effective("leases")} AS l ON l.id = o.lease_id WHERE o.id = ?2 AND l.household_id = ?3`, input.offerId, row.household_id);
    if (!offer) return no(404, "Offer not found");
    if (offer.expires_on && offer.expires_on < AS_OF) return no(409, "This offer has expired. Message the office for a new one.");
    const at = nowIso(ctx.nowMs);
    const [r] = await ctx.db.batch([
      ctx.db.prepare(overlayUpsertSql("renewal_offers", OFFER_COLS, { status: "?3", responded_at: "?4" }, "e.status = 'Sent'")).bind(ctx.ws, offer.id, input.decision, at),
    ]);
    if (!r.meta.changes) return no(409, `This offer is already ${offer.status.toLowerCase()}.`);
    // Accepting one term declines the other open terms on the same lease.
    const others = input.decision === "Accepted" ? (await ctx.db.prepare(`SELECT o.id FROM ${effective("renewal_offers")} AS o WHERE o.lease_id = ?2 AND o.status = 'Sent' AND o.id <> ?3`).bind(ctx.ws, offer.lease_id, offer.id).all<{ id: string }>()).results : [];
    await ctx.db.batch([
      ...others.map((o) => ctx.db.prepare(overlayUpsertSql("renewal_offers", OFFER_COLS, { status: "'Declined'", responded_at: "?3" }, "e.status = 'Sent'")).bind(ctx.ws, o.id, at)),
      eventStmt(ctx.db, ctx.ws, at, `renewal.${input.decision.toLowerCase()}`, "renewal_offers", offer.id, offer.property_id, { lease_id: offer.lease_id, rent_cents: offer.rent_cents, term_months: offer.term_months }),
      notifyManager(ctx, offer.property_id, `Renewal ${input.decision.toLowerCase()}`, `${String(row.first_name)} ${String(row.last_name)} ${input.decision.toLowerCase()} the ${offer.term_months}-month renewal at ${dollars(offer.rent_cents)}.`, `/app/leases/${offer.lease_id}`, ["leases", offer.lease_id]),
    ]);
    return ok(input.decision === "Accepted" ? `Accepted: ${offer.term_months} months at ${dollars(offer.rent_cents)} a month. We'll send the renewal to sign.` : "Declined. The office will contact you about move-out.");
  },
});

messageAction("residents", "resident", "resident", async (_ctx, row) => String(row.property_id));

// ---------------------------------------------------------------------------------------------
// Vendor
// ---------------------------------------------------------------------------------------------

const job = (ctx: ActionContext, vendorId: unknown, woId: string) =>
  one<{ id: string; title: string; status: string; property_id: string; scheduled_at: string | null; estimate_cents: number | null }>(ctx, `SELECT w.id, w.title, w.status, w.property_id, w.scheduled_at, w.estimate_cents FROM ${effective("work_orders")} AS w WHERE w.id = ?2 AND w.vendor_id = ?3`, woId, vendorId);

registerAction({
  key: "vendors.respond_job",
  label: "Respond to job",
  entity: "vendors",
  roles: ["vendor"],
  input: z.object({ workOrderId: Id, decision: z.enum(["accept", "decline"]), visitAt: z.string().datetime().optional(), note: z.string().trim().max(500).default("") }),
  handler: async (ctx, row, input) => {
    const w = await job(ctx, row.id, input.workOrderId);
    if (!w) return no(404, "Job not found");
    const at = nowIso(ctx.nowMs);
    const accept = input.decision === "accept";
    // The set expressions also run in ON CONFLICT DO UPDATE, so they can't reference the source row.
    const set: Record<string, string> = accept ? { status: "'Scheduled'", ...(input.visitAt ? { scheduled_at: "?3" } : {}) } : { status: "'Triaged'", vendor_id: "NULL", scheduled_at: "NULL" };
    const [r] = await ctx.db.batch([ctx.db.prepare(overlayUpsertSql("work_orders", WO_COLS, set, "e.status = 'Assigned'")).bind(ctx.ws, w.id, ...(accept && input.visitAt ? [input.visitAt] : []))]);
    if (!r.meta.changes) return no(409, `${w.id} is ${w.status.toLowerCase()}; only new assignments can be accepted or declined.`);
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO wo_events (workspace_id, id, work_order_id, property_id, at, actor_kind, actor_id, kind, status, detail) VALUES (?1, ?2, ?3, ?4, ?5, 'vendor', ?6, 'Status', ?7, ?8)")
        .bind(ctx.ws, uid("woe"), w.id, w.property_id, at, row.id, accept ? "Scheduled" : "Triaged", JSON.stringify({ decision: input.decision, visit_at: input.visitAt ?? null, note: input.note })),
      notifyManager(ctx, w.property_id, `${String(row.company)} ${accept ? "accepted" : "declined"} ${w.id}`, `${w.title}${input.note ? `: ${input.note}` : ""}`, `/app/maintenance/work-orders/${w.id}`, ["work_orders", w.id]),
    ]);
    return ok(accept ? `Accepted ${w.id}.` : `Declined ${w.id}. It goes back to the property team.`);
  },
});

const Line = z.object({ description: z.string().trim().min(1).max(200), amount_cents: z.number().int().positive().max(10_000_000) });

registerAction({
  key: "vendors.submit_invoice",
  label: "Submit invoice",
  entity: "vendors",
  roles: ["vendor"],
  input: z.object({
    workOrderId: Id,
    invoiceNumber: z.string().trim().min(1).max(40),
    lines: z.array(Line).min(1).max(20),
    fileName: z.string().trim().max(120).default(""),
    read: z.object({ source: z.enum(["live", "rules", "manual"]), confidence: z.number().min(0).max(1).optional() }).default({ source: "manual" }),
  }),
  handler: async (ctx, row, input) => {
    const w = await job(ctx, row.id, input.workOrderId);
    if (!w) return no(404, "Job not found");
    const total = input.lines.reduce((a, l) => a + l.amount_cents, 0);
    const at = nowIso(ctx.nowMs);
    const eventId = uid("woe");
    const [r] = await ctx.db.batch([
      ctx.db.prepare(`INSERT INTO wo_events (workspace_id, id, work_order_id, property_id, at, actor_kind, actor_id, kind, status, detail)
        SELECT ?1, ?2, ?3, ?4, ?5, 'vendor', ?6, 'Submission', 'Submitted', ?7 FROM ${effective("work_orders")} AS w WHERE w.id = ?3 AND w.status IN ('Scheduled', 'In progress', 'Completed', 'On hold')`)
        .bind(ctx.ws, eventId, w.id, w.property_id, at, row.id, JSON.stringify({ invoice_number: input.invoiceNumber, lines: input.lines, total_cents: total, read: input.read })),
      ctx.db.prepare(overlayUpsertSql("work_orders", WO_COLS, { status: "'Submitted'", cost_cents: "?3" }, "EXISTS (SELECT 1 FROM wo_events WHERE workspace_id = ?1 AND id = ?4)")).bind(ctx.ws, w.id, total, eventId),
      ctx.db.prepare(`INSERT INTO documents (workspace_id, id, property_id, entity_type, entity_id, name, url, mime, doc_type, filed_to, classified_by, extracted, uploaded_by, uploaded_at)
        SELECT ?1, ?2, ?3, 'work_orders', ?4, ?5, ?6, 'application/pdf', 'Invoice', ?7, ?8, ?9, ?10, ?11 WHERE EXISTS (SELECT 1 FROM wo_events WHERE workspace_id = ?1 AND id = ?12)`)
        .bind(ctx.ws, uid("doc"), w.property_id, w.id, input.fileName || `Invoice ${input.invoiceNumber}`, `/app/maintenance/work-orders/${w.id}`, `Work order ${w.id} › Documents`, input.read.source === "manual" ? row.id : "ap", JSON.stringify({ invoice_number: input.invoiceNumber, total_cents: total, lines: input.lines }), row.id, at, eventId),
    ]);
    if (!r.meta.changes) return no(409, `${w.id} is ${w.status.toLowerCase()}; invoices can be sent once the work is scheduled or done.`);
    await ctx.db.batch([
      eventStmt(ctx.db, ctx.ws, at, "invoice.received", "work_orders", w.id, w.property_id, { vendor_id: row.id, total_cents: total, invoice_number: input.invoiceNumber }),
      notifyManager(ctx, w.property_id, `Invoice for ${w.id}`, `${String(row.company)} invoiced ${dollars(total)} (${input.invoiceNumber}).`, `/app/maintenance/work-orders/${w.id}`, ["work_orders", w.id]),
    ]);
    return ok(`Invoice ${input.invoiceNumber} for ${dollars(total)} sent. You'll be paid by ACH once it's approved.`);
  },
});

registerAction({
  key: "vendors.upload_coi",
  label: "Upload insurance certificate",
  entity: "vendors",
  roles: ["vendor"],
  input: z.object({ carrier: z.string().trim().min(2).max(120), glLimitCents: z.number().int().min(100_000).max(10_000_000_000), workersComp: z.boolean(), expiresOn: z.iso.date(), fileName: z.string().trim().min(1).max(120) }),
  handler: async (ctx, row, input) => {
    if (input.expiresOn <= AS_OF) return no(400, "That certificate has already expired. Upload the current one.");
    const at = nowIso(ctx.nowMs);
    const docId = uid("doc");
    const soon = Date.parse(input.expiresOn) - Date.parse(AS_OF) < 30 * 86_400_000;
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO documents (workspace_id, id, entity_type, entity_id, name, url, mime, doc_type, filed_to, classified_by, uploaded_by, uploaded_at) VALUES (?1, ?2, 'vendors', ?3, ?4, ?5, 'application/pdf', 'COI', ?6, ?3, ?3, ?7)")
        .bind(ctx.ws, docId, row.id, input.fileName, `/app/maintenance/vendors/${row.id}`, `Vendor ${String(row.company)} › Insurance`, at),
      ctx.db.prepare("INSERT INTO vendor_cois (workspace_id, id, vendor_id, document_id, carrier, gl_limit_cents, workers_comp, expires_on, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
        .bind(ctx.ws, uid("coi"), row.id, docId, input.carrier, input.glLimitCents, input.workersComp ? 1 : 0, input.expiresOn, soon ? "Expiring" : "Valid"),
      eventStmt(ctx.db, ctx.ws, at, "coi.uploaded", "vendors", String(row.id), null, { expires_on: input.expiresOn }),
      notifyStmt(ctx.db, ctx.ws, at, "tom", "New insurance certificate", `${String(row.company)} uploaded a COI from ${input.carrier}, valid to ${input.expiresOn}.`, `/app/maintenance/vendors/${row.id}`, ["vendors", String(row.id)]),
    ]);
    return ok(soon ? `Saved. This certificate expires within 30 days, so upload the renewal when you have it.` : `Saved. Your insurance is current until ${input.expiresOn}.`);
  },
});

messageAction("vendors", "vendor", "vendor", async (ctx, row) => (await one<{ p: string }>(ctx, `SELECT w.property_id AS p FROM ${effective("work_orders")} AS w WHERE w.vendor_id = ?2 ORDER BY w.opened_at DESC LIMIT 1`, row.id))?.p ?? null);

// ---------------------------------------------------------------------------------------------
// Applicant
// ---------------------------------------------------------------------------------------------

export const APPLICANT_DOCS = ["Photo ID", "Pay stub", "Second pay stub", "Employer letter", "Bank statement"] as const;

const application = (ctx: ActionContext, applicantId: unknown) =>
  one<{ id: string; property_id: string; stage: string }>(ctx, `SELECT a.id, a.property_id, a.stage FROM ${effective("applications")} AS a WHERE a.applicant_id = ?2 ORDER BY a.submitted_at DESC LIMIT 1`, applicantId);

registerAction({
  key: "applicants.upload_document",
  label: "Upload document",
  entity: "applicants",
  roles: ["applicant"],
  input: z.object({ docType: z.enum(APPLICANT_DOCS), fileName: z.string().trim().min(1).max(120) }),
  handler: async (ctx, row, input) => {
    const app = await application(ctx, row.id);
    if (!app) return no(404, "We couldn't find your application");
    if (["Denied", "Withdrawn", "Leased"].includes(app.stage)) return no(409, `Your application is ${app.stage.toLowerCase()}; no more documents are needed.`);
    const at = nowIso(ctx.nowMs);
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO documents (workspace_id, id, property_id, entity_type, entity_id, name, url, mime, doc_type, filed_to, classified_by, uploaded_by, uploaded_at) VALUES (?1, ?2, ?3, 'applications', ?4, ?5, ?6, 'application/pdf', ?7, ?8, ?9, ?9, ?10)")
        .bind(ctx.ws, uid("doc"), app.property_id, app.id, input.fileName, `/app/leasing/applications/${app.id}`, input.docType, `Application ${app.id} › Documents`, row.id, at),
      eventStmt(ctx.db, ctx.ws, at, "application.document_added", "applications", app.id, app.property_id, { doc_type: input.docType }),
      notifyManager(ctx, app.property_id, "Application document received", `${String(row.first_name)} ${String(row.last_name)} uploaded: ${input.docType}.`, `/app/leasing/applications/${app.id}`, ["applications", app.id]),
    ]);
    return ok(`${input.docType} received. We'll review it within one business day.`);
  },
});

messageAction("applicants", "applicant", "applicant", async (ctx, row) => (await application(ctx, row.id))?.property_id ?? null);
