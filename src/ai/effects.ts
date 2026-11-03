import { z } from "zod";
import { getAction } from "@/extensions/actions";
import type { ActionKey, AgentKey, Row } from "@/entities/types";
import { eff, get, insert, isTable, newId, parseJson, upsertOverlay, type DataCtx, type Table } from "./data";

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

async function runEffect(data: DataCtx, e: Effect, by: By, proposal: Row): Promise<string> {
  const now = new Date().toISOString();
  const { db, ws } = data;
  if (e.kind === "message") {
    const threadId = newId("thr");
    await db.batch([
      await insert(db, ws, "message_threads", { id: threadId, property_id: e.property_id ?? null, party_kind: e.party_kind, party_id: e.party_id, subject: e.subject, entity_type: e.entity_type ?? proposal.entity_type, entity_id: e.entity_id ?? proposal.entity_id, status: "Waiting", last_message_at: now, unread: 0 }),
      await insert(db, ws, "messages", { id: newId("msg"), thread_id: threadId, channel: e.channel, direction: "out", sender_kind: by.agent ? "agent" : "staff", sender_id: by.id, body: e.body, drafted_by_agent: proposal.agent ?? null, sent_at: now }),
    ]);
    return `${e.channel} sent: "${e.subject}"`;
  }
  if (e.kind === "task") {
    await (await insert(db, ws, "tasks", {
      id: newId("task"), title: e.title, detail: e.detail, entity_type: e.entity_type ?? proposal.entity_type, entity_id: e.entity_id ?? proposal.entity_id, property_id: e.property_id ?? proposal.property_id ?? null,
      assignee_role: e.assignee_role ?? null, created_by: by.id, due_on: e.due_on ?? null, priority: e.priority, status: "Open", queue_state: "needs_you", source: "Agent", created_at: now,
    })).run();
    return `Task created: ${e.title}`;
  }
  if (e.kind === "insert") {
    await (await insert(db, ws, e.table, { id: newId("ro"), ...e.row })).run();
    return "Renewal offer recorded";
  }
  if (!isTable(e.table) || LEDGER.has(e.table)) throw new Error(`${e.table} can't be changed from a proposal`);
  if (!e.fix) {
    const allowed = UPDATABLE[e.table] ?? [];
    const bad = Object.keys(e.changes).filter((k) => !allowed.includes(k));
    if (bad.length) throw new Error(`Not allowed to change ${e.table}.${bad.join(", ")}`);
  }
  // "$by" stands for whoever approved (approved_by and similar).
  const changes = Object.fromEntries(Object.entries(e.changes).map(([k, v]) => [k, v === "$by" ? by.id : v]));
  const { before, after } = await upsertOverlay(data, e.table, e.id, changes, { tombstone: e.tombstone });
  if (e.fix && e.issue_id) {
    await db.batch([
      await insert(db, ws, "data_fix_log", { id: newId("fix"), issue_id: e.issue_id, entity_type: e.table, entity_id: e.id, before_json: JSON.stringify(before), after_json: JSON.stringify(e.tombstone ? { merged: true } : after), fixed_by: by.id, agent: proposal.agent ?? null, at: now }),
    ]);
    await upsertOverlay(data, "data_issues", e.issue_id, { status: by.agent ? "auto-fixed" : "fixed", fixed_by: by.id, fixed_at: now });
  }
  return e.tombstone ? `Merged ${e.table} ${e.id}` : `Updated ${e.table} ${e.id}: ${Object.entries(after).map(([k, v]) => `${k} → ${v}`).join(", ")}`;
}

// Runs an approved proposal once. The decision row is inserted first with a guarded insert, so a
// double click or two approvers can't run it twice; a failed run removes the decision again.
export async function executeProposal(data: DataCtx, proposal: Row, by: By, edited?: unknown, note = ""): Promise<ExecResult> {
  const { db, ws } = data;
  const now = new Date().toISOString();
  const decisionId = newId("dec");
  const d = eff("ai_decisions", ws);
  const claimed = await db
    .prepare(`INSERT INTO ai_decisions (workspace_id, id, proposal_id, decision, decided_by, note, edited_payload, decided_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM ${d.sql} d WHERE d.proposal_id = ?)`)
    .bind(ws, decisionId, proposal.id, edited === undefined ? "Approved" : "Edited", by.id, note, edited === undefined ? null : JSON.stringify(edited), now, ...d.params, proposal.id)
    .run();
  if (!claimed.meta.changes) return { ok: false, status: 409, message: "Already decided" };

  const payload = edited ?? parseJson(proposal.payload, {});
  const action = String(proposal.action) as ActionKey;
  let result: ExecResult;
  try {
    const registered = getAction(action);
    if (registered) {
      const row = isTable(String(proposal.entity_type)) ? await get(data, proposal.entity_type as Table, String(proposal.entity_id)) : null;
      const input = registered.input ? registered.input.parse((payload as { input?: unknown }).input ?? payload) : undefined;
      const r = await registered.handler({ db, ws, actor: data.actor, nowMs: Date.now() }, row ?? {}, input);
      result = r.status === 200 ? { ok: true, message: r.message ?? registered.label, href: r.href } : { ok: false, status: r.status, message: r.error };
    } else {
      const { effects } = Payload.parse(payload);
      if (!effects.length) throw new Error(`No handler for ${action} yet`);
      const notes: string[] = [];
      for (const e of effects) notes.push(await runEffect(data, e, by, proposal));
      result = { ok: true, message: notes.join(" · ") };
    }
  } catch (err) {
    result = { ok: false, status: 400, message: err instanceof Error ? err.message : String(err) };
  }

  if (!result.ok) {
    await db.prepare("DELETE FROM ai_decisions WHERE workspace_id = ? AND id = ?").bind(ws, decisionId).run();
    return result;
  }
  await db.batch([
    await insert(db, ws, "audit", {
      id: newId("aud"), at: now, actor: by.name, actor_id: by.id, role: by.role ?? data.actor.role, agent: proposal.agent ?? null, model: proposal.model ?? null,
      action: `${action} (${edited === undefined ? "approved" : "edited and approved"})`, entity_type: proposal.entity_type, entity_id: proposal.entity_id, property_id: proposal.property_id ?? null,
      detail: `${proposal.title} — ${result.message}`.slice(0, 1000), before_json: null, after_json: JSON.stringify(payload).slice(0, 4000),
    }),
    await insert(db, ws, "activity_events", {
      id: newId("act"), entity_type: proposal.entity_type, entity_id: proposal.entity_id, property_id: proposal.property_id ?? null, at: now,
      actor_kind: by.agent ? "agent" : "staff", actor_id: by.id, verb: "approved", summary: `${proposal.title} (${by.name})`, data: JSON.stringify({ proposal_id: proposal.id, result: result.message }),
    }),
  ]);
  return result;
}

export async function rejectProposal(data: DataCtx, proposal: Row, by: By, note: string, decision: "Rejected" | "Snoozed" = "Rejected"): Promise<ExecResult> {
  const { db, ws } = data;
  const now = new Date().toISOString();
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
