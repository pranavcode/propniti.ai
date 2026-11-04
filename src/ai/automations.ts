import { getEntity } from "@/entities";
import type { AgentKey, Tone } from "@/entities/types";
import { PERMISSIONS, PERSONAS } from "@/auth/personas";
import { AS_OF } from "@/seed/constants";
import { getAgent } from "./agents/registry";
import { sql, type DataCtx } from "./data";
import { lastSweep, loadPolicies, SWEEP_EVERY_MS } from "./orchestrator";
import { agentCards } from "./views";
import { canEditPolicies } from "./policy-editors";
import { isRunnableRule, RUNNABLE_RULES_SQL } from "./data-rules";
export { canEditPolicies } from "./policy-editors";

// Read model for /app/automations: what runs on its own, when, and under which rules. Everything
// here comes from the same config, policies and code paths the orchestrator and runtime use.

// The runtime has two behaviours: only auto_within_policy applies anything on its own (runtime.ts
// proposeImpl). A saved "suggest" queues proposals exactly like act_with_approval.
export const AUTONOMY_LEVELS = {
  act_with_approval: { label: "Approve first", help: "Every action waits for a person in the approvals inbox." },
  auto_within_policy: { label: "Auto within policy", help: "Low-risk actions under the approval-policy limits apply on their own and are logged; the rest wait for a person." },
} as const;
export type AutonomyLevel = keyof typeof AUTONOMY_LEVELS;
export const autonomyLevel = (a: string) => {
  const value: AutonomyLevel = a === "auto_within_policy" ? "auto_within_policy" : "act_with_approval";
  return { value, ...AUTONOMY_LEVELS[value] };
};

// Where each event an agent can listen for comes from. source null: nothing in the product raises
// it today, so the agent only reaches that work on its schedule.
export const EVENT_INFO: Record<string, { label: string; source: string | null }> = {
  "charge.overdue": { label: "Rent overdue", source: "The sweep, when an open charge is 3 to 10 days past due (once per lease per day)" },
  "lease.expiring": { label: "Lease expiring", source: "The sweep, when an active lease is 83 to 90 days from its end date" },
  "payment.failed": { label: "Payment returned", source: "Someone marks a resident payment as returned (NSF)" },
  "invoice.received": { label: "Invoice received", source: "Someone enters a bill, or a vendor sends an invoice from the vendor portal" },
  "vendor.bank_changed": { label: "Vendor bank details changed", source: "An accountant records new bank details for a vendor" },
  "wo.created": { label: "Work order created", source: "A work order is created by staff, from a resident's portal request, from a preventive schedule or from a damaged inspection item" },
  "service_request.created": { label: "Service request created", source: "Someone logs a service request" },
  "application.submitted": { label: "Application submitted", source: "An applicant submits an application on the listings site" },
  "import.completed": { label: "Import finished", source: "The import wizard finishes loading records" },
  "owner.distribution_sent": { label: "Owner distribution sent", source: "Someone sends an owner distribution" },
  "coi.expiring": { label: "Insurance certificate expiring", source: null },
  "prospect.created": { label: "New prospect", source: null },
  "screening.completed": { label: "Screening completed", source: null },
  "statement.closed": { label: "Owner statement closed", source: null },
  "data_issue.detected": { label: "Data issue found", source: null },
};
export const eventLabel = (t: string) => EVENT_INFO[t]?.label ?? t.replace(/[._]/g, " ");

const DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const NUM = /^\d{1,2}$/;
const hhmm = (h: string, m: string) => `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;

// Plain words for the schedules agents use; anything else shows as the cron expression.
export function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [m, h, dom, mon, dow] = parts;
  if (mon !== "*") return expr;
  const everyMin = /^\*\/(\d+)$/.exec(m);
  const hourRange = /^(\d{1,2})-(\d{1,2})$/.exec(h);
  const everyHour = /^\*\/(\d+)$/.exec(h);
  const anyDay = dom === "*" && dow === "*";
  if (everyMin && h === "*" && anyDay) return `Every ${everyMin[1]} minutes`;
  if (everyMin && hourRange && anyDay) return `Every ${everyMin[1]} minutes, ${hhmm(hourRange[1], "0")}–${hhmm(hourRange[2], "59")}`;
  if (NUM.test(m) && everyHour && anyDay) return `Every ${everyHour[1]} hours`;
  if (!NUM.test(m) || !NUM.test(h)) return expr;
  const at = hhmm(h, m);
  if (anyDay) return `Daily at ${at}`;
  if (dom === "*" && /^[0-6]$/.test(dow)) return `${DAYS[Number(dow)]} at ${at}`;
  if (NUM.test(dom) && dow === "*") return `Monthly on day ${dom} at ${at}`;
  return expr;
}

// The Cron Trigger fires on real 15-minute boundaries (the orchestrator's tick is
// floor(now / SWEEP_EVERY_MS)), so this uses real time, not the demo clock. Late: no sweep for
// over two intervals.
export function sweepTiming(nowMs: number, lastMs: number | null) {
  const next = (Math.floor(nowMs / SWEEP_EVERY_MS) + 1) * SWEEP_EVERY_MS;
  return {
    nextInMin: Math.ceil((next - nowMs) / 60_000),
    lastAgoMin: lastMs ? Math.max(0, Math.round((nowMs - lastMs) / 60_000)) : null,
    late: lastMs != null && nowMs - lastMs > 2 * SWEEP_EVERY_MS,
  };
}

// The sweep timing as of now, from the last sweep's stamp (the Agents page).
export const sweepNow = (lastIso: string | null) => sweepTiming(Date.now(), lastIso ? Date.parse(lastIso) : null);

export type AutomationAgent = {
  key: AgentKey; name: string; goal: string; href: string; enabled: boolean;
  schedule: string | null; scheduleText: string | null; events: { type: string; label: string }[]; scope: string;
  autonomy: ReturnType<typeof autonomyLevel>;
  lastRun: { id: string; status: string; started_at: string; href: string } | null; nextDueAt: string | null;
  runs30: number; ok30: number; failed30: number; pending: number; status: { label: string; tone: Tone };
};

const roleTitle = (r: string) => PERSONAS.find((p) => p.role === r)?.title ?? r.replace(/_/g, " ");
// Same order as Settings → Approval policies.
const POLICY_ORDER = ["Maintenance spend", "Bill payment", "Concession", "Write-off", "Owner distribution", "Legal", "Safety"];

export async function automationsView(data: DataCtx, nowMs = Date.now()) {
  const org = data.actor.propertyIds === "all";
  let policiesOk = true;
  const [cards, policies, last, queued, rules, caps] = await Promise.all([
    agentCards(data, nowMs),
    loadPolicies(data.db, data.ws).catch(() => ((policiesOk = false), [])),
    lastSweep(data.db),
    sql<{ type: string; n: number }>(data, "SELECT type, count(*) AS n FROM {events} WHERE processed_at IS NULL GROUP BY type"),
    data.db.prepare(RUNNABLE_RULES_SQL).all<{ check_kind: string; check_sql: string | null }>(),
    sql<{ state: string; rule: string; value: string }>(data, "SELECT state, rule, value FROM {state_rules} WHERE rule IN ('late_fee_cap_pct', 'nsf_fee_cap_cents') AND effective_from <= ? ORDER BY effective_from", [AS_OF], { unscoped: true }),
  ]);

  const agents: AutomationAgent[] = cards.map((c) => {
    const def = getAgent(c.key);
    const status: AutomationAgent["status"] = !c.enabled ? { label: "Off", tone: "neutral" }
      : c.lastRun?.status === "running" ? { label: "Running", tone: "ai" }
      : c.lastRun?.status === "failed" ? { label: "Last run failed", tone: "danger" }
      : c.pending ? { label: `${c.pending} waiting`, tone: "warning" }
      : { label: "On", tone: "success" };
    return {
      key: c.key, name: c.name, goal: c.goal, href: `/app/ai/activity?agent=${c.key}`, enabled: c.enabled,
      schedule: c.schedule, scheduleText: c.schedule ? describeCron(c.schedule) : null,
      events: c.events.map((type) => ({ type, label: eventLabel(type) })),
      scope: (def?.entities ?? []).map((e) => getEntity(e)?.label.many ?? e.charAt(0).toUpperCase() + e.slice(1).replace(/_/g, " ")).join(", "),
      autonomy: autonomyLevel(c.autonomy),
      // A property-scoped person may not open another scope's trace (runDetail); the agent's runs list is filtered for them.
      lastRun: c.lastRun ? { id: c.lastRun.id, status: c.lastRun.status, started_at: c.lastRun.started_at, href: org ? `/app/ai/runs/${encodeURIComponent(c.lastRun.id)}` : `/app/ai/activity?agent=${c.key}` } : null,
      nextDueAt: c.nextRunAt, runs30: c.runs30, ok30: c.ok30, failed30: c.failed30, pending: c.pending, status,
    };
  });

  const types = [...new Set(cards.filter((c) => c.enabled).flatMap((c) => c.events))].sort((a, b) => eventLabel(a).localeCompare(eventLabel(b)));
  const events = types.map((type) => ({
    type, label: eventLabel(type), source: EVENT_INFO[type]?.source ?? null, queued: Number(queued.find((q) => q.type === type)?.n ?? 0),
    agents: cards.filter((c) => c.enabled && c.events.includes(type)).map((c) => ({ key: c.key, name: c.name })),
  }));

  // Latest value per state and rule in force on the demo day; a 0% cap means no statutory cap.
  const latest = new Map(caps.map((r) => [`${r.rule}|${r.state}`, r]));
  const capList = (rule: string) => [...latest.values()].filter((r) => r.rule === rule && Number(r.value) > 0).map((r) => ({ state: r.state, value: Number(r.value) })).sort((a, b) => a.state.localeCompare(b.state));

  const role = data.actor.role;
  const access = PERMISSIONS[role].intelligence ?? "none";
  const settings = (PERMISSIONS[role].settings ?? "none") !== "none";
  const editPolicies = canEditPolicies(role);
  const policiesHref = settings ? "/app/settings/approvals" : editPolicies ? "/app/agents" : null;

  return {
    agents, events,
    sweep: { everyMin: SWEEP_EVERY_MS / 60_000, ...sweepTiming(nowMs, last) },
    policiesOk,
    policies: [...policies].sort((a, b) => POLICY_ORDER.indexOf(a.category) - POLICY_ORDER.indexOf(b.category)).map((p) => ({
      id: p.id, category: p.category, limit: p.limitCents == null ? null : p.limitCents / 100, ownerOver: p.ownerApprovalOverCents == null ? null : p.ownerApprovalOverCents / 100,
      approver: roleTitle(p.approverRole), alwaysHuman: p.alwaysHuman,
    })),
    dataRules: rules.results.filter(isRunnableRule).length,
    stateCaps: { lateFeePct: capList("late_fee_cap_pct"), nsfCents: capList("nsf_fee_cap_cents") },
    can: { view: access !== "none", editAutonomy: editPolicies, settings, editPolicies, policiesHref },
  };
}
export type AutomationsView = Awaited<ReturnType<typeof automationsView>>;
