import { z } from "zod";
import { FileSearch, GitMerge, MailCheck, Megaphone, Send, Sparkles, Wand2, Wrench } from "lucide-react";
import type { ActionContext, ActionResult, Row } from "@/entities/types";
import { registerAction } from "../actions";
import { abstractLease, draftAnnouncement, suggestReply } from "./ai";
import { MERGE_FIELDS, normalizeContact, type Contact } from "./lib";
import { insertRow, newId, one, overlayWrite, sql } from "./server";

// Named actions for the residents lane. runAction (src/app/api/e/_lib/actions.ts) has already
// checked role, scope and `when`, and writes the audit row after a 200.

const STAFF_MSG = ["principal", "regional_manager", "property_manager", "leasing_agent", "maintenance_supervisor", "broker"] as const;
const OPS = ["principal", "regional_manager", "property_manager"] as const;
const ok = (message: string, href?: string): ActionResult => ({ status: 200, message, href });
const fail = (status: 400 | 404 | 409, error: string): ActionResult => ({ status, error });
const nowIso = (ctx: ActionContext) => new Date(ctx.nowMs).toISOString();

async function activity(ctx: ActionContext, entity: string, id: string, propertyId: unknown, verb: string, summary: string, actorKind = "staff") {
  await (await insertRow(ctx.db, ctx.ws, "activity_events", { id: newId("act"), entity_type: entity, entity_id: id, property_id: propertyId ?? null, at: nowIso(ctx), actor_kind: actorKind, actor_id: ctx.actor.personaId, verb, summary, data: "{}" })).run();
}

// ---------------------------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------------------------

const ReplyInput = z.strictObject({
  body: z.string().trim().min(1).max(2000),
  channel: z.enum(["Email", "SMS", "Portal"]),
  close: z.boolean().optional(),
  template_id: z.string().max(80).optional(),
  // Set when the text started as an AI suggestion: the suggestion is recorded as approved or edited.
  proposal_id: z.string().max(80).optional(),
  edited: z.boolean().optional(),
});

registerAction({
  key: "message_threads.reply",
  label: "Send reply",
  entity: "message_threads",
  roles: [...STAFF_MSG],
  icon: Send,
  input: ReplyInput,
  help: { summary: "Sends the reply on the conversation's channel. In this demo sending is simulated: the message is recorded but nothing leaves the system.", article: "unified-inbox" },
  handler: async (ctx, row, input) => {
    const at = nowIso(ctx);
    const proposal = input.proposal_id ? await one(ctx, "SELECT p.id, p.agent FROM {ai_proposals} p WHERE p.id = ? AND p.entity_id = ? AND NOT EXISTS (SELECT 1 FROM {ai_decisions} d WHERE d.proposal_id = p.id)", [input.proposal_id, row.id]) : null;
    const statements = [
      await insertRow(ctx.db, ctx.ws, "messages", { id: newId("msg"), thread_id: row.id, channel: input.channel, direction: "out", sender_kind: "staff", sender_id: ctx.actor.personaId, body: input.body, template_id: input.template_id ?? null, drafted_by_agent: proposal ? proposal.agent : null, sent_at: at }),
    ];
    // Guarded like executeProposal: a double click can't decide the same suggestion twice.
    if (proposal) statements.push(ctx.db.prepare(`INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, note, edited_payload, decided_at) SELECT ?, ?, ?, ?, ?, '', ?, ? WHERE NOT EXISTS (SELECT 1 FROM ai_decisions WHERE proposal_id = ? AND workspace_id IN (?, 'base'))`)
      .bind(ctx.ws, newId("dec"), proposal.id, input.edited ? "Edited" : "Approved", ctx.actor.personaId, input.edited ? JSON.stringify({ message: { body: input.body } }) : null, at, proposal.id, ctx.ws));
    await ctx.db.batch(statements);
    await overlayWrite(ctx.db, ctx.ws, "message_threads", String(row.id), { status: input.close ? "Closed" : "Waiting", unread: 0, last_message_at: at });
    await activity(ctx, "message_threads", String(row.id), row.property_id, "messaged", `${ctx.actor.name} replied by ${input.channel}${proposal ? ` (${input.edited ? "edited AI suggestion" : "AI suggestion"})` : ""}`);
    return ok(`${input.channel} sent (simulated)${input.close ? " · conversation closed" : ""}`);
  },
});

registerAction({
  key: "message_threads.suggest_reply",
  ai: true,
  label: "Suggest a reply",
  entity: "message_threads",
  roles: [...STAFF_MSG],
  icon: Sparkles,
  when: (r) => r.status !== "Closed",
  help: { summary: "Drafts a reply from the conversation and the records it's about. You edit and send it; nothing is sent automatically.", article: "unified-inbox" },
  handler: async (ctx, row) => {
    const r = await suggestReply(ctx, String(row.id));
    return r.ok ? ok(`Reply drafted (${r.source === "live" ? "AI" : "rules"})`, `/app/communications/inbox?t=${encodeURIComponent(String(row.id))}`) : fail(400, r.error);
  },
});

registerAction({
  key: "message_threads.mark_read",
  label: "Mark read",
  entity: "message_threads",
  roles: [...STAFF_MSG],
  icon: MailCheck,
  when: (r) => !!r.unread,
  handler: async (ctx, row) => {
    await overlayWrite(ctx.db, ctx.ws, "message_threads", String(row.id), { unread: 0 });
    return ok("Marked read");
  },
});

// ---------------------------------------------------------------------------------------------
// Residents: merge duplicates, normalise contact details
// ---------------------------------------------------------------------------------------------

const MergeInput = z.strictObject({
  duplicate_id: z.string().min(1).max(80),
  choice: z.record(z.enum(MERGE_FIELDS), z.enum(["keep", "duplicate"])),
  issue_id: z.string().max(80).optional(),
});

registerAction({
  key: "residents.merge",
  label: "Merge duplicate",
  entity: "residents",
  roles: [...OPS],
  icon: GitMerge,
  input: MergeInput,
  confirm: { title: "Merge these residents?", body: "The duplicate is removed and its conversations and requests move to the record you keep.", tone: "warning" },
  help: { summary: "Combines two records for the same person into one, field by field. Ledger history stays on the household.", article: "merge-duplicate-residents" },
  handler: async (ctx, keep, input) => {
    if (input.duplicate_id === keep.id) return fail(400, "Pick a different record to merge");
    const dup = await one(ctx, "SELECT * FROM {residents} WHERE id = ?", [input.duplicate_id]);
    if (!dup) return fail(404, "Duplicate not found");
    // Same household only: merging moves conversations and requests, and must never pull a
    // record (or its history) across households or properties.
    if (dup.property_id !== keep.property_id || dup.household_id !== keep.household_id) return fail(409, "Only residents in the same household can be merged");
    const changes: Row = {};
    for (const f of MERGE_FIELDS) if (input.choice[f] === "duplicate") changes[f] = dup[f];
    const at = nowIso(ctx);
    const { before } = await overlayWrite(ctx.db, ctx.ws, "residents", String(keep.id), changes);
    await overlayWrite(ctx.db, ctx.ws, "residents", String(dup.id), {}, { tombstone: true });
    for (const t of await sql(ctx, "SELECT id FROM {message_threads} WHERE party_kind = 'resident' AND party_id = ?", [dup.id])) await overlayWrite(ctx.db, ctx.ws, "message_threads", String(t.id), { party_id: keep.id });
    for (const s of await sql(ctx, "SELECT id FROM {service_requests} WHERE resident_id = ?", [dup.id])) await overlayWrite(ctx.db, ctx.ws, "service_requests", String(s.id), { resident_id: keep.id });
    const issues = await sql(ctx, "SELECT id FROM {data_issues} WHERE rule_id = 'residents.possible_duplicate' AND status = 'open' AND (entity_id IN (?, ?) OR id = ?)", [keep.id, dup.id, input.issue_id ?? ""]);
    for (const i of issues) {
      await overlayWrite(ctx.db, ctx.ws, "data_issues", String(i.id), { status: "fixed", fixed_by: ctx.actor.personaId, fixed_at: at });
      await (await insertRow(ctx.db, ctx.ws, "data_fix_log", { id: newId("fix"), issue_id: i.id, entity_type: "residents", entity_id: keep.id, before_json: JSON.stringify({ ...before, merged_from: dup.id }), after_json: JSON.stringify({ ...changes, merged: true }), fixed_by: ctx.actor.personaId, agent: null, at })).run();
    }
    await activity(ctx, "residents", String(keep.id), keep.property_id, "merged", `${ctx.actor.name} merged duplicate ${dup.first_name} ${dup.last_name} (${dup.id}) into this record`);
    return ok(`Merged ${dup.first_name} ${dup.last_name} into ${keep.name}`);
  },
});

registerAction({
  key: "residents.normalize_contact",
  label: "Fix contact details",
  entity: "residents",
  roles: [...OPS, "leasing_agent"],
  icon: Wand2,
  when: (r) => normalizeContact({ first_name: String(r.first_name ?? ""), last_name: String(r.last_name ?? ""), email: String(r.email ?? ""), phone: String(r.phone ?? "") }).length > 0,
  help: { summary: "Moves a phone number out of the email field, formats phones as (555) 555-5555 and fixes name capitalisation.", article: "contact-normalization" },
  handler: async (ctx, row) => {
    const raw = await one(ctx, "SELECT first_name, last_name, email, phone FROM {residents} WHERE id = ?", [row.id]);
    const changes = normalizeContact(raw as unknown as Contact);
    if (!changes.length) return ok("Contact details already look right");
    const at = nowIso(ctx);
    const { before, after } = await overlayWrite(ctx.db, ctx.ws, "residents", String(row.id), Object.fromEntries(changes.map((c) => [c.field, c.after])));
    for (const i of await sql(ctx, "SELECT id FROM {data_issues} WHERE entity_type = 'residents' AND entity_id = ? AND rule_id = 'residents.phone_in_email' AND status = 'open'", [row.id])) {
      await overlayWrite(ctx.db, ctx.ws, "data_issues", String(i.id), { status: "fixed", fixed_by: ctx.actor.personaId, fixed_at: at });
      await (await insertRow(ctx.db, ctx.ws, "data_fix_log", { id: newId("fix"), issue_id: i.id, entity_type: "residents", entity_id: row.id, before_json: JSON.stringify(before), after_json: JSON.stringify(after), fixed_by: ctx.actor.personaId, agent: null, at })).run();
    }
    await activity(ctx, "residents", String(row.id), row.property_id, "updated", `${ctx.actor.name} fixed contact details: ${changes.map((c) => c.field.replace(/_/g, " ")).join(", ")}`);
    return ok(`Updated ${changes.map((c) => c.field.replace(/_/g, " ")).join(", ")}`);
  },
});

// ---------------------------------------------------------------------------------------------
// Leases: abstraction
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "leases.abstract",
  ai: true,
  label: "Abstract lease document",
  entity: "leases",
  roles: [...OPS, "broker", "accountant"],
  icon: FileSearch,
  input: z.strictObject({ name: z.string().trim().min(1).max(160).optional(), text: z.string().max(60_000).optional() }),
  help: { summary: "Reads the lease document, lists each term with its page, and flags any term that differs from the lease record.", article: "lease-abstraction" },
  handler: async (ctx, row, input) => {
    if (input.text != null && input.text.trim().length < 200) return fail(400, "That document is too short to be a lease. Paste or upload the full text.");
    const r = await abstractLease(ctx, String(row.id), input.text ? { name: input.name ?? "Uploaded lease", text: input.text } : undefined);
    if (!r.ok) return fail(400, r.error);
    return ok(r.mismatches ? `${r.mismatches} term${r.mismatches === 1 ? "" : "s"} differ from the record` : "Every term matches the record", `/app/leases/${encodeURIComponent(String(row.id))}?tab=abstraction`);
  },
});

// ---------------------------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------------------------

// Announcements go to one property, so a draft starts from the property.
registerAction({
  key: "properties.new_announcement",
  label: "New announcement",
  entity: "properties",
  roles: [...OPS],
  icon: Megaphone,
  input: z.strictObject({ title: z.string().trim().min(3).max(160), body: z.string().trim().max(4000).optional(), channels: z.array(z.enum(["Email", "SMS", "Portal"])).min(1).max(3).optional() }),
  handler: async (ctx, row, input) => {
    const id = newId("ann");
    await (await insertRow(ctx.db, ctx.ws, "announcements", { id, title: input.title, body: input.body ?? "", audience: { property_ids: [row.id], kinds: ["resident"] }, channels: input.channels ?? ["Email", "SMS"], status: "Draft", send_at: null, recipients: 0, created_by: ctx.actor.personaId })).run();
    return ok("Draft created", `/app/communications/announcements/new?id=${encodeURIComponent(id)}`);
  },
});

registerAction({
  key: "announcements.ai_draft",
  ai: true,
  label: "Draft with AI",
  entity: "announcements",
  roles: [...OPS],
  icon: Sparkles,
  input: z.strictObject({ topic: z.string().trim().min(3).max(500) }),
  when: (r) => r.status === "Draft",
  handler: async (ctx, row, input) => {
    const r = await draftAnnouncement(ctx, String(row.id), input.topic);
    return r.ok ? ok(`Draft written (${r.source === "live" ? "AI" : "rules"})`, `/app/communications/announcements/new?id=${encodeURIComponent(String(row.id))}&run=${r.runId}&src=${r.source}`) : fail(400, r.error);
  },
});

const SendInput = z.strictObject({
  title: z.string().trim().min(3).max(160),
  body: z.string().trim().min(10).max(4000),
  channels: z.array(z.enum(["Email", "SMS", "Portal"])).min(1).max(3),
  send_at: z.string().datetime().optional(),
});

registerAction({
  key: "announcements.send",
  label: "Send announcement",
  entity: "announcements",
  roles: [...OPS],
  icon: Megaphone,
  input: SendInput,
  when: (r) => r.status === "Draft" || r.status === "Scheduled",
  help: { summary: "Sends to every current and notice resident at the property on the channels you pick. Sending is simulated in this demo.", article: "announcements" },
  handler: async (ctx, row, input) => {
    const a = await one(ctx, "SELECT audience FROM {announcements} WHERE id = ?", [row.id]);
    const pid = JSON.parse(String(a?.audience ?? "{}")).property_ids?.[0];
    if (!pid) return fail(400, "Pick a property first");
    const n = await one<{ n: number }>(ctx, "SELECT count(*) AS n FROM {residents} WHERE property_id = ? AND status IN ('Current', 'Notice')", [pid]);
    const later = input.send_at && Date.parse(input.send_at) > ctx.nowMs;
    await overlayWrite(ctx.db, ctx.ws, "announcements", String(row.id), { title: input.title, body: input.body, channels: input.channels, status: later ? "Scheduled" : "Sent", send_at: input.send_at ?? nowIso(ctx), recipients: Number(n?.n ?? 0), created_by: ctx.actor.personaId });
    return ok(later ? `Scheduled for ${Number(n?.n ?? 0)} residents` : `Sent to ${Number(n?.n ?? 0)} residents (simulated)`, "/app/communications/announcements");
  },
});

// ---------------------------------------------------------------------------------------------
// Service requests → work orders
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "service_requests.convert",
  label: "Create work order",
  entity: "service_requests",
  roles: [...OPS, "maintenance_supervisor"],
  icon: Wrench,
  when: (r) => r.status === "New" || r.status === "Triaged",
  help: { summary: "Turns the request into a work order with the request's trade and urgency, and links the two.", article: "service-requests" },
  handler: async (ctx, row) => {
    const sr = await one(ctx, "SELECT * FROM {service_requests} WHERE id = ?", [row.id]);
    if (!sr) return fail(404, "Request not found");
    const at = nowIso(ctx);
    const priority = (sr.urgency as string) ?? "Normal";
    const hours = { Emergency: 4, Urgent: 24, Normal: 72, Low: 168 }[priority] ?? 72;
    // Never reuse a base id: an overlay row with a base id would replace that work order.
    const wo = newId("WO");
    await (await insertRow(ctx.db, ctx.ws, "work_orders", {
      id: wo, property_id: sr.property_id, unit_id: sr.unit_id ?? null, title: String(sr.body).split(/[.!?\n]/)[0].slice(0, 80), description: sr.body,
      category: (sr.category as string) ?? "General", priority, status: "New", source: "Resident", opened_at: at, sla_due_at: new Date(ctx.nowMs + hours * 3_600_000).toISOString(),
    })).run();
    await overlayWrite(ctx.db, ctx.ws, "service_requests", String(row.id), { status: "Converted", work_order_id: wo, category: sr.category ?? "General", urgency: priority });
    return ok(`Work order ${wo} created`, `/app/maintenance/work-orders/${wo}`);
  },
});
