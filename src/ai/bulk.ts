import type { Row } from "@/entities/types";
import { sql } from "./data";
import { executeProposal } from "./effects";
import type { ProposalFilters } from "./filters";
import { canDecide } from "./http";
import type { AiSession } from "./session";
import { proposal, proposalWhere, queueSql } from "./views";

// "Approve all low-risk matching" in the approvals inbox: every page, not just the one on screen.
// Capped per click so one request stays short; the confirm says when more remain.

export const BULK_CAP = 100;
const SCAN = 500;

type Who = Pick<AiSession, "db" | "ws" | "actor" | "persona">;
const isSafe = (p: Row) => p.risk === "Low" && p.amount_cents == null;

// Low-risk proposals with no amount in this persona's "Needs you" (decide.ts) matching the filters;
// canDecide re-checks each one.
export async function safeMatching(s: Who, f: ProposalFilters, cap = BULK_CAP) {
  const w = proposalWhere(f);
  const q = queueSql(s.actor.role, "needs_you");
  const rows = await sql<Row>({ db: s.db, ws: s.ws, actor: s.actor },
    `SELECT p.* FROM {ai_proposals} p LEFT JOIN {ai_decisions} d ON d.proposal_id = p.id WHERE ${[q.sql, "p.risk = 'Low'", "p.amount_cents IS NULL", ...w.where].join(" AND ")} ORDER BY p.created_at DESC, p.id LIMIT ${SCAN}`, [...q.params, ...w.params]);
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

