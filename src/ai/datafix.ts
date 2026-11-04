import { demoNowIso } from "@/lib/clock";
import type { Persona } from "@/auth/personas";
import type { Row } from "@/entities/types";
import { computeFix } from "./rules";
import { get, insert, isTable, newId, parseJson, upsertOverlay, type DataCtx } from "./data";
import { executeProposal } from "./effects";
import { openRun, runWithContext } from "./orchestrator";
import { fixProposal } from "./tools/write";
import "./agents";

// Data Health center actions. Applying a fix from the page is a person acting, but it still runs as
// a Data Health agent run, so the proposal, the change, the fix log and the audit row link up.

export async function applyFixes(data: DataCtx, persona: Persona, issueIds: string[], opts: { safeOnly: boolean }) {
  const start = { db: data.db, ws: data.ws, actor: data.actor, agent: "data_health" as const, trigger: { kind: "manual" as const, input: { issues: issueIds } } };
  const runId = await openRun(start);
  const results: { id: string; ok: boolean; message: string }[] = [];
  await runWithContext(runId, start, Date.now(), "data_health", "act_with_approval", ["data_issues.apply_fix"], async (ctx) => {
    ctx.autonomy = "act_with_approval";
    for (const id of issueIds) {
      const issue = await get(data, "data_issues", id);
      if (!issue || issue.status !== "open") { results.push({ id, ok: false, message: issue ? `Already ${issue.status}` : "Not found" }); continue; }
      let fix = parseJson<Record<string, unknown> | null>(issue.suggested_fix, null);
      if (!fix?.changes && !fix?.merge_into && !fix?.action) {
        const t = String(issue.entity_type);
        const rec = isTable(t) ? await get(data, t, String(issue.entity_id)) : null;
        const c = rec ? computeFix(String(issue.rule_id), rec) : null;
        if (!c) { results.push({ id, ok: false, message: "No automatic fix for this one; open the record to correct it" }); continue; }
        fix = { ...c, source: "data_health" };
      }
      const p = fixProposal({ ...issue, suggested_fix: JSON.stringify(fix) } as Row);
      if (opts.safeOnly && (p.alwaysHuman || p.risk !== "Low")) { results.push({ id, ok: false, message: "Needs an individual review (money, fraud or legal)" }); continue; }
      const made = await ctx.proposeFull(p);
      const row = await data.db.prepare("SELECT * FROM ai_proposals WHERE workspace_id = ? AND id = ?").bind(data.ws, made.id).first<Row>();
      const r = row ? await executeProposal(data, row, { id: persona.id, name: persona.name, role: data.actor.role }, undefined, "Applied from Data Health") : { ok: false, message: "Proposal missing" };
      await ctx.step({ kind: "message", output: { issue: id, applied: r.ok, result: r.message }, ok: r.ok });
      results.push({ id, ok: r.ok, message: r.message });
    }
    return { summary: `${persona.name} applied ${results.filter((r) => r.ok).length} of ${issueIds.length} fixes from Data Health.`, result: null };
  });
  return { runId, applied: results.filter((r) => r.ok).length, results };
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
