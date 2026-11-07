import { z } from "zod";
import type { ActionContext, ActionResult, EntityKey, Role, Row } from "@/entities/types";
import type { DbStatement } from "@/lib/platform/types";
import { triage } from "@/ai/rules";
import { AS_OF } from "@/seed/constants";
import { effective, overlayUpsertSql } from "@/server/effective";
import { eventStmt, notifyStmt, payApplicationFee, payRent, uid } from "@/server/money";
import { nowIso } from "@/server/workspace";
import { MAX_UPLOAD_BYTES, UPLOAD_TYPES } from "@/lib/upload";
import { REQUIRED_TO_SUBMIT } from "./portal/journeys";
import { SAMPLE_DOCS, type SampleDocKey } from "./portal/sample-files";
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
const OFFER_COLS = ["id", "deleted", "lease_id", "property_id", "version", "term_months", "rent_cents", "current_rent_cents", "market_rent_cents", "status", "sent_at", "responded_at", "expires_on", "resident_note", "signed_at"];
const LEASE_COLS = ["id", "deleted", "property_id", "unit_id", "household_id", "application_id", "renewal_of", "kind", "status", "start_on", "end_on", "move_in_on", "move_out_on", "notice_on", "term_months", "rent_cents", "deposit_cents", "escalations", "nnn_share_pct", "cam_cents", "tax_cents", "insurance_cents", "signed_by", "signed_at", "document_id"];

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
      return ok("Message sent. The team replies in this conversation.", `?thread=${threadId}`);
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
    return ok(errors.length ? `Paid ${paid.length} of ${input.chargeIds.length} charges. ${errors.join(" ")}` : paid.length === 1 ? paid[0] : `${paid.length} payments are processing.`);
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
  label: "Send maintenance request",
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
      // The bytes stay in `data`; pages link to the same-site /api/photos/<id>, never to a data: URL.
      ...input.photos.map((data, i) => { const id = uid("ph"); return ctx.db.prepare("INSERT INTO photos (workspace_id, id, entity_type, entity_id, property_id, url, data, caption, stage, taken_at) VALUES (?1, ?2, 'work_orders', ?3, ?4, ?5, ?6, ?7, 'Before', ?8)")
        .bind(ctx.ws, id, woId, lease.property_id, `/api/photos/${id}`, data, `Resident photo ${i + 1}`, at); }),
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
  // Countered asks the office for different terms; the note says what.
  input: z.object({ offerId: Id, decision: z.enum(["Accepted", "Countered", "Declined"]), note: z.string().trim().max(500).default("") })
    .refine((v) => v.decision !== "Countered" || v.note.length >= 3, { message: "Say what you'd like instead", path: ["note"] }),
  handler: async (ctx, row, input) => {
    const offer = await one<{ id: string; lease_id: string; property_id: string; term_months: number; rent_cents: number; status: string; expires_on: string | null }>(ctx,
      `SELECT o.* FROM ${effective("renewal_offers")} AS o JOIN ${effective("leases")} AS l ON l.id = o.lease_id WHERE o.id = ?2 AND l.household_id = ?3`, input.offerId, row.household_id);
    if (!offer) return no(404, "Offer not found");
    if (offer.expires_on && offer.expires_on < AS_OF) return no(409, "This offer has expired. Message the office for a new one.");
    const at = nowIso(ctx.nowMs);
    const [r] = await ctx.db.batch([
      ctx.db.prepare(overlayUpsertSql("renewal_offers", OFFER_COLS, { status: "?3", responded_at: "?4", resident_note: "?5" }, "e.status = 'Sent'")).bind(ctx.ws, offer.id, input.decision, at, input.note || null),
    ]);
    if (!r.meta.changes) return no(409, `This offer is already ${offer.status.toLowerCase()}.`);
    // Accepting or countering one term closes the other open terms on the same lease.
    const others = input.decision !== "Declined" ? (await ctx.db.prepare(`SELECT o.id FROM ${effective("renewal_offers")} AS o WHERE o.lease_id = ?2 AND o.status = 'Sent' AND o.id <> ?3`).bind(ctx.ws, offer.lease_id, offer.id).all<{ id: string }>()).results : [];
    const verb = input.decision.toLowerCase();
    await ctx.db.batch([
      ...others.map((o) => ctx.db.prepare(overlayUpsertSql("renewal_offers", OFFER_COLS, { status: "'Declined'", responded_at: "?3" }, "e.status = 'Sent'")).bind(ctx.ws, o.id, at)),
      eventStmt(ctx.db, ctx.ws, at, `renewal.${verb}`, "renewal_offers", offer.id, offer.property_id, { lease_id: offer.lease_id, rent_cents: offer.rent_cents, term_months: offer.term_months, note: input.note }),
      notifyManager(ctx, offer.property_id, `Renewal ${verb}`, `${String(row.first_name)} ${String(row.last_name)} ${verb} the ${offer.term_months}-month renewal at ${dollars(offer.rent_cents)}.${input.note ? ` Note: ${input.note}` : ""}`, `/app/leases/${offer.lease_id}`, ["leases", offer.lease_id]),
    ]);
    return ok(input.decision === "Accepted" ? `Accepted: ${offer.term_months} months at ${dollars(offer.rent_cents)} a month. Sign your renewal next.`
      : input.decision === "Countered" ? "Counter-offer sent. The office replies here with updated terms." : "Declined. Give your move-out notice when you know your date.");
  },
});

// A demo e-signature on an accepted renewal: the resident types their full name and agrees.
registerAction({
  key: "residents.sign_renewal",
  label: "Sign renewal",
  entity: "residents",
  roles: ["resident"],
  input: z.object({ offerId: Id, signature: z.string().trim().min(3).max(120), agree: z.literal(true, { error: "Tick the box to agree" }) }),
  handler: async (ctx, row, input) => {
    const name = `${String(row.first_name)} ${String(row.last_name)}`;
    if (input.signature.replace(/\s+/g, " ").toLowerCase() !== name.toLowerCase()) return no(400, `Type your full name as it appears on the lease: ${name}.`);
    const offer = await one<{ id: string; lease_id: string; property_id: string; term_months: number; rent_cents: number; status: string; signed_at: string | null }>(ctx,
      `SELECT o.* FROM ${effective("renewal_offers")} AS o JOIN ${effective("leases")} AS l ON l.id = o.lease_id WHERE o.id = ?2 AND l.household_id = ?3`, input.offerId, row.household_id);
    if (!offer) return no(404, "Offer not found");
    const at = nowIso(ctx.nowMs);
    const [r] = await ctx.db.batch([ctx.db.prepare(overlayUpsertSql("renewal_offers", OFFER_COLS, { signed_at: "?3" }, "e.status = 'Accepted' AND e.signed_at IS NULL")).bind(ctx.ws, offer.id, at)]);
    if (!r.meta.changes) return no(409, offer.signed_at ? "You already signed this renewal." : "Accept the renewal before signing it.");
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO documents (workspace_id, id, property_id, entity_type, entity_id, name, url, mime, doc_type, filed_to, classified_by, extracted, uploaded_by, uploaded_at) VALUES (?1, ?2, ?3, 'leases', ?4, ?5, ?6, 'application/pdf', 'Lease', ?7, ?8, ?9, ?8, ?10)")
        .bind(ctx.ws, uid("doc"), offer.property_id, offer.lease_id, `Renewal, ${offer.term_months} months, e-signed by ${name}`, `/app/leases/${offer.lease_id}`, `Lease ${offer.lease_id} › Documents`, row.id, JSON.stringify({ offer_id: offer.id, signature: input.signature, signed_at: at, method: "Portal e-signature (demo)" }), at),
      eventStmt(ctx.db, ctx.ws, at, "renewal.signed", "renewal_offers", offer.id, offer.property_id, { lease_id: offer.lease_id }),
      notifyManager(ctx, offer.property_id, "Renewal signed", `${name} signed the ${offer.term_months}-month renewal at ${dollars(offer.rent_cents)}. Countersign and set up the new term.`, `/app/leases/${offer.lease_id}`, ["leases", offer.lease_id]),
    ]);
    return ok("Renewal signed. The office countersigns and sends you a copy.");
  },
});

// Notice to vacate: at least 30 days out (the lease's notice period), at most a year. Any open
// renewal offer is declined with it.
export const NOTICE_DAYS = 30;
registerAction({
  key: "residents.give_notice",
  label: "Give move-out notice",
  entity: "residents",
  roles: ["resident"],
  input: z.object({ moveOutOn: z.iso.date(), reason: z.string().trim().max(300).default("") }),
  handler: async (ctx, row, input) => {
    const days = Math.round((Date.parse(input.moveOutOn) - Date.parse(AS_OF)) / 86_400_000);
    if (days < NOTICE_DAYS) return no(400, `Your lease asks for ${NOTICE_DAYS} days' notice. Pick a date on or after ${new Date(Date.parse(AS_OF) + NOTICE_DAYS * 86_400_000).toISOString().slice(0, 10)}.`);
    if (days > 366) return no(400, "Pick a move-out date within the next year.");
    const lease = await one<{ id: string; property_id: string; status: string; notice_on: string | null }>(ctx,
      `SELECT l.id, l.property_id, l.status, l.notice_on FROM ${effective("leases")} AS l WHERE l.household_id = ?2 AND l.status IN ('Active', 'Month-to-month', 'Notice') ORDER BY l.start_on DESC LIMIT 1`, row.household_id);
    if (!lease) return no(409, "We couldn't find an active lease for you. Call the office.");
    const at = nowIso(ctx.nowMs);
    const [r] = await ctx.db.batch([ctx.db.prepare(overlayUpsertSql("leases", LEASE_COLS, { status: "'Notice'", notice_on: "?3", move_out_on: "?4" }, "e.status IN ('Active', 'Month-to-month') AND e.notice_on IS NULL")).bind(ctx.ws, lease.id, AS_OF, input.moveOutOn)]);
    if (!r.meta.changes) return no(409, "You've already given notice on this lease. Message the office to change the date.");
    const open = (await ctx.db.prepare(`SELECT o.id FROM ${effective("renewal_offers")} AS o WHERE o.lease_id = ?2 AND o.status = 'Sent'`).bind(ctx.ws, lease.id).all<{ id: string }>()).results;
    const name = `${String(row.first_name)} ${String(row.last_name)}`;
    await ctx.db.batch([
      ...open.map((o) => ctx.db.prepare(overlayUpsertSql("renewal_offers", OFFER_COLS, { status: "'Declined'", responded_at: "?3" }, "e.status = 'Sent'")).bind(ctx.ws, o.id, at)),
      eventStmt(ctx.db, ctx.ws, at, "lease.notice_given", "leases", lease.id, lease.property_id, { move_out_on: input.moveOutOn, reason: input.reason }),
      ctx.db.prepare("INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) VALUES (?1, ?2, 'leases', ?3, ?4, ?5, 'resident', ?6, 'notice_given', ?7, '{}')")
        .bind(ctx.ws, uid("act"), lease.id, lease.property_id, at, row.id, `${name} gave notice in the resident portal: moving out ${input.moveOutOn}${input.reason ? ` (${input.reason})` : ""}`),
      notifyManager(ctx, lease.property_id, "Notice to vacate", `${name} gave notice: moving out ${input.moveOutOn}. Schedule the move-out inspection.`, `/app/leases/${lease.id}`, ["leases", lease.id]),
    ]);
    return ok(`Notice received. Your move-out date is ${input.moveOutOn}. The team schedules your inspection next.`);
  },
});

// Stars for a finished repair, once per request, shown to the maintenance team.
registerAction({
  key: "residents.rate_request",
  label: "Rate a repair",
  entity: "residents",
  roles: ["resident"],
  input: z.object({ workOrderId: Id, stars: z.number().int().min(1).max(5), comment: z.string().trim().max(500).default("") }),
  handler: async (ctx, row, input) => {
    const w = await one<{ id: string; title: string; status: string; property_id: string; vendor_id: string | null }>(ctx,
      `SELECT w.id, w.title, w.status, w.property_id, w.vendor_id FROM ${effective("work_orders")} AS w WHERE w.id = ?2 AND w.id IN (SELECT sr.work_order_id FROM ${effective("service_requests")} AS sr WHERE sr.resident_id = ?3)`, input.workOrderId, row.id);
    if (!w) return no(404, "Request not found");
    if (!["Completed", "Paid"].includes(w.status)) return no(409, "You can rate a repair once it's done.");
    const at = nowIso(ctx.nowMs);
    // One rating per request and resident: a fixed id, and no base rating either.
    const [r] = await ctx.db.batch([ctx.db.prepare(`INSERT INTO ratings (workspace_id, id, by_kind, by_id, subject_kind, subject_id, property_id, stars, comment, at)
      SELECT ?1, ?2, 'resident', ?3, 'work_orders', ?4, ?5, ?6, ?7, ?8 WHERE NOT EXISTS (SELECT 1 FROM ${effective("ratings")} AS x WHERE x.subject_kind = 'work_orders' AND x.subject_id = ?4 AND x.by_id = ?3)
      ON CONFLICT (workspace_id, id) DO NOTHING`).bind(ctx.ws, `rt-${w.id}-${String(row.id)}`, row.id, w.id, w.property_id, input.stars, input.comment, at)]);
    if (!r.meta.changes) return no(409, "You already rated this repair. Thanks!");
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO wo_events (workspace_id, id, work_order_id, property_id, at, actor_kind, actor_id, kind, status, detail) VALUES (?1, ?2, ?3, ?4, ?5, 'resident', ?6, 'Rating', NULL, ?7)")
        .bind(ctx.ws, uid("woe"), w.id, w.property_id, at, row.id, JSON.stringify({ stars: input.stars, comment: input.comment })),
      ...(input.stars <= 2 ? [notifyManager(ctx, w.property_id, `Low rating on ${w.id}`, `${String(row.first_name)} rated "${w.title}" ${input.stars} of 5.${input.comment ? ` "${input.comment}"` : ""}`, `/app/maintenance/work-orders/${w.id}`, ["work_orders", w.id])] : []),
    ]);
    return ok(input.stars >= 4 ? "Thanks for the rating!" : "Thanks. The maintenance team will follow up.");
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
  label: "Send invoice",
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
    // Work the owner declined isn't billable, even though it keeps its vendor while on hold.
    const declined = `NOT EXISTS (SELECT 1 FROM ${effective("wo_events")} AS d WHERE d.work_order_id = ?3 AND d.kind = 'Approval' AND d.actor_kind = 'owner' AND json_extract(d.detail, '$.decision') = 'Declined')`;
    const [r] = await ctx.db.batch([
      ctx.db.prepare(`INSERT INTO wo_events (workspace_id, id, work_order_id, property_id, at, actor_kind, actor_id, kind, status, detail)
        SELECT ?1, ?2, ?3, ?4, ?5, 'vendor', ?6, 'Submission', 'Submitted', ?7 FROM ${effective("work_orders")} AS w WHERE w.id = ?3 AND w.status IN ('Scheduled', 'In progress', 'Completed', 'On hold') AND ${declined}`)
        .bind(ctx.ws, eventId, w.id, w.property_id, at, row.id, JSON.stringify({ invoice_number: input.invoiceNumber, lines: input.lines, total_cents: total, read: input.read })),
      ctx.db.prepare(overlayUpsertSql("work_orders", WO_COLS, { status: "'Submitted'", cost_cents: "?3" }, "EXISTS (SELECT 1 FROM wo_events WHERE workspace_id = ?1 AND id = ?4)")).bind(ctx.ws, w.id, total, eventId),
      ctx.db.prepare(`INSERT INTO documents (workspace_id, id, property_id, entity_type, entity_id, name, url, mime, doc_type, filed_to, classified_by, extracted, uploaded_by, uploaded_at)
        SELECT ?1, ?2, ?3, 'work_orders', ?4, ?5, ?6, 'application/pdf', 'Invoice', ?7, ?8, ?9, ?10, ?11 WHERE EXISTS (SELECT 1 FROM wo_events WHERE workspace_id = ?1 AND id = ?12)`)
        .bind(ctx.ws, uid("doc"), w.property_id, w.id, input.fileName || `Invoice ${input.invoiceNumber}`, `/app/maintenance/work-orders/${w.id}`, `Work order ${w.id} › Documents`, input.read.source === "manual" ? row.id : "ap", JSON.stringify({ invoice_number: input.invoiceNumber, total_cents: total, lines: input.lines }), row.id, at, eventId),
    ]);
    if (!r.meta.changes) {
      if (await one(ctx, `SELECT 1 FROM ${effective("wo_events")} AS d WHERE d.work_order_id = ?2 AND d.kind = 'Approval' AND d.actor_kind = 'owner' AND json_extract(d.detail, '$.decision') = 'Declined'`, w.id)) return no(409, `The owner declined ${w.id}, so it can't be invoiced. Message the maintenance team if work was already done.`);
      return no(409, `${w.id} is ${w.status.toLowerCase()}; invoices can be sent once the work is scheduled or done.`);
    }
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
  // `read` says where the values came from: the vendor typed them, or AI read them from the file and
  // the vendor confirmed. Either way staff verify the certificate before it counts.
  input: z.object({ carrier: z.string().trim().min(2).max(120), glLimitCents: z.number().int().min(100_000).max(10_000_000_000), workersComp: z.boolean(), expiresOn: z.iso.date(), fileName: z.string().trim().min(1).max(120),
    read: z.object({ source: z.enum(["live", "manual"]), confidence: z.number().min(0).max(1).optional(), fields: z.array(z.enum(["carrier", "glLimit", "workersComp", "expiresOn"])).max(4).optional() }).default({ source: "manual" }) }),
  handler: async (ctx, row, input) => {
    if (input.expiresOn <= AS_OF) return no(400, "That certificate has already expired. Upload the current one.");
    const at = nowIso(ctx.nowMs);
    const docId = uid("doc");
    const soon = Date.parse(input.expiresOn) - Date.parse(AS_OF) < 30 * 86_400_000;
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO documents (workspace_id, id, entity_type, entity_id, name, url, mime, doc_type, filed_to, classified_by, uploaded_by, uploaded_at) VALUES (?1, ?2, 'vendors', ?3, ?4, ?5, 'application/pdf', 'COI', ?6, ?3, ?3, ?7)")
        .bind(ctx.ws, docId, row.id, input.fileName, `/app/maintenance/vendors/${row.id}`, `Vendor ${String(row.company)} › Insurance`, at),
      ctx.db.prepare("INSERT INTO vendor_cois (workspace_id, id, vendor_id, document_id, carrier, gl_limit_cents, workers_comp, expires_on, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
        .bind(ctx.ws, uid("coi"), row.id, docId, input.carrier, input.glLimitCents, input.workersComp ? 1 : 0, input.expiresOn, "Pending verification"),
      eventStmt(ctx.db, ctx.ws, at, "coi.uploaded", "vendors", String(row.id), null, { expires_on: input.expiresOn, read: input.read }),
      notifyStmt(ctx.db, ctx.ws, at, "tom", "New insurance certificate", `${String(row.company)} uploaded a COI from ${input.carrier} (stated valid to ${input.expiresOn}${input.read.source === "live" ? "; AI read the file and the vendor confirmed the values" : ""}). Verify it before it counts for dispatch.`, `/app/maintenance/vendors/${row.id}`, ["vendors", String(row.id)]),
    ]);
    return ok(`Received. We check it against your carrier's document before it counts for new jobs.${soon ? " It expires within 30 days, so send the renewal when you have it." : ""}`);
  },
});

messageAction("vendors", "vendor", "vendor", async (ctx, row) => (await one<{ p: string }>(ctx, `SELECT w.property_id AS p FROM ${effective("work_orders")} AS w WHERE w.vendor_id = ?2 ORDER BY w.opened_at DESC LIMIT 1`, row.id))?.p ?? null);

// ---------------------------------------------------------------------------------------------
// Applicant
// ---------------------------------------------------------------------------------------------

export const APPLICANT_DOCS = ["Photo ID", "Pay stub", "Second pay stub", "Employer letter", "Bank statement"] as const;
// Asked for only when the decision makes a guarantor a condition.
export const OPTIONAL_DOCS = ["Guarantor letter"] as const;
const DOC_TYPES = [...APPLICANT_DOCS, ...OPTIONAL_DOCS] as const;
const APP_COLS = ["id", "deleted", "property_id", "unit_id", "listing_id", "applicant_id", "co_applicants", "stage", "desired_move_in", "rent_cents", "income_to_rent", "score", "scoring_factors", "recommendation", "decided_by", "decided_at", "fee_paid", "submitted_at", "decision_reason", "lease_sent_at", "lease_signed_at", "move_in_on"];
const sql = (v: string) => `'${v.replace(/'/g, "''")}'`;

const application = (ctx: ActionContext, applicantId: unknown) =>
  one<{ id: string; property_id: string; stage: string; fee_paid: number; lease_sent_at: string | null; lease_signed_at: string | null; property: string }>(ctx, `SELECT a.id, a.property_id, a.stage, a.fee_paid, a.lease_sent_at, a.lease_signed_at, p.name AS property FROM ${effective("applications")} AS a JOIN ${effective("properties")} AS p ON p.id = a.property_id WHERE a.applicant_id = ?2 ORDER BY coalesce(a.submitted_at, '9999') DESC LIMIT 1`, applicantId);

// The file itself reaches /portal/applicant/documents/upload, which checks its size and signature
// (JPEG, PNG, WebP or PDF) and passes only these facts on; the bytes are discarded.
export const UPLOAD_ROUTE = "/portal/applicant/documents/upload";
export const UploadDocument = z.object({
  docType: z.enum(DOC_TYPES),
  fileName: z.string().trim().min(1).max(120),
  mime: z.enum(UPLOAD_TYPES),
  bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  sample: z.enum(Object.keys(SAMPLE_DOCS) as [SampleDocKey, ...SampleDocKey[]]).optional(),
});

registerAction({
  key: "applicants.upload_document",
  label: "Upload document",
  entity: "applicants",
  roles: ["applicant"],
  route: UPLOAD_ROUTE,
  input: UploadDocument,
  handler: async (ctx, row, input) => {
    const app = await application(ctx, row.id);
    if (!app) return no(404, "We couldn't find your application");
    if (["Denied", "Withdrawn", "Leased"].includes(app.stage)) return no(409, `Your application is ${app.stage.toLowerCase()}; no more documents are needed.`);
    // A sample upload links to its public copy, so staff open the same file the applicant sent.
    const sample = input.sample ? SAMPLE_DOCS[input.sample] : null;
    if (sample && sample.docType !== input.docType) return no(400, `That sample is a ${sample.docType.toLowerCase()}, not a ${input.docType.toLowerCase()}.`);
    const at = nowIso(ctx.nowMs);
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO documents (workspace_id, id, property_id, entity_type, entity_id, name, url, mime, doc_type, filed_to, classified_by, extracted, uploaded_by, uploaded_at) VALUES (?1, ?2, ?3, 'applications', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?10, ?12)")
        .bind(ctx.ws, uid("doc"), app.property_id, app.id, input.fileName, sample?.file ?? `/app/leasing/applications/${app.id}`, input.mime, input.docType, `Application ${app.id} › Documents`, row.id, JSON.stringify({ bytes: input.bytes, sample: !!sample }), at),
      eventStmt(ctx.db, ctx.ws, at, "application.document_added", "applications", app.id, app.property_id, { doc_type: input.docType, sample: !!sample }),
      notifyManager(ctx, app.property_id, "Application document received", `${String(row.first_name)} ${String(row.last_name)} uploaded: ${input.docType}${sample ? " (sample file)" : ""}.`, `/app/leasing/applications/${app.id}?tab=documents`, ["applications", app.id]),
    ]);
    return ok(`${input.docType} received. The leasing team will message you if anything else is needed.`);
  },
});

registerAction({
  key: "applicants.submit_application",
  label: "Submit application",
  entity: "applicants",
  roles: ["applicant"],
  input: z.object({}),
  handler: async (ctx, row) => {
    const app = await application(ctx, row.id);
    if (!app) return no(404, "We couldn't find your application");
    if (app.stage !== "Started") return no(409, "Your application is already submitted.");
    // The guard decides: still Started, fee paid and the documents screening needs first on file.
    const docs = REQUIRED_TO_SUBMIT.map((d) => `EXISTS (SELECT 1 FROM ${effective("documents")} AS d WHERE d.entity_type = 'applications' AND d.entity_id = e.id AND d.doc_type = ${sql(d)})`).join(" AND ");
    const at = nowIso(ctx.nowMs);
    const [r] = await ctx.db.batch([ctx.db.prepare(overlayUpsertSql("applications", APP_COLS, { stage: "'Submitted'", submitted_at: "?3" }, `e.stage = 'Started' AND e.fee_paid = 1 AND ${docs}`)).bind(ctx.ws, app.id, at)]);
    if (!r.meta.changes) {
      const now = await application(ctx, row.id);
      if (now?.stage !== "Started") return no(409, "Your application is already submitted.");
      return no(409, now.fee_paid ? `Upload your ${REQUIRED_TO_SUBMIT.join(" and ").toLowerCase()} first.` : "Pay the application fee first.");
    }
    await ctx.db.batch([
      eventStmt(ctx.db, ctx.ws, at, "application.submitted", "applications", app.id, app.property_id, { applicant_id: row.id }),
      ctx.db.prepare("INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) VALUES (?1, ?2, 'applications', ?3, ?4, ?5, 'applicant', ?6, 'submitted', ?7, '{}')")
        .bind(ctx.ws, uid("act"), app.id, app.property_id, at, row.id, `${String(row.first_name)} ${String(row.last_name)} submitted the application from the applicant portal`),
      notifyManager(ctx, app.property_id, "Application submitted", `${String(row.first_name)} ${String(row.last_name)} submitted an application for ${app.property}. Order screening next.`, `/app/leasing/applications/${app.id}`, ["applications", app.id]),
    ]);
    return ok("Application submitted. The leasing team starts screening within 1 business day.");
  },
});

// A demo e-signature: the applicant types their full name and agrees. It binds the lease the office
// sent (stage Approved or Conditional, lease sent, not yet signed); a second click signs nothing.
registerAction({
  key: "applicants.sign_lease",
  label: "Sign lease",
  entity: "applicants",
  roles: ["applicant"],
  input: z.object({ signature: z.string().trim().min(3).max(120), agree: z.literal(true, { error: "Tick the box to agree" }) }),
  handler: async (ctx, row, input) => {
    const app = await application(ctx, row.id);
    if (!app) return no(404, "We couldn't find your application");
    const name = `${String(row.first_name)} ${String(row.last_name)}`;
    if (input.signature.replace(/\s+/g, " ").toLowerCase() !== name.toLowerCase()) return no(400, `Type your full name as it appears on the lease: ${name}.`);
    if (!app.lease_sent_at) return no(409, "Your lease hasn't been sent yet. The office sends it after approval.");
    const at = nowIso(ctx.nowMs);
    const [r] = await ctx.db.batch([ctx.db.prepare(overlayUpsertSql("applications", APP_COLS, { stage: "'Leased'", lease_signed_at: "?3" }, "e.stage IN ('Approved', 'Conditional') AND e.lease_sent_at IS NOT NULL AND e.lease_signed_at IS NULL")).bind(ctx.ws, app.id, at)]);
    if (!r.meta.changes) return no(409, app.lease_signed_at ? "You already signed this lease." : `Your application is ${app.stage.toLowerCase()}, so there's no lease to sign.`);
    await ctx.db.batch([
      ctx.db.prepare("INSERT INTO documents (workspace_id, id, property_id, entity_type, entity_id, name, url, mime, doc_type, filed_to, classified_by, extracted, uploaded_by, uploaded_at) VALUES (?1, ?2, ?3, 'applications', ?4, ?5, ?6, 'application/pdf', 'Lease', ?7, ?8, ?9, ?8, ?10)")
        .bind(ctx.ws, uid("doc"), app.property_id, app.id, `Lease, e-signed by ${name}`, `/app/leasing/applications/${app.id}`, `Application ${app.id} › Documents`, row.id, JSON.stringify({ signature: input.signature, signed_at: at, method: "Portal e-signature (demo)" }), at),
      eventStmt(ctx.db, ctx.ws, at, "application.lease_signed", "applications", app.id, app.property_id, { applicant_id: row.id }),
      ctx.db.prepare("INSERT INTO activity_events (workspace_id, id, entity_type, entity_id, property_id, at, actor_kind, actor_id, verb, summary, data) VALUES (?1, ?2, 'applications', ?3, ?4, ?5, 'applicant', ?6, 'lease_signed', ?7, '{}')")
        .bind(ctx.ws, uid("act"), app.id, app.property_id, at, row.id, `${name} e-signed the lease in the applicant portal`),
      notifyManager(ctx, app.property_id, "Lease signed", `${name} signed the lease for ${app.property}. Schedule the move-in.`, `/app/leasing/applications/${app.id}`, ["applications", app.id]),
    ]);
    return ok("Lease signed. The office confirms your move-in day next.");
  },
});

registerAction({
  key: "applicants.pay_fee",
  label: "Pay application fee",
  entity: "applicants",
  roles: ["applicant"],
  money: true,
  input: z.object({}),
  handler: async (ctx, row) => {
    const app = await application(ctx, row.id);
    if (!app) return no(404, "We couldn't find your application");
    return payApplicationFee(ctx, app.id);
  },
  help: { summary: "Pays the application fee by card into the property's trust account. Each application can be paid once.", article: "applicant-portal" },
});

messageAction("applicants", "applicant", "applicant", async (ctx, row) => (await application(ctx, row.id))?.property_id ?? null);
