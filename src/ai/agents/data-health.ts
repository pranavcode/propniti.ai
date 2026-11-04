import type { Row } from "@/entities/types";
import { effective } from "@/server/query";
import { fixProposal } from "../tools/write";
import { defineAgent, type Candidate } from "./framework";
import { computeFix } from "../rules";
import { isRunnableRule, RUNNABLE_RULES_SQL } from "../data-rules";
export { computeFix, normalizeStreet, phoneInEmail } from "../rules";

// Detects and fixes data problems. Detection re-runs each enabled SQL rule (read-only) and reports
// how many records it flags; fixes come from data_issues.suggested_fix, filled in by the helpers
// below when the rule left it empty. Safe fixes (formatting, typos) can auto-apply within policy;
// money, fraud and legal fixes always go to a person.

const SEVERITY: Record<string, number> = { critical: 3, warn: 2, info: 1 };

export default defineAgent({
  key: "data_health",
  name: "Data Health agent",
  ownerRole: "admin",
  goal: "Find bad data before owners or auditors do: re-check the data rules, then propose a fix for each open issue with before/after, a reason and a confidence. Merge duplicates, recode miscoded bills and normalize contact details and addresses.",
  tools: ["data.issues", "records.get", "records.search", "data.propose_fix"],
  triggers: { schedule: "0 6 * * *", events: ["data_issue.detected", "import.completed"] },
  autonomy: "auto_within_policy",
  entities: ["data_issues", "data_rules"],
  actions: ["data_issues.apply_fix"],
  maxProposals: 12,
  async collect(ctx) {
    // Detection: each SQL rule is a read-only SELECT returning offending ids.
    // Only the shipped rules (base rows) run their SQL; overlay edits can't inject a query.
    const rules = { rows: (await ctx.db.prepare(RUNNABLE_RULES_SQL).all<Row>()).results };
    // Each check is capped (count of at most 1,000 matches) and the pass stops after 3 seconds, so
    // detection never crowds the database; the open issues below are the fix list either way.
    const counts: Record<string, number | string> = {};
    const stopAt = Date.now() + 3_000;
    for (const r of rules.rows) {
      if (Date.now() > stopAt) {
        counts[String(r.id)] = "skipped (time)";
        continue;
      }
      const q = String(r.check_sql ?? "").trim();
      if (!isRunnableRule(r)) continue;
      try {
        // Rules name tables as {{table}}: the visitor's effective rows (overlay over base).
        const expanded = q.replace(/\{\{([a-z_]+)\}\}/g, (_, t: string) => effective(t, ctx.ws === "base" ? null : ctx.ws));
        const { results } = await ctx.db.prepare(`SELECT count(*) AS n FROM (${expanded} LIMIT 1000)`).all<{ n: number }>();
        counts[String(r.id)] = results[0]?.n ?? 0;
      } catch {
        counts[String(r.id)] = "check failed";
      }
    }
    await ctx.step({ kind: "reasoning_summary", output: { rule_checks: counts }, ok: true });

    const open = await ctx.call<{ rows: Row[]; total: number }>("data.issues", { status: "open", size: 50 });
    const out: Candidate[] = [];
    for (const issue of open.rows) {
      let fix = issue.suggested_fix as Record<string, unknown> | null;
      if (!fix || (!fix.changes && !fix.action && !fix.merge_into)) {
        const table = String(issue.entity_type);
        const row = await ctx.call<Row>("records.get", { entity: table, id: String(issue.entity_id) }).catch(() => null);
        const computed = row ? computeFix(String(issue.rule_id), row) : null;
        if (!computed) continue;
        fix = { ...computed, source: "data_health" };
      }
      const p = fixProposal({ ...issue, suggested_fix: JSON.stringify(fix), evidence: JSON.stringify(issue.evidence ?? {}) });
      const { effects, ...extra } = p.payload as { effects: Record<string, unknown>[] };
      out.push({
        ...p, extra, facts: { rule: String(issue.rule_id), severity: String(issue.severity), entity: String(issue.entity_type), record: String(issue.entity_id) },
        effects, mandatory: p.alwaysHuman, priority: (SEVERITY[String(issue.severity)] ?? 1) * 1000 + Math.round((p.confidence ?? 0) * 100),
      });
    }
    return out;
  },
});
