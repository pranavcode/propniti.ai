import { demoNowIso } from "@/lib/clock";
import { z } from "zod";
import { getAction } from "@/extensions/actions";
import { isAiAction } from "./action-keys";
import { letterDates } from "./rules";
import { can, getEntity } from "@/entities";
import { getRow } from "@/server/query";
import { INTERNAL_ROLES, type ActionKey, type AgentKey, type Row } from "@/entities/types";
import { eff, get, getRaw, insert, insertGated, isTable, newId, parseJson, upsertOverlayGated, type DataCtx, type Gate, type Table } from "./data";
import type { DbStatement } from "@/lib/platform/types";

// What approving a proposal does. A registered named action (src/extensions, money through
// src/server/money.ts) always wins. Otherwise the proposal's own `effects` run: messages, tasks and
// narrow record updates. Ledger tables are never written here; money fixes become a task for a person.

const LEDGER = new Set(["charges", "payments", "transfers", "owner_distributions", "bank_accounts", "journal_entries", "credits"]);

// Fields an approved proposal may change directly, per table. Data-health fixes add the fields their
// rule names (checked against the table's real columns in upsertOverlay).
const UPDATABLE: Partial<Record<Table, string[]>> = {
  work_orders: ["category", "priority", "vendor_id", "status", "estimate_cents"],
  applications: ["stage", "recommendation", "score", "scoring_factors", "decided_by", "decided_at"],
  bills: ["status", "approved_by", "approved_at"],
  vendors: ["status"],
};

export const Effect = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("message"),
    party_kind: z.enum(["resident", "vendor", "owner", "applicant", "prospect"]),
    party_id: z.string(),
    property_id: z.string().nullish(),
    channel: z.enum(["Email", "SMS", "Portal", "Phone", "Letter"]).default("Email"),
    subject: z.string().max(200),
    body: z.string().max(4000),
    entity_type: z.string().optional(),
    entity_id: z.string().optional(),
  }),
  z.object({
    kind: z.literal("task"),
    title: z.string().max(200),
    detail: z.string().max(2000).default(""),
    entity_type: z.string().optional(),
    entity_id: z.string().optional(),
    property_id: z.string().nullish(),
    assignee_role: z.string().optional(),
    priority: z.enum(["High", "Normal", "Low"]).default("Normal"),
    due_on: z.string().optional(),
  }),
  z.object({ kind: z.literal("update"), table: z.string(), id: z.string(), changes: z.record(z.string(), z.unknown()), fix: z.boolean().optional(), issue_id: z.string().optional(), tombstone: z.boolean().optional() }),
  z.object({ kind: z.literal("insert"), table: z.enum(["renewal_offers"]), row: z.record(z.string(), z.unknown()) }),
]);
export type Effect = z.infer<typeof Effect>;
export const Payload = z.object({ effects: z.array(Effect).max(10).default([]) }).passthrough();

export type By = { id: string; name: string; agent?: AgentKey; role?: string };
export type ExecResult = { ok: boolean; message: string; href?: string; status?: number };

// Turns one effect into gated statements (validated and read now, written in the decision batch).
async function planEffect(data: DataCtx, e: Effect, by: By, proposal: Row, gate: Gate): Promise<{ stmts: DbStatement[]; note: string }> {
  const now = demoNowIso();
  const { db, ws } = data;
  if (e.kind === "message") {
    const threadId = newId("thr");
    return {
      stmts: [
        await insertGated(db, ws, "message_threads", { id: threadId, property_id: e.property_id ?? null, party_kind: e.party_kind, party_id: e.party_id, subject: e.subject, entity_type: e.entity_type ?? proposal.entity_type, entity_id: e.entity_id ?? proposal.entity_id, status: "Waiting", last_message_at: now, unread: 0 }, gate),
        await insertGated(db, ws, "messages", { id: newId("msg"), thread_id: threadId, channel: e.channel, direction: "out", sender_kind: by.agent ? "agent" : "staff", sender_id: by.id, body: letterDates(e.body), drafted_by_agent: proposal.agent ?? null, sent_at: now }, gate),
      ],
      note: `${e.channel} sent: "${e.subject}"`,
    };
  }
  if (e.kind === "task") {
    return {
      stmts: [await insertGated(db, ws, "tasks", {
        id: newId("task"), title: e.title, detail: e.detail, entity_type: e.entity_type ?? proposal.entity_type, entity_id: e.entity_id ?? proposal.entity_id, property_id: e.property_id ?? proposal.property_id ?? null,
        assignee_role: e.assignee_role ?? null, created_by: by.id, due_on: e.due_on ?? null, priority: e.priority, status: "Open", queue_state: "needs_you", source: "Agent", created_at: now,
      }, gate)],
      note: `Task created: ${e.title}`,
    };
  }
  if (e.kind === "insert") return { stmts: [await insertGated(db, ws, e.table, { id: newId("ro"), ...e.row }, gate)], note: "Renewal offer recorded" };
  if (!isTable(e.table) || LEDGER.has(e.table)) throw new Error(`${e.table} can't be changed from a proposal`);
  if (!e.fix) {
    const allowed = UPDATABLE[e.table] ?? [];
    const bad = Object.keys(e.changes).filter((k) => !allowed.includes(k));
    if (bad.length) throw new Error(`Not allowed to change ${e.table}.${bad.join(", ")}`);
  }
  // "$by" stands for whoever approved (approved_by and similar).
  const changes = Object.fromEntries(Object.entries(e.changes).map(([k, v]) => [k, v === "$by" ? by.id : v]));
  const { stmt, before, after } = await upsertOverlayGated(data, e.table, e.id, changes, gate, { tombstone: e.tombstone });
  const stmts = [stmt];
  if (e.fix && e.issue_id) {
    stmts.push(await insertGated(db, ws, "data_fix_log", { id: newId("fix"), issue_id: e.issue_id, entity_type: e.table, entity_id: e.id, before_json: JSON.stringify(before), after_json: JSON.stringify(e.tombstone ? { merged: true } : after), fixed_by: by.id, agent: proposal.agent ?? null, at: now }, gate));
    stmts.push((await upsertOverlayGated(data, "data_issues", e.issue_id, { status: by.agent ? "auto-fixed" : "fixed", fixed_by: by.id, fixed_at: now }, gate)).stmt);
  }
  return { stmts, note: e.tombstone ? `Merged ${e.table} ${e.id}` : `Updated ${e.table} ${e.id}: ${Object.entries(after).map(([k, v]) => `${k} → ${v}`).join(", ")}` };
}

// A person may edit only the wording of a proposal's message before approving. Everything else
// (records, amounts, recipients, effects) stays as the rules built it, so an edit can't widen what runs.
export const Edits = z.object({ message: z.object({ subject: z.string().max(200).optional(), body: z.string().min(1).max(4000).optional() }).optional() });
function withEdits(payload: Record<string, unknown>, edited: unknown) {
  if (edited === undefined) return payload;
  const e = Edits.parse(edited);
  const effects = (Array.isArray(payload.effects) ? payload.effects : []).map((x: Record<string, unknown>) => (x.kind === "message" && e.message ? { ...x, ...e.message } : x));
  return { ...payload, effects };
}

// Proposals written before effects existed (the seeded history) carry only a few params. Their
// effects are rebuilt here from the record, using the same kinds as live proposals.
async function deriveEffects(data: DataCtx, p: Row, payload: Record<string, unknown>): Promise<Effect[]> {
  const action = String(p.action);
  const id = String(p.entity_id);
  const verb = action.split(".")[1] ?? "";
  const pid = (p.property_id as string) ?? null;
  const first = (s: string) => s.split(" ")[0];
  if (action === "data_issues.apply_fix" && typeof payload.issue_id === "string") {
    const issue = await get(data, "data_issues", payload.issue_id);
    if (!issue || issue.status !== "open") throw new Error(issue ? `This issue is already ${issue.status}` : "Issue not found");
    const { fixProposal } = await import("./tools/write");
    return Payload.parse(fixProposal(issue).payload).effects;
  }
  if (p.entity_type === "households" && /reminder|payment_plan/.test(verb)) {
    const r = await data.db.prepare(`SELECT t.id, t.first_name FROM ${eff("residents", data.ws).sql} t WHERE t.household_id = ? ORDER BY t.is_primary DESC LIMIT 1`).bind(...eff("residents", data.ws).params, id).first<Row>();
    if (!r) throw new Error("No resident on this household");
    const amount = p.amount_cents != null ? `$${(Number(p.amount_cents) / 100).toLocaleString("en-US")}` : "your balance";
    const body = verb.includes("plan")
      ? `Hi ${first(String(r.first_name))}, your balance is ${amount}. We can split it into three monthly payments. Reply to set it up, or pay in the resident portal.`
      : `Hi ${first(String(r.first_name))}, your account shows ${amount} past due. You can pay in the resident portal. If you've already paid, please ignore this.`;
    return [{ kind: "message", party_kind: "resident", party_id: String(r.id), property_id: pid, channel: payload.channel === "SMS" ? "SMS" : "Email", subject: verb.includes("plan") ? "A payment plan for your balance" : "Rent reminder", body, entity_type: "households", entity_id: id }];
  }
  if (action === "work_orders.assign_vendor") return [{ kind: "update", table: "work_orders", id, changes: { status: "Assigned" } }];
  if (action === "bills.approve") return [{ kind: "update", table: "bills", id, changes: { status: "Approved", approved_by: "$by", approved_at: demoNowIso() } }];
  if (action === "bills.hold") return [{ kind: "task", title: `Review bill ${id}`, detail: parseJson<string[]>(p.why, []).join(" "), assignee_role: "accountant", priority: "High" }];
  if (action === "renewal_offers.send" && p.entity_type === "leases") {
    const lease = await get(data, "leases", id);
    if (!lease) throw new Error("Lease not found");
    return [{ kind: "insert", table: "renewal_offers", row: { lease_id: id, property_id: lease.property_id, version: 1, term_months: Number(payload.term_months ?? 12), rent_cents: Number(payload.rent_cents ?? p.amount_cents ?? lease.rent_cents), current_rent_cents: lease.rent_cents, status: "Sent", sent_at: demoNowIso() } }];
  }
  if (action === "applications.approve" || action === "applications.deny") {
    return [{ kind: "update", table: "applications", id, changes: { stage: action.endsWith("approve") ? "Approved" : "Denied", decided_by: "$by", decided_at: demoNowIso() } }];
  }
  const party = p.entity_type === "vendors" ? "vendor" : p.entity_type === "prospects" ? "prospect" : p.entity_type === "owner_entities" ? "owner" : null;
  if (party && /request|follow_up|send/.test(verb)) {
    let partyId = id;
    if (party === "owner") partyId = String((await get(data, "owner_entities", id))?.owner_id ?? id);
    return [{ kind: "message", party_kind: party, party_id: partyId, property_id: pid, channel: "Email", subject: String(p.title).slice(0, 200), body: parseJson<string[]>(p.why, []).join("\n"), entity_type: String(p.entity_type), entity_id: id }];
  }
  return [];
}

// The fields whose change makes a proposal stale: status, money, dates, assignment and the contact
// details fixes touch. Recorded with the proposal, compared on approval.
const KEY_FIELDS = ["status", "stage", "amount_cents", "rent_cents", "estimate_cents", "vendor_id", "priority", "category", "start_on", "end_on", "expires_on", "due_on", "decided_at", "bank_last4", "bank_changed_at", "street", "state", "zip", "email", "phone", "lease_id", "gl_account_id"];

export function snapshotOf(row: Row): string {
  return JSON.stringify(KEY_FIELDS.filter((k) => k in row).map((k) => [k, row[k] ?? null]));
}

// The record as the approver sees it now: it must still exist in their scope, the action's own
// precondition must still hold, and its key fields must match what the agent saw.
async function stillValid(data: DataCtx, proposal: Row, payload: Record<string, unknown>): Promise<ExecResult | null> {
  const table = String(proposal.entity_type);
  if (!isTable(table)) return null;
  const row = await get(data, table, String(proposal.entity_id));
  if (!row) return { ok: false, status: 409, message: "This record no longer exists or is outside your scope" };
  const raw = await getRaw(data, table, String(proposal.entity_id));
  if (typeof payload._snapshot === "string" && raw && payload._snapshot !== snapshotOf(raw)) return { ok: false, status: 409, message: "Record changed since this was proposed; re-run the agent" };
  const action = String(proposal.action);
  const registered = isAiAction(action) ? undefined : getAction(action);
  if (registered?.when) {
    const def = getEntity(table);
    const current = def ? await getRow({ db: data.db, ws: data.ws === "base" ? null : data.ws, actor: data.actor }, table, String(proposal.entity_id)).catch(() => null) : row;
    if (!current || !registered.when(current)) return { ok: false, status: 409, message: `${registered.label} isn't available for this record any more; re-run the agent` };
  }
  return null;
}

// Runs an approved proposal once. The decision row is inserted first with a guarded insert, so a
// double click or two approvers can't run it twice; a failed run removes the decision again.
export async function executeProposal(data: DataCtx, proposal: Row, by: By, edited?: unknown, note = ""): Promise<ExecResult> {
  const { db, ws } = data;
  const now = demoNowIso();
  const decisionId = newId("dec");
  // People deciding must be staff (an owner only for an approval that waits on them); the route
  // checks ownership. Agents applying within policy act as the run's actor.
  if (!by.agent && !(INTERNAL_ROLES as readonly string[]).includes(data.actor.role) && !(data.actor.role === "owner" && proposal.queue_state === "waiting" && proposal.assignee_role === "owner")) {
    return { ok: false, status: 403, message: "Only staff can act on agent proposals" };
  }
  const stale = await stillValid(data, proposal, parseJson<Record<string, unknown>>(proposal.payload, {}));
  if (stale) return stale;
  const payload = withEdits(parseJson<Record<string, unknown>>(proposal.payload, {}), edited);
  const action = String(proposal.action) as ActionKey;
  const d = eff("ai_decisions", ws);
  const decide = db
    .prepare(`INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, note, edited_payload, decided_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM ${d.sql} d WHERE d.proposal_id = ?)`)
    .bind(ws, decisionId, proposal.id, edited === undefined ? "Approved" : "Edited", by.id, note, edited === undefined ? null : JSON.stringify(edited), now, ...d.params, proposal.id);
  const gate = { decisionId };
  const record = async (message: string) => [
    await insertGated(db, ws, "audit", {
      id: newId("aud"), at: now, actor: by.name, actor_id: by.id, role: by.role ?? data.actor.role, agent: proposal.agent ?? null, model: proposal.model ?? null,
      action: `${action} (${edited === undefined ? "approved" : "edited and approved"})`, entity_type: proposal.entity_type, entity_id: proposal.entity_id, property_id: proposal.property_id ?? null,
      detail: `${proposal.title} — ${message}`.slice(0, 1000), before_json: null, after_json: JSON.stringify(payload).slice(0, 4000),
    }, gate),
    await insertGated(db, ws, "activity_events", {
      id: newId("act"), entity_type: proposal.entity_type, entity_id: proposal.entity_id, property_id: proposal.property_id ?? null, at: now,
      actor_kind: by.agent ? "agent" : "staff", actor_id: by.id, verb: "approved", summary: `${proposal.title} (${by.name})`, data: JSON.stringify({ proposal_id: proposal.id, result: message }),
    }, gate),
  ];

  const registered = isAiAction(action) ? undefined : getAction(action);
  if (!registered) {
    // The proposal's own effects: planned first (nothing is written if one is invalid), then the
    // decision and every effect land in one batch, or none of them do.
    let plans: { stmts: DbStatement[]; note: string }[];
    try {
      let { effects } = Payload.parse(payload);
      if (!effects.length) effects = await deriveEffects(data, proposal, payload as Record<string, unknown>);
      if (!effects.length) throw new Error(`No handler for ${action} yet`);
      plans = [];
      for (const e of effects) plans.push(await planEffect(data, e, by, proposal, gate));
    } catch (err) {
      return { ok: false, status: 400, message: err instanceof Error ? err.message : String(err) };
    }
    const message = plans.map((p) => p.note).join(" · ");
    const results = await db.batch([decide, ...plans.flatMap((p) => p.stmts), ...(await record(message))]);
    if (!results[0].meta.changes) return { ok: false, status: 409, message: "Already decided" };
    return { ok: true, message };
  }

  // A registered action does its own writes (money through money.ts, idempotent by key), so the
  // decision is claimed first and released if the action refuses.
  const claimed = await decide.run();
  if (!claimed.meta.changes) return { ok: false, status: 409, message: "Already decided" };
  let result: ExecResult;
  try {
    if (!can(data.actor.role, action, registered.entity)) throw new Error(`${data.actor.role.replace(/_/g, " ")} can't ${registered.label.toLowerCase()}`);
    // Registered handlers get the record as the entity API presents it (labels, derived status).
    const row = getEntity(String(proposal.entity_type))
      ? await getRow({ db, ws: ws === "base" ? null : ws, actor: data.actor }, String(proposal.entity_type), String(proposal.entity_id))
      : isTable(String(proposal.entity_type)) ? await get(data, proposal.entity_type as Table, String(proposal.entity_id)) : null;
    const input = registered.input ? registered.input.parse((payload as { input?: unknown }).input ?? payload) : undefined;
    const r = await registered.handler({ db, ws, actor: data.actor, nowMs: Date.now() }, row ?? {}, input);
    result = r.status === 200 ? { ok: true, message: r.message ?? registered.label, href: r.href } : { ok: false, status: r.status, message: "error" in r ? r.error : r.message };
  } catch (err) {
    result = { ok: false, status: 400, message: err instanceof Error ? err.message : String(err) };
  }
  if (!result.ok) {
    await db.prepare("DELETE FROM ai_decisions WHERE workspace_id = ? AND id = ?").bind(ws, decisionId).run();
    return result;
  }
  await db.batch(await record(result.message));
  return result;
}

export async function rejectProposal(data: DataCtx, proposal: Row, by: By, note: string, decision: "Rejected" | "Snoozed" = "Rejected"): Promise<ExecResult> {
  const { db, ws } = data;
  if (!(INTERNAL_ROLES as readonly string[]).includes(data.actor.role) && !(data.actor.role === "owner" && proposal.queue_state === "waiting")) return { ok: false, status: 403, message: "Only staff can act on agent proposals" };
  const now = demoNowIso();
  const d = eff("ai_decisions", ws);
  const r = await db
    .prepare(`INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, note, decided_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM ${d.sql} d WHERE d.proposal_id = ?)`)
    .bind(ws, newId("dec"), proposal.id, decision, by.id, note, now, ...d.params, proposal.id)
    .run();
  if (!r.meta.changes) return { ok: false, status: 409, message: "Already decided" };
  await (await insert(db, ws, "audit", {
    id: newId("aud"), at: now, actor: by.name, actor_id: by.id, role: by.role ?? data.actor.role, agent: proposal.agent ?? null, model: proposal.model ?? null,
    action: `${proposal.action} (${decision.toLowerCase()})`, entity_type: proposal.entity_type, entity_id: proposal.entity_id, property_id: proposal.property_id ?? null, detail: `${proposal.title}${note ? ` — ${note}` : ""}`.slice(0, 1000),
  })).run();
  return { ok: true, message: decision };
}
