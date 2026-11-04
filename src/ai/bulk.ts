import type { Row } from "@/entities/types";
import { sql } from "./data";
import { executeProposal } from "./effects";
import type { ProposalFilters } from "./filters";
import { canDecide } from "./http";
import type { AiSession } from "./session";
import { proposal, proposalWhere, QUEUE_SQL } from "./views";

// "Approve all low-risk matching" in the approvals inbox: every page, not just the one on screen.
// Capped per click so one request stays short; the confirm says when more remain.

export const BULK_CAP = 100;
const SCAN = 500;

type Who = Pick<AiSession, "db" | "ws" | "actor" | "persona">;
const isSafe = (p: Row) => p.risk === "Low" && p.amount_cents == null;

// Low-risk proposals with no amount, waiting on a person, matching the filters, that this persona may decide.
export async function safeMatching(s: Who, f: ProposalFilters, cap = BULK_CAP) {
  const w = proposalWhere(f);
  const rows = await sql<Row>({ db: s.db, ws: s.ws, actor: s.actor },
    `SELECT p.* FROM {ai_proposals} p LEFT JOIN {ai_decisions} d ON d.proposal_id = p.id WHERE ${[QUEUE_SQL.needs_you, "p.risk = 'Low'", "p.amount_cents IS NULL", ...w.where].join(" AND ")} ORDER BY p.created_at DESC, p.id LIMIT ${SCAN}`, w.params);
  const ok: string[] = [];
  for (const p of rows) if ((await canDecide(s, p)).ok) ok.push(String(p.id));
  return { ids: ok.slice(0, cap), count: Math.min(ok.length, cap), more: ok.length > cap || rows.length === SCAN };
}

// Approves each id that is still low risk, carries no amount and that this persona may decide;
// anything else is skipped and listed.
export async function approveSafe(s: Who, ids: string[]) {
  const data = { db: s.db, ws: s.ws, actor: s.actor };
  const by = { id: s.persona.id, name: s.persona.name, role: s.actor.role };
  const results: { id: string; ok: boolean; message: string }[] = [];
  for (const id of ids) {
    const p = await proposal(data, id);
    if (!p) { results.push({ id, ok: false, message: "Not found" }); continue; }
    if (!isSafe(p)) { results.push({ id, ok: false, message: "Needs an individual review (money, legal or higher risk)" }); continue; }
    const allowed = await canDecide(s, p);
    if (!allowed.ok) { results.push({ id, ok: false, message: allowed.error }); continue; }
    const r = await executeProposal(data, p, by, undefined, "Bulk approved (safe items)");
    results.push({ id, ok: r.ok, message: r.message });
  }
  return { approved: results.filter((r) => r.ok).length, results };
}

// Marks each inbox row with whether this persona may decide it, so the page can offer
// "Notify approver" on the ones it can't.
export async function withCanDecide<T extends Row>(s: Who, rows: T[]) {
  return Promise.all(rows.map(async (p) => ({ ...p, can_decide: !p.decision && (await canDecide(s, p)).ok })));
}
