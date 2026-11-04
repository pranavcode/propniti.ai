import { demoNowIso } from "@/lib/clock";
import type { Persona } from "@/auth/personas";
import type { Row } from "@/entities/types";
import { computeFix } from "./rules";
import { get, insert, isTable, newId, parseJson, sql, upsertOverlay, type DataCtx } from "./data";
import { executeProposal } from "./effects";
import { canDecide, publicError } from "./http";
import { openRun, runWithContext } from "./orchestrator";
import type { IssueFilters } from "./filters";
import { fixProposal, queueReason } from "./tools/write";
import { ISSUE_ORDER, issueWhere } from "./views";
import "./agents";

// Data Health center actions. Applying a fix from the page is a person acting, but it still runs as
// a Data Health agent run, so the proposal, the change, the fix log and the audit row link up.

export async function applyFixes(data: DataCtx, persona: Persona, issueIds: string[], opts: { safeOnly: boolean }) {
  const start = { db: data.db, ws: data.ws, actor: data.actor, agent: "data_health" as const, trigger: { kind: "manual" as const, input: { issues: issueIds } } };
  const runId = await openRun(start);
  const results: { id: string; ok: boolean; message: string; queued?: boolean; proposalId?: string }[] = [];
  await runWithContext(runId, start, Date.now(), "data_health", "act_with_approval", ["data_issues.apply_fix"], async (ctx) => {
    ctx.autonomy = "act_with_approval";
    for (const id of issueIds) {
      const issue = await get(data, "data_issues", id);
      if (!issue || issue.status !== "open") { results.push({ id, ok: false, message: issue ? `Already ${issue.status}` : "Not found" }); continue; }
      const fix = await fixFor(data, issue);
      if (!fix) { results.push({ id, ok: false, message: "No automatic fix for this one; open the record to correct it" }); continue; }
      const p = fixProposal({ ...issue, suggested_fix: JSON.stringify(fix) } as Row);
      if (opts.safeOnly && (p.alwaysHuman || p.risk !== "Low")) { results.push({ id, ok: false, message: "Needs an individual review (money, fraud or legal)" }); continue; }
      const made = await ctx.proposeFull(p);
      const row = await data.db.prepare("SELECT * FROM ai_proposals WHERE workspace_id = ? AND id = ?").bind(data.ws, made.id).first<Row>();
      if (!row) { results.push({ id, ok: false, message: "Proposal missing" }); continue; }
      // Money, fraud and legal fixes are never applied from this page, whoever clicks: they wait in the
      // approvals inbox. Low-risk ones apply only for someone the inbox would let decide them.
      const allowed = p.alwaysHuman || row.risk !== "Low" ? null : await canDecide({ ...data, persona }, row);
      if (!allowed?.ok) {
        const message = allowed ? `${allowed.error} Sent to the approvals inbox.` : "Sent to the approvals inbox: a person with approval rights reviews money, fraud and legal fixes.";
        await ctx.step({ kind: "message", output: { issue: id, applied: false, queued: made.id, result: message }, ok: true });
        results.push({ id, ok: false, message, queued: true, proposalId: made.id });
        continue;
      }
      const r = await executeProposal(data, row, { id: persona.id, name: persona.name, role: data.actor.role }, undefined, "Applied from Data Health");
      const message = publicError(r.message);
      await ctx.step({ kind: "message", output: { issue: id, applied: r.ok, result: message }, ok: r.ok });
      results.push({ id, ok: r.ok, message });
    }
    return { summary: `${persona.name} applied ${results.filter((r) => r.ok).length} of ${issueIds.length} fixes from Data Health.`, result: null };
  });
  return { runId, applied: results.filter((r) => r.ok).length, queued: results.filter((r) => r.queued).length, results };
}

// The stored fix, or one computed from the record now when the rule left none.
async function fixFor(data: DataCtx, issue: Row): Promise<Record<string, unknown> | null> {
  const fix = parseJson<Record<string, unknown> | null>(issue.suggested_fix, null);
  if (fix?.changes || fix?.merge_into || fix?.action) return fix;
  const t = String(issue.entity_type);
  const rec = isTable(t) ? await get(data, t, String(issue.entity_id)) : null;
  const c = rec ? computeFix(String(issue.rule_id), rec) : null;
  return c ? { ...c, source: "data_health" } : null;
}

export const BULK_FIX_CAP = 100;
const SCAN = 500;

// The bulk buttons on the Data Health page, across every page that matches the filters. "safe":
// fixes this role's click applies directly. "send": fixes that would go to the approvals inbox
// (money, fraud, legal, critical, or a role without write access), skipping ones already waiting
// there. Fixes with nothing to apply (open the record instead) are neither. Mirrors the page's
// per-issue button (queueReason); applyFixes re-checks every item.
export async function issueTargets(data: DataCtx, f: IssueFilters, mode: "safe" | "send", cap = BULK_FIX_CAP) {
  const w = issueWhere({ ...f, status: "open" });
  const pending = "NOT EXISTS (SELECT 1 FROM {ai_proposals} p WHERE p.entity_type = 'data_issues' AND p.entity_id = i.id AND NOT EXISTS (SELECT 1 FROM {ai_decisions} d WHERE d.proposal_id = p.id))";
  const rows = await sql<Row>(data, `SELECT i.* FROM {data_issues} i WHERE ${[...w.where, ...(mode === "send" ? [pending] : [])].join(" AND ")} ORDER BY ${ISSUE_ORDER} LIMIT ${SCAN}`, w.params);
  const ids: string[] = [];
  for (const i of rows) {
    const fix = await fixFor(data, i);
    const changes = (fix?.changes ?? {}) as Record<string, unknown>;
    if (!fix || (!Object.keys(changes).length && !fix.merge_into)) continue;
    const reason = queueReason(fixProposal({ ...i, suggested_fix: JSON.stringify(fix) }), data.actor.role);
    // Merges tombstone a record, so bulk "safe" stays with field edits, as the page's count always has.
    if (mode === "safe" ? !reason && Object.keys(changes).length : reason) ids.push(String(i.id));
  }
  return { ids: ids.slice(0, cap), count: Math.min(ids.length, cap), more: ids.length > cap || rows.length === SCAN };
}

export async function dismissIssue(data: DataCtx, persona: Persona, id: string, note: string) {
  const issue = await get(data, "data_issues", id);
  if (!issue) return { ok: false, status: 404, message: "Not found" };
  if (issue.status !== "open") return { ok: false, status: 409, message: `Already ${issue.status}` };
  const now = demoNowIso();
  await upsertOverlay(data, "data_issues", id, { status: "dismissed", fixed_by: persona.id, fixed_at: now });
  await (await insert(data.db, data.ws, "audit", { id: newId("aud"), at: now, actor: persona.name, actor_id: persona.id, role: data.actor.role, action: "data_issue.dismissed", entity_type: issue.entity_type, entity_id: issue.entity_id, property_id: issue.property_id ?? null, detail: `${issue.rule_id}${note ? ` — ${note}` : ""}` })).run();
  return { ok: true, message: "Dismissed" };
}
