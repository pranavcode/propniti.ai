import { can } from "@/entities";
import { PERMISSIONS } from "@/auth/personas";
import { dataOf, guarded, json, staffSession } from "@/ai/http";
import { asOf, sql } from "@/ai/data";
import { delinquency } from "@/ai/facts";
import { QUEUE_SQL } from "@/ai/views";
import { decidableSql } from "@/ai/decide";
import { agingByProperty } from "@/extensions/receivables/queries";
import type { GuideFacts } from "@/components/app/guide/nudges";

// Counts behind the chat bubble's nudges, for the acting persona and scope. Each figure comes from
// the same query as the page the nudge links to: Approvals › Needs you, the delinquency aging's
// 31+ day columns (cached per workspace) and Data health's open critical issues. The bubble asks at
// most once every two minutes.
export async function GET(request: Request) {
  return guarded(async () => {
    const s = await staffSession(request);
    if (s instanceof Response) return s;
    const data = dataOf(s);
    const role = s.actor.role;
    const readsCharges = can(role, "read", "charges");
    const [approvals, aging, issues, remind] = await Promise.all([
      // Same rule as the Approvals nav item (the role has the intelligence module) and the same
      // count as Approvals › Needs you: only proposals this role may decide.
      (PERMISSIONS[role].intelligence ?? "none") !== "none"
        ? sql<{ n: number }>(data, `SELECT count(*) AS n FROM {ai_proposals} p LEFT JOIN {ai_decisions} d ON d.proposal_id = p.id WHERE ${QUEUE_SQL.needs_you} AND ${decidableSql(role).sql}`, decidableSql(role).params).then((r) => Number(r[0]?.n ?? 0)).catch(() => null)
        : null,
      readsCharges ? agingByProperty({ db: s.db, ws: s.ws === "base" ? null : s.ws, actor: s.actor }).catch(() => null) : null,
      sql<{ n: number }>(data, "SELECT count(*) AS n FROM {data_issues} WHERE status = 'open' AND severity = 'critical'").then((r) => Number(r[0]?.n ?? 0)).catch(() => null),
      // Same query and threshold as the assistant's "send reminders to residents 30+ days late".
      readsCharges ? asOf(s.db).then((today) => delinquency(data, today, { minDays: 30, limit: 1 })).then((r) => r.total).catch(() => null) : null,
    ]);
    const late = aging?.filter((r) => r.b31_60 + r.b61_90 + r.b90p > 0);
    const facts: GuideFacts = {
      approvals,
      pastDue: late ? { cents: late.reduce((t, r) => t + r.b31_60 + r.b61_90 + r.b90p, 0), properties: late.length } : null,
      dataIssues: issues == null ? null : { critical: issues },
      remind: remind == null ? null : { residents: remind },
    };
    return json(facts);
  });
}
