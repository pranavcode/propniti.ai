import { z } from "zod";
import { CheckCircle2, ClipboardCheck, Clock, DollarSign, ImagePlus, KeyRound, PlayCircle, ScanSearch, Send, Sparkles, Truck, Wrench } from "lucide-react";
import type { ActionContext, ActionResult, Role, Row } from "@/entities/types";
import { startRun } from "@/ai/orchestrator";
import { effective as effectiveSql } from "@/server/effective";
import { approveAndPayWorkOrder } from "@/server/money";
import { nowIso } from "@/server/workspace";
import { AS_OF } from "@/seed/constants";
import { verifiedCoiExpirySql } from "@/extensions/risk/sql";
import { registerAction } from "../actions";
import { checkPhoto, nextDue, PHOTO_TAGS, policyCheck, usd, validateInvoice } from "./rules";
import { insertStmt, newId, OPEN_STATUSES, parse, row as readRow, update, updateStmt } from "./store";
import { invoiceInputs, policyFor, techCovers } from "./queries";

// Named actions for the maintenance module. Each runs inside the generic action route, which has
// already checked the role, module access, the record's scope and `when`, and audits success.
// Money goes only through approveAndPayWorkOrder (src/server/money.ts): one guarded batch, so a
// double click pays once.

const SUP: Role[] = ["principal", "regional_manager", "property_manager", "maintenance_supervisor"];
// Vendors reach only their own jobs (portal "self" scope, applied before any handler runs) and only
// through these actions: accept or decline, add photos, submit an invoice. Never status or amounts directly.
const SUP_AND_VENDOR: Role[] = [...SUP, "vendor"];
const ok = (message: string, href?: string): ActionResult => ({ status: 200, message, href });
const conflict = (error: string): ActionResult => ({ status: 409, error });
const isOpen = (r: Row) => (OPEN_STATUSES as readonly string[]).includes(String(r.status));
export const SLA_HOURS: Record<string, number> = { Emergency: 4, Urgent: 24, Normal: 72, Low: 168 };
const addHours = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

async function woEvent(c: ActionContext, wo: Row, kind: string, detail: object, status?: string) {
  const vendor = c.actor.role === "vendor";
  return insertStmt(c.db, c.ws, "wo_events", { id: newId("woe"), work_order_id: wo.id, property_id: wo.property_id, at: nowIso(c.nowMs), actor_kind: vendor ? "vendor" : "staff", actor_id: vendor ? wo.vendor_id : c.actor.personaId, kind, status: status ?? null, detail });
}

// ---------------------------------------------------------------------------------------------
// Intake: triage with the Maintenance Triage agent, then dispatch
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "work_orders.run_triage",
  ai: true,
  label: "Triage with AI",
  entity: "work_orders",
  roles: SUP,
  icon: Sparkles,
  when: (r) => ["New", "Triaged"].includes(String(r.status)),
  help: { summary: "Runs the Maintenance Triage agent on this request: trade, urgency, estimate, ranked vendors and the owner approval limit.", article: "maintenance-triage-agent" },
  handler: async (c, r) => {
    const { runId, done } = await startRun({ db: c.db, ws: c.ws, actor: c.actor, agent: "maintenance_triage", trigger: { kind: "manual", input: { work_order_id: r.id } }, deadlineMs: 20_000 });
    const res = await done;
    if (res.status === "failed") return { status: 400, error: `The triage run failed: ${res.summary}` };
    // The agent may have changed the trade; re-check the request's photos against it.
    const wo = await readRow<{ category: string; title: string }>(c.db, c.ws, "work_orders", String(r.id));
    const { results: photos } = await c.db.prepare(`SELECT id, url FROM ${effectiveSql("photos")} p WHERE p.entity_type = 'work_orders' AND p.entity_id = ?2`).bind(c.ws, r.id).all<{ id: string; url: string }>();
    if (wo && photos.length) await c.db.batch(await Promise.all(photos.map((p) => { const k = checkPhoto(p.url, wo.category, wo.title); return updateStmt(c.db, c.ws, "photos", p.id, { check_result: k.result, check_confidence: k.confidence, check_note: k.note }); })));
    return ok(res.summary, `/app/maintenance/intake/${encodeURIComponent(String(r.id))}?run=${runId}`);
  },
});

const Dispatch = z.strictObject({
  vendor_id: z.string().max(40).nullable(),
  assignee_id: z.string().max(40).nullable().optional(),
  priority: z.enum(["Emergency", "Urgent", "Normal", "Low"]),
  category: z.string().trim().min(1).max(40),
  estimate: z.number().positive().max(100_000).optional(),
  proposal_id: z.string().max(80).optional(),
});

registerAction({
  key: "work_orders.dispatch",
  label: "Dispatch",
  entity: "work_orders",
  roles: SUP,
  icon: Truck,
  input: Dispatch,
  when: (r) => ["New", "Triaged", "Assigned", "On hold"].includes(String(r.status)),
  help: { summary: "Assigns the vendor or technician, sets trade, priority and SLA, and checks the owner's approval limit first.", article: "maintenance-triage-agent" },
  handler: async (c, r, input) => {
    if (!input.vendor_id && !input.assignee_id) return { status: 400, error: "Pick a vendor or an in-house technician." };
    let vendorName = "";
    if (input.vendor_id) {
      const v = await c.db.prepare(`SELECT v.company, v.status, ${verifiedCoiExpirySql(effectiveSql("vendor_cois"), "v.id")} AS coi FROM ${effectiveSql("vendors")} v WHERE v.id = ?2`).bind(c.ws, input.vendor_id).first<{ company: string; status: string; coi: string | null }>();
      if (!v) return { status: 404, error: "Vendor not found" };
      if (v.status !== "Active") return conflict(`${v.company} is marked "${v.status}" and can't be dispatched.`);
      if (!v.coi || v.coi < AS_OF) return conflict(`${v.company}'s verified insurance certificate ${v.coi ? `expired on ${v.coi}` : "is missing, or still waiting for verification"}. Verify or request a current COI before dispatching.`);
      vendorName = v.company;
    }
    if (input.assignee_id && !(await techCovers(c.db, c.ws, input.assignee_id, String(r.property_id)))) return { status: 403, error: "That technician doesn't work at this property. Pick one assigned to it." };
    const estimateCents = Math.round((input.estimate ?? Number(r.estimate ?? 0)) * 100);
    const pol = policyCheck(estimateCents, await policyFor(c.db, c.ws, String(r.property_id)));
    const status = pol.level === "owner" ? "On hold" : "Assigned";
    const at = nowIso(c.nowMs);
    const changes: Row = { vendor_id: input.vendor_id, assignee_id: input.assignee_id ?? null, priority: input.priority, category: input.category, status, sla_due_at: addHours(String(r.opened_at), SLA_HOURS[input.priority]) };
    if (estimateCents) changes.estimate_cents = estimateCents;
    // The guard compares against the row as this request read it, so of two clicks (or two people)
    // only the first dispatch lands; the second finds the job already changed.
    const lit = (v: unknown) => `'${String(v ?? "").replace(/'/g, "''")}'`;
    const guard = `e.status = ${lit(r.status)} AND coalesce(e.vendor_id, '') = ${lit(r.vendor_id)} AND coalesce(e.assignee_id, '') = ${lit(r.assignee_id)}`;
    const upd = await updateStmt(c.db, c.ws, "work_orders", String(r.id), changes, guard);
    const [res] = await c.db.batch([upd]);
    if (!res.meta.changes) return conflict(`${r.id} changed while you were dispatching it. Reload and try again.`);
    const stmts = [await woEvent(c, r, "Assigned", { vendor_id: input.vendor_id, assignee_id: input.assignee_id ?? null, priority: input.priority, category: input.category, estimate_cents: estimateCents, policy: pol.text }, status)];
    if (pol.level === "owner") stmts.push(...(await ownerRequestStmts(c, r, estimateCents)));
    if (input.proposal_id) {
      // Close the agent's open proposal so it leaves the approvals inbox with the decision recorded.
      const p = await c.db.prepare(`SELECT p.id, p.payload FROM ${effectiveSql("ai_proposals")} p WHERE p.id = ?2 AND p.entity_id = ?3`).bind(c.ws, input.proposal_id, r.id).first<{ id: string; payload: string }>();
      if (p) {
        const picked = (parse<{ effects?: { changes?: { vendor_id?: string | null } }[] }>(p.payload, {}).effects ?? [])[0]?.changes?.vendor_id ?? null;
        const same = picked === input.vendor_id;
        stmts.push(c.db.prepare(`INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, note, edited_payload, decided_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE NOT EXISTS (SELECT 1 FROM ${effectiveSql("ai_decisions")} d WHERE d.proposal_id = ?3)`)
          .bind(c.ws, newId("dec"), p.id, same ? "Approved" : "Edited", c.actor.personaId, same ? "Dispatched as suggested" : `Dispatched to ${vendorName || "in-house technician"} instead`, same ? null : JSON.stringify({ vendor_id: input.vendor_id, assignee_id: input.assignee_id ?? null }), at));
      }
    }
    stmts.push(c.db.prepare("INSERT INTO events (workspace_id, id, type, entity_type, entity_id, property_id, payload, created_at) VALUES (?, ?, 'wo.dispatched', 'work_orders', ?, ?, ?, ?)").bind(c.ws, newId("evt"), r.id, r.property_id, JSON.stringify({ vendor_id: input.vendor_id, estimate_cents: estimateCents }), at));
    await c.db.batch(stmts);
    const who = vendorName || "the in-house technician";
    return ok(pol.level === "owner" ? `${r.id} is on hold until the owner approves ${usd(estimateCents)}. ${who} is lined up.` : `${r.id} dispatched to ${who}.`);
  },
});

async function ownerRequestStmts(c: ActionContext, r: Row, amountCents: number) {
  const owner = await c.db.prepare(`SELECT e.owner_id FROM ${effectiveSql("properties")} p JOIN ${effectiveSql("owner_entities")} e ON e.id = p.owner_entity_id WHERE p.id = ?2`).bind(c.ws, r.property_id).first<{ owner_id: string }>();
  const at = nowIso(c.nowMs);
  const out = [await woEvent(c, r, "Approval", { requested_from: "owner", owner_id: owner?.owner_id ?? null, amount_cents: amountCents })];
  if (owner) out.push(await insertStmt(c.db, c.ws, "notifications", { id: newId("ntf"), user_id: owner.owner_id, title: "Repair needs your approval", body: `${r.title} at ${r.property_id__label ?? r.property_id}: estimate ${usd(amountCents)}, over your approval limit.`, href: "/portal/owner/approvals", entity_type: "work_orders", entity_id: r.id, at }));
  return out;
}

registerAction({
  key: "work_orders.request_owner_approval",
  label: "Ask owner to approve",
  entity: "work_orders",
  roles: SUP,
  icon: Send,
  when: (r) => isOpen(r) && r.status !== "Submitted",
  handler: async (c, r) => {
    const amount = Math.round(Number(r.estimate ?? 0) * 100);
    if (!amount) return { status: 400, error: "Add an estimate first, so the owner knows what they're approving." };
    const [res] = await c.db.batch([await updateStmt(c.db, c.ws, "work_orders", String(r.id), { status: "On hold" }, "e.status NOT IN ('Completed', 'Paid', 'Cancelled', 'Submitted')"), ...(await ownerRequestStmts(c, r, amount))]);
    return res.meta.changes ? ok(`Sent ${usd(amount)} to the owner for approval. ${r.id} is on hold.`) : conflict(`${r.id} can't be put on hold now.`);
  },
});

registerAction({
  key: "work_orders.vendor_accept",
  label: "Accept job",
  entity: "work_orders",
  roles: ["vendor"],
  icon: CheckCircle2,
  input: z.strictObject({ scheduled_at: z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), "Not a date and time") }),
  when: (r) => r.status === "Assigned" && !!r.vendor_id,
  handler: async (c, r, input) => {
    const at = new Date(input.scheduled_at).toISOString();
    const [res] = await c.db.batch([await updateStmt(c.db, c.ws, "work_orders", String(r.id), { status: "Scheduled", scheduled_at: at }, `e.status = 'Assigned' AND e.vendor_id = '${String(r.vendor_id).replace(/'/g, "''")}'`)]);
    if (!res.meta.changes) return conflict(`${r.id} is no longer waiting for you to accept it.`);
    await (await woEvent(c, r, "Status", { accepted: true, scheduled_at: at }, "Scheduled")).run();
    return ok(`Accepted. ${r.id} is scheduled.`);
  },
});

registerAction({
  key: "work_orders.vendor_decline",
  label: "Decline job",
  entity: "work_orders",
  roles: ["vendor"],
  input: z.strictObject({ reason: z.string().trim().min(3).max(300) }),
  when: (r) => ["Assigned", "Scheduled"].includes(String(r.status)) && !!r.vendor_id,
  handler: async (c, r, input) => {
    const [res] = await c.db.batch([await updateStmt(c.db, c.ws, "work_orders", String(r.id), { status: "Triaged", vendor_id: null, scheduled_at: null }, `e.status IN ('Assigned', 'Scheduled') AND e.vendor_id = '${String(r.vendor_id).replace(/'/g, "''")}'`)]);
    if (!res.meta.changes) return conflict(`${r.id} can't be declined now.`);
    await c.db.batch([
      await woEvent(c, r, "Status", { declined: true, reason: input.reason }, "Triaged"),
      c.db.prepare("INSERT INTO events (workspace_id, id, type, entity_type, entity_id, property_id, payload, created_at) VALUES (?, ?, 'wo.vendor_declined', 'work_orders', ?, ?, ?, ?)").bind(c.ws, newId("evt"), r.id, r.property_id, JSON.stringify({ vendor_id: r.vendor_id, reason: input.reason }), nowIso(c.nowMs)),
    ]);
    return ok(`Declined. The property team will reassign ${r.id}.`);
  },
});

// ---------------------------------------------------------------------------------------------
// Technician updates
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "work_orders.set_status",
  label: "Update status",
  entity: "work_orders",
  roles: SUP,
  icon: PlayCircle,
  input: z.strictObject({ status: z.enum(["Scheduled", "In progress", "On hold", "Completed"]), note: z.string().trim().max(500).optional() }),
  when: (r) => ["Assigned", "Scheduled", "In progress", "On hold"].includes(String(r.status)),
  handler: async (c, r, input) => {
    // Vendor jobs finish by invoice (Submitted → approve and pay); only in-house jobs complete here.
    if (input.status === "Completed" && r.vendor_id) return conflict("Vendor jobs complete when their invoice is approved. Submit the invoice instead.");
    const changes: Row = { status: input.status };
    if (input.status === "Completed") changes.completed_at = nowIso(c.nowMs);
    if (input.status === "Scheduled") changes.scheduled_at = nowIso(c.nowMs);
    const [res] = await c.db.batch([await updateStmt(c.db, c.ws, "work_orders", String(r.id), changes, "e.status IN ('Assigned', 'Scheduled', 'In progress', 'On hold')")]);
    if (!res.meta.changes) return conflict(`${r.id} is no longer open.`);
    await (await woEvent(c, r, "Status", { from: r.status, note: input.note ?? null }, input.status)).run();
    return ok(`${r.id}: ${String(r.status).toLowerCase()} → ${input.status.toLowerCase()}.`);
  },
});

registerAction({
  key: "work_orders.log_time",
  label: "Log time",
  entity: "work_orders",
  roles: SUP,
  icon: Clock,
  input: z.strictObject({ minutes: z.number().int().min(5).max(720), note: z.string().trim().max(500).optional() }),
  when: isOpen,
  handler: async (c, r, input) => {
    await (await woEvent(c, r, "Time", { minutes: input.minutes, note: input.note ?? null })).run();
    return ok(`Logged ${input.minutes >= 60 ? `${Math.floor(input.minutes / 60)} h ${input.minutes % 60 ? `${input.minutes % 60} min` : ""}`.trim() : `${input.minutes} min`} on ${r.id}.`);
  },
});

// ---------------------------------------------------------------------------------------------
// Photos and photo checks
// ---------------------------------------------------------------------------------------------

export const SAMPLE_PHOTOS = Object.keys(PHOTO_TAGS).map((t) => `/img/wo/wo-${t}.webp`);

registerAction({
  key: "work_orders.add_photo",
  label: "Add photo",
  entity: "work_orders",
  roles: SUP_AND_VENDOR,
  icon: ImagePlus,
  input: z.strictObject({ url: z.enum(SAMPLE_PHOTOS as [string, ...string[]]), stage: z.enum(["Before", "After", "Evidence"]), caption: z.string().trim().max(200).optional() }),
  handler: async (c, r, input) => {
    // Once the invoice is in, vendors can't add evidence to it. Staff still can, but photos added
    // after the invoice don't count toward its photo requirement.
    if (c.actor.role === "vendor" && ["Submitted", "Completed", "Paid"].includes(String(r.status))) return conflict("The invoice for this job is already in. Photos can't be added to it now.");
    const chk = checkPhoto(input.url, String(r.category), String(r.title));
    await (await insertStmt(c.db, c.ws, "photos", {
      id: newId("ph"), entity_type: "work_orders", entity_id: r.id, property_id: r.property_id, url: input.url, caption: input.caption || PHOTO_TAGS[input.url.match(/wo-(.+)\.webp$/)![1]].label,
      stage: input.stage, taken_at: nowIso(c.nowMs), check_result: chk.result, check_confidence: chk.confidence, check_note: chk.note,
    })).run();
    return ok(`Photo added. Photo check: ${chk.result.toLowerCase()} (${Math.round(chk.confidence * 100)}% confident).`);
  },
});

registerAction({
  key: "work_orders.check_photos",
  label: "Run photo check",
  entity: "work_orders",
  roles: SUP,
  icon: ScanSearch,
  bulk: true,
  help: { summary: "Checks that each photo shows what the work order describes, with a confidence score. Mismatches go to a person.", article: "photo-checks" },
  handler: async (c, r) => {
    const { results } = await c.db.prepare(`SELECT id, url FROM ${effectiveSql("photos")} p WHERE p.entity_type = 'work_orders' AND p.entity_id = ?2`).bind(c.ws, r.id).all<{ id: string; url: string }>();
    if (!results.length) return conflict(`${r.id} has no photos to check.`);
    const checks = results.map((p) => ({ id: p.id, ...checkPhoto(p.url, String(r.category), String(r.title)) }));
    await c.db.batch(await Promise.all(checks.map((k) => updateStmt(c.db, c.ws, "photos", k.id, { check_result: k.result, check_confidence: k.confidence, check_note: k.note }))));
    const flagged = checks.filter((k) => k.result !== "Matches").length;
    return ok(`${checks.length} photo${checks.length > 1 ? "s" : ""} checked${flagged ? `, ${flagged} flagged for review` : ", all match"}.`);
  },
});

// ---------------------------------------------------------------------------------------------
// Vendor invoice → validate → approve and pay
// ---------------------------------------------------------------------------------------------

const InvoiceInput = z.strictObject({
  invoice_number: z.string().trim().min(1).max(40),
  lines: z.array(z.strictObject({ description: z.string().trim().min(1).max(200), amount: z.number().min(0).max(100_000) })).min(1).max(20),
  total: z.number().positive().max(100_000),
  source: z.enum(["read", "manual"]),
  read_confidence: z.number().min(0).max(1).optional(),
});

registerAction({
  key: "work_orders.submit_invoice",
  label: "Record vendor invoice",
  entity: "work_orders",
  roles: SUP_AND_VENDOR,
  icon: DollarSign,
  input: InvoiceInput,
  when: (r) => !!r.vendor_id && ["Assigned", "Scheduled", "In progress", "On hold", "Submitted"].includes(String(r.status)),
  help: { summary: "Records the vendor's invoice on the work order and checks it line by line against the purchase order.", article: "approve-pay-work-order" },
  handler: async (c, r, input) => {
    const lines = input.lines.map((l) => ({ description: l.description, amount_cents: Math.round(l.amount * 100) }));
    const total = Math.round(input.total * 100);
    const [res] = await c.db.batch([await updateStmt(c.db, c.ws, "work_orders", String(r.id), { status: "Submitted", cost_cents: total }, "e.status IN ('Assigned', 'Scheduled', 'In progress', 'On hold', 'Submitted')")]);
    if (!res.meta.changes) return conflict(`${r.id} can't take an invoice now.`);
    const { po, photos } = await invoiceInputs(c.db, c.ws, String(r.id));
    const v = validateInvoice(po, { lines, total_cents: total, photos });
    await c.db.batch([
      await woEvent(c, r, "Submission", { invoice_number: input.invoice_number, lines, total_cents: total, source: input.source, read_confidence: input.read_confidence ?? null }, "Submitted"),
      await woEvent(c, r, "Validation", { ...v, source: "rules" }),
    ]);
    return ok(v.issues.length ? `Invoice recorded. ${v.summary}` : `Invoice recorded and matches the PO. Ready to approve.`);
  },
});

registerAction({
  key: "work_orders.approve_and_pay",
  label: "Approve and pay",
  entity: "work_orders",
  roles: SUP,
  icon: CheckCircle2,
  money: true,
  // expected_cents: the invoice total the person reviewed, so a resubmission in between isn't paid unseen.
  input: z.strictObject({ note: z.string().trim().max(500).optional(), expected_cents: z.number().int().positive().optional() }),
  when: (r) => r.status === "Submitted",
  confirm: { title: "Approve and pay this invoice?", body: "The vendor is paid from the property's trust account by ACH. This can't be undone here.", tone: "warning" },
  help: { summary: "Approves the vendor's work and pays the invoice from trust, within the owner's approval limit. Paying twice is impossible.", article: "approve-pay-work-order" },
  handler: async (c, r, input) => {
    const { po, photos, submission } = await invoiceInputs(c.db, c.ws, String(r.id));
    if (input.expected_cents != null && submission?.total_cents !== input.expected_cents) return conflict("The vendor's invoice changed since you opened it. Reload and review it again.");
    if (submission) {
      const v = validateInvoice(po, { lines: submission.lines, total_cents: submission.total_cents, photos });
      if (v.issues.length && (input.note ?? "").length < 8) return conflict(`${v.summary} To pay anyway, add a short note saying why.`);
      if (v.issues.length) await (await woEvent(c, r, "Validation", { ...v, source: "rules", override: input.note })).run();
    }
    return approveAndPayWorkOrder(c, String(r.id));
  },
});

// ---------------------------------------------------------------------------------------------
// Turnovers (make-ready)
// ---------------------------------------------------------------------------------------------

type Step = { step: string; done: boolean; by: string | null; at?: string | null };

registerAction({
  key: "turnovers.toggle_step",
  label: "Update checklist",
  entity: "turnovers",
  roles: SUP,
  icon: ClipboardCheck,
  input: z.strictObject({ index: z.number().int().min(0).max(30), done: z.boolean() }),
  when: (r) => ["Not started", "In progress"].includes(String(r.status)),
  handler: async (c, r, input) => {
    const raw = await readRow<{ checklist: string; status: string }>(c.db, c.ws, "turnovers", String(r.id));
    const steps = parse<Step[]>(raw?.checklist, []);
    if (!steps[input.index]) return { status: 400, error: "No such step" };
    steps[input.index] = { ...steps[input.index], done: input.done, by: input.done ? c.actor.name : null, at: input.done ? AS_OF : null };
    const doneCount = steps.filter((s) => s.done).length;
    // Guard on the checklist we read, so two people ticking at once can't overwrite each other.
    const okWrite = await update(c.db, c.ws, "turnovers", String(r.id), { checklist: steps, status: doneCount ? "In progress" : "Not started" }, `e.checklist = '${String(raw?.checklist).replace(/'/g, "''")}'`);
    if (!okWrite) return conflict("Someone else just updated this checklist. Reload to see their change.");
    return ok(`${steps[input.index].step} ${input.done ? "done" : "reopened"} (${doneCount} of ${steps.length}).`);
  },
});

registerAction({
  key: "turnovers.add_cost",
  label: "Add cost",
  entity: "turnovers",
  roles: SUP,
  icon: DollarSign,
  input: z.strictObject({ amount: z.number().positive().max(50_000), item: z.string().trim().min(2).max(120) }),
  when: (r) => r.status !== "Leased",
  handler: async (c, r, input) => {
    const cents = Math.round(input.amount * 100);
    const cur = Number((await readRow<{ cost_cents: number }>(c.db, c.ws, "turnovers", String(r.id)))?.cost_cents ?? 0);
    if (!(await update(c.db, c.ws, "turnovers", String(r.id), { cost_cents: cur + cents }, `e.cost_cents = ${cur}`))) return conflict("Someone else just changed this turnover's cost. Reload and try again.");
    await (await insertStmt(c.db, c.ws, "activity_events", { id: newId("act"), entity_type: "turnovers", entity_id: r.id, property_id: r.property_id, at: nowIso(c.nowMs), actor_kind: "staff", actor_id: c.actor.personaId, verb: "cost_added", summary: `${usd(cents)} added: ${input.item}`, data: { amount_cents: cents, item: input.item } })).run();
    return ok(`${usd(cents)} added for ${input.item}.`);
  },
});

registerAction({
  key: "turnovers.mark_ready",
  label: "Mark rent-ready",
  entity: "turnovers",
  roles: SUP,
  icon: CheckCircle2,
  when: (r) => ["Not started", "In progress"].includes(String(r.status)) && Number(r.progress) === 1,
  handler: async (c, r) => {
    const okWrite = await update(c.db, c.ws, "turnovers", String(r.id), { status: "Ready", ready_on: AS_OF }, "NOT EXISTS (SELECT 1 FROM json_each(e.checklist) j WHERE json_extract(j.value, '$.done') = 0) AND e.status IN ('Not started', 'In progress')");
    return okWrite ? ok(`${r.title} is rent-ready. Leasing can list it.`) : conflict("Finish every checklist step first.");
  },
});

// ---------------------------------------------------------------------------------------------
// Preventive schedules
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "pm_schedules.generate",
  label: "Create work order",
  entity: "pm_schedules",
  roles: SUP,
  icon: Wrench,
  bulk: true,
  when: (r) => !!r.active,
  help: { summary: "Creates the work order for the next due date and moves the schedule to the following one.", article: "preventive-maintenance-schedules" },
  handler: async (c, r) => {
    const due = String(r.next_due_on);
    const next = nextDue(due, String(r.frequency));
    // Advancing next_due_on is the claim: a second click sees a different date and does nothing.
    // One open work order per schedule: the next one is created after this one closes.
    const noOpen = `NOT EXISTS (SELECT 1 FROM ${effectiveSql("work_orders")} AS w WHERE w.pm_schedule_id = e.id AND w.status NOT IN ('Completed', 'Paid', 'Cancelled'))`;
    const [claim] = await c.db.batch([await updateStmt(c.db, c.ws, "pm_schedules", String(r.id), { next_due_on: next }, `e.next_due_on = '${due}' AND e.active = 1 AND ${noOpen}`)]);
    if (!claim.meta.changes) return conflict(`${r.name} already has an open work order. The next one, due ${due}, can be created after it closes.`);
    const at = nowIso(c.nowMs);
    const woId = `WO-PM-${newId("x").slice(2, 10).toUpperCase()}`;
    const priority = String(r.category) === "Life safety" ? "Urgent" : "Normal";
    const steps = parse<string[]>(r.checklist, []);
    await c.db.batch([
      await insertStmt(c.db, c.ws, "work_orders", {
        id: woId, property_id: r.property_id, unit_id: null, pm_schedule_id: r.id, title: String(r.name), description: steps.length ? `Checklist: ${steps.join("; ")}.` : "", category: String(r.category), priority, source: "Preventive",
        status: r.vendor_id || r.assignee_id ? "Assigned" : "New", vendor_id: r.vendor_id ?? null, assignee_id: r.assignee_id ?? null, sla_due_at: `${due}T23:59:00Z`, opened_at: at, permission_to_enter: 1,
      }),
      await insertStmt(c.db, c.ws, "wo_events", { id: newId("woe"), work_order_id: woId, property_id: r.property_id, at, actor_kind: "staff", actor_id: c.actor.personaId, kind: "Status", status: "Assigned", detail: { source: "Preventive", schedule: r.id, due } }),
      await insertStmt(c.db, c.ws, "events", { id: newId("evt"), type: "wo.created", entity_type: "work_orders", entity_id: woId, property_id: r.property_id, payload: { source: "Preventive" }, created_at: at }),
    ]);
    return ok(`${woId} created for ${due}. Next due ${next}.`, `/app/maintenance/work-orders/${woId}`);
  },
});

// ---------------------------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------------------------

registerAction({
  key: "inspections.set_item",
  label: "Record condition",
  entity: "inspections",
  roles: SUP,
  input: z.strictObject({ item_id: z.string().max(80), condition: z.enum(["Good", "Fair", "Damaged", "Missing", "N/A"]), note: z.string().trim().max(300).optional() }),
  when: (r) => r.status !== "Completed",
  handler: async (c, r, input) => {
    const changes: Row = { condition: input.condition };
    if (input.note !== undefined) changes.note = input.note;
    const okWrite = await update(c.db, c.ws, "inspection_items", input.item_id, changes, `e.inspection_id = '${String(r.id).replace(/'/g, "''")}'`);
    return okWrite ? ok(`Marked ${input.condition.toLowerCase()}.`) : { status: 404, error: "That item isn't on this inspection." };
  },
});

registerAction({
  key: "inspections.raise_work_order",
  label: "Raise work order",
  entity: "inspections",
  roles: SUP,
  icon: Wrench,
  input: z.strictObject({ item_id: z.string().max(80) }),
  handler: async (c, r, input) => {
    const item = await readRow<{ id: string; inspection_id: string; area: string; item: string; condition: string; note: string; work_order_id: string | null }>(c.db, c.ws, "inspection_items", input.item_id);
    if (!item || item.inspection_id !== r.id) return { status: 404, error: "That item isn't on this inspection." };
    if (!["Damaged", "Missing"].includes(item.condition)) return conflict("Only damaged or missing items need a work order.");
    const woId = `WO-IN-${newId("x").slice(2, 10).toUpperCase()}`;
    // Linking the item first is the claim, so a double click raises one work order.
    const [claim] = await c.db.batch([await updateStmt(c.db, c.ws, "inspection_items", item.id, { work_order_id: woId }, "e.work_order_id IS NULL")]);
    if (!claim.meta.changes) return conflict(`A work order was already raised for ${item.item}.`);
    const at = nowIso(c.nowMs);
    await c.db.batch([
      await insertStmt(c.db, c.ws, "work_orders", {
        id: woId, property_id: r.property_id, unit_id: r.unit_id ?? null, title: `${item.item} ${item.condition.toLowerCase()} (${item.area})`, description: item.note || `Found during the ${String(r.kind).toLowerCase()} inspection ${r.id}.`,
        category: "General", priority: "Normal", source: "Inspection", status: "New", sla_due_at: addHours(at, SLA_HOURS.Normal), opened_at: at, permission_to_enter: 1,
      }),
      await insertStmt(c.db, c.ws, "events", { id: newId("evt"), type: "wo.created", entity_type: "work_orders", entity_id: woId, property_id: r.property_id, payload: { source: "Inspection", inspection_id: r.id }, created_at: at }),
    ]);
    return ok(`${woId} raised for ${item.item}. Open it to triage and dispatch.`, `/app/maintenance/intake/${woId}`);
  },
});

registerAction({
  key: "inspections.complete",
  label: "Complete inspection",
  entity: "inspections",
  roles: SUP,
  icon: CheckCircle2,
  when: (r) => ["Scheduled", "In progress"].includes(String(r.status)),
  handler: async (c, r) => {
    const d = await c.db.prepare(`SELECT count(*) AS n, coalesce(sum(i.condition IN ('Damaged', 'Missing')), 0) AS bad FROM ${effectiveSql("inspection_items")} i WHERE i.inspection_id = ?2`).bind(c.ws, r.id).first<{ n: number; bad: number }>();
    const score = Math.max(40, 100 - 12 * Number(d?.bad ?? 0));
    const status = Number(d?.bad ?? 0) >= 3 ? "Failed" : "Completed";
    const okWrite = await update(c.db, c.ws, "inspections", String(r.id), { status, completed_on: AS_OF, score }, "e.status IN ('Scheduled', 'In progress')");
    return okWrite ? ok(`Inspection ${status.toLowerCase()}, score ${score}${d?.bad ? `, ${d.bad} defect${d.bad > 1 ? "s" : ""}` : ""}.`) : conflict("This inspection is already closed.");
  },
});

// ---------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------

async function keyMove(c: ActionContext, r: Row, action: "Checked out" | "Returned" | "Lost", holder: { kind: string | null; id: string | null }, guard: string, workOrderId?: string) {
  const at = nowIso(c.nowMs);
  const [res] = await c.db.batch([await updateStmt(c.db, c.ws, "keys", String(r.id), { holder_kind: holder.kind, holder_id: holder.id }, guard)]);
  if (!res.meta.changes) return false;
  await (await insertStmt(c.db, c.ws, "key_log", { id: newId("kl"), key_id: r.id, property_id: r.property_id, action, holder_kind: holder.kind, holder_id: holder.id, work_order_id: workOrderId ?? null, at })).run();
  return true;
}

registerAction({
  key: "keys.check_out",
  label: "Check out",
  entity: "keys",
  roles: SUP,
  icon: KeyRound,
  input: z.strictObject({ holder_kind: z.enum(["staff", "vendor"]), holder_id: z.string().trim().min(1).max(40), work_order_id: z.string().max(40).optional() }),
  when: (r) => r.state === "In key box",
  handler: async (c, r, input) => {
    if (!(await readRow(c.db, c.ws, input.holder_kind === "staff" ? "staff" : "vendors", input.holder_id))) return { status: 404, error: "That person or vendor wasn't found" };
    return (await keyMove(c, r, "Checked out", { kind: input.holder_kind, id: input.holder_id }, "e.holder_id IS NULL", input.work_order_id)) ? ok(`${r.label} checked out.`) : conflict(`${r.label} is already checked out.`);
  },
});

registerAction({
  key: "keys.check_in",
  label: "Return to key box",
  entity: "keys",
  roles: SUP,
  icon: KeyRound,
  when: (r) => r.state !== "In key box",
  handler: async (c, r) => ((await keyMove(c, r, "Returned", { kind: null, id: null }, "e.holder_id IS NOT NULL")) ? ok(`${r.label} is back in the key box.`) : conflict(`${r.label} is already in the key box.`)),
});

registerAction({
  key: "keys.report_lost",
  label: "Report lost",
  entity: "keys",
  roles: SUP,
  confirm: { title: "Report this key lost?", body: "It's logged as lost. Rekey the lock if it opens a unit or a master.", tone: "danger" },
  when: (r) => r.state !== "Lost",
  handler: async (c, r) => {
    const k = await readRow<{ holder_kind: string | null; holder_id: string | null }>(c.db, c.ws, "keys", String(r.id));
    return (await keyMove(c, r, "Lost", { kind: k?.holder_kind ?? null, id: k?.holder_id ?? null }, "1 = 1")) ? ok(`${r.label} logged as lost.`) : conflict("Couldn't update this key.");
  },
});
