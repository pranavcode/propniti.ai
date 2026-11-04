import { can } from "@/entities";
import { PERMISSIONS } from "@/auth/personas";
import { dataOf, guarded, json, staffSession } from "@/ai/http";
import { sql } from "@/ai/data";
import { QUEUE_SQL } from "@/ai/views";
import { agingByProperty } from "@/extensions/receivables/queries";
import { cachedCounts } from "@/extensions/inbox/counts";
import { inboxCounts } from "@/extensions/inbox/data";
import { myTasksQuery } from "@/extensions/intelligence/my-tasks";
import { list } from "@/server/query";
import type { GuideFacts } from "@/components/app/guide/nudges";

// Counts behind the chat bubble's nudges and the welcome splash's "Waiting for you", for the acting
// persona and scope. Each figure comes from the same query as the page it links to: Approvals ›
// Needs you, the delinquency aging's 31+ day columns (cached per workspace), Data health's open
// critical issues, the Inbox's conversations waiting on a reply (its 30 s badge cache) and My
// tasks' overdue and due-today tabs. The browser asks at most once every two minutes.
export async function GET(request: Request) {
  return guarded(async () => {
    const s = await staffSession(request);
    if (s instanceof Response) return s;
    const data = dataOf(s);
    const role = s.actor.role;
    const ctx = { db: s.db, ws: s.ws === "base" ? null : s.ws, actor: s.actor };
    const [approvals, aging, issues, inbox, tasks] = await Promise.all([
      // Same rule as the Approvals nav item: the role has the intelligence module.
      (PERMISSIONS[role].intelligence ?? "none") !== "none"
        ? sql<{ n: number }>(data, `SELECT count(*) AS n FROM {ai_proposals} p LEFT JOIN {ai_decisions} d ON d.proposal_id = p.id WHERE ${QUEUE_SQL.needs_you}`).then((r) => Number(r[0]?.n ?? 0)).catch(() => null)
        : null,
      can(role, "read", "charges") ? agingByProperty({ db: s.db, ws: s.ws === "base" ? null : s.ws, actor: s.actor }).catch(() => null) : null,
      sql<{ n: number }>(data, "SELECT count(*) AS n FROM {data_issues} WHERE status = 'open' AND severity = 'critical'").then((r) => Number(r[0]?.n ?? 0)).catch(() => null),
      cachedCounts(ctx.ws, s.actor.personaId, () => inboxCounts(ctx)).catch(() => null),
      can(role, "read", "tasks") ? list(ctx, "tasks", myTasksQuery(s.actor, new URLSearchParams({ size: "1" }))).then((r) => ({ overdue: r.counts?.overdue ?? 0, today: r.counts?.today ?? 0 })).catch(() => null) : null,
    ]);
    const late = aging?.filter((r) => r.b31_60 + r.b61_90 + r.b90p > 0);
    const facts: GuideFacts = {
      approvals,
      pastDue: late ? { cents: late.reduce((t, r) => t + r.b31_60 + r.b61_90 + r.b90p, 0), properties: late.length } : null,
      dataIssues: issues == null ? null : { critical: issues },
      replies: inbox ? inbox.needsReply : null,
      tasks,
    };
    return json(facts);
  });
}
