import "server-only";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, Clock, Hourglass, Sparkles } from "lucide-react";
import { can, getEntity, type EntityKey, type Role } from "@/entities";
import { PERMISSIONS } from "@/auth/personas";
import { widgetsFor } from "@/extensions/widgets";
import type { Session } from "@/auth/session";
import { AGENT_LABEL, type ProposalJson } from "@/ai/ui/client";
import { ProposalCard } from "@/ai/ui/RunView";
import { proposalsPage } from "@/ai/views";
import type { DataCtx } from "@/ai/data";
import { PageBody, Section } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { RelativeDate, StatusBadge } from "@/components/app/display";
import { getPlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { QueryCtx } from "@/server/query";
import { asOf, count, rows } from "../data";
import { BriefingAsk, RecentlyViewed } from "./client";

// The AI briefing home (addendum 4): good morning, what the agents did overnight, what needs
// you, risks and anomalies, the ask box, then the persona's module widgets and recent records.
// Every figure is computed from the persona's scoped data; the page says so.

type Risk = { key: string; label: string; detail: string; n: number; href: string; tone: "danger" | "warning" };
type Run = { id: string; agent_key: string; status: string; started_at: string; summary: string | null; model: string | null };

function greeting(now: Date) {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Chicago" }).format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// Rows in the persona's properties; org-level rows (no property) stay visible to org roles only.
function scoped(ctx: QueryCtx, col = "property_id") {
  const ids = ctx.actor.propertyIds;
  return ids === "all" ? { sql: "1 = 1", params: [] as unknown[] } : { sql: `${col} IN (SELECT value FROM json_each(?))`, params: [JSON.stringify(ids)] as unknown[] };
}

async function risks(ctx: QueryCtx, role: Role): Promise<Risk[]> {
  const s = scoped(ctx);
  const sw = scoped(ctx, "w.property_id");
  const checks: { key: string; entity: EntityKey; label: string; detail: string; href: string; tone: Risk["tone"]; sql: string; params: unknown[] }[] = [
    { key: "issues", entity: "data_issues", label: "Critical data issues", detail: "Bad data under money decisions, such as an unverified vendor bank change", href: "/app/data-health?severity=critical", tone: "danger",
      sql: `SELECT count(*) AS n FROM {data_issues} WHERE status = 'open' AND severity = 'critical' AND ${s.sql}`, params: s.params },
    { key: "sla", entity: "work_orders", label: "Work orders past SLA", detail: "Open past their SLA due time", href: "/app/maintenance/work-orders?view=past-sla", tone: "danger",
      sql: `SELECT count(*) AS n FROM {work_orders} WHERE status NOT IN ('Completed', 'Paid', 'Cancelled') AND sla_due_at IS NOT NULL AND substr(sla_due_at, 1, 10) < $AS_OF AND ${s.sql}`, params: s.params },
    { key: "compliance", entity: "compliance_items", label: "Overdue compliance items", detail: "Inspections, permits and certificates past due", href: "/app/compliance", tone: "danger",
      sql: `SELECT count(*) AS n FROM {compliance_items} WHERE completed_on IS NULL AND status <> 'Done' AND due_on < $AS_OF AND (property_id IS NULL OR ${s.sql})`, params: s.params },
    { key: "coi", entity: "vendor_cois", label: "Vendors with lapsed insurance on open jobs", detail: "Expired or missing COI while a work order is open", href: "/app/compliance", tone: "warning",
      sql: `SELECT count(DISTINCT w.vendor_id) AS n FROM {work_orders} w WHERE w.status NOT IN ('Completed', 'Paid', 'Cancelled') AND ${sw.sql} AND w.vendor_id IS NOT NULL AND coalesce((SELECT max(c.expires_on) FROM {vendor_cois} c WHERE c.vendor_id = w.vendor_id AND c.status <> 'Missing'), '0000') < $AS_OF`, params: sw.params },
    { key: "policies", entity: "insurance_policies", label: "Property policies expiring in 60 days", detail: "Renew before coverage lapses", href: "/app/compliance", tone: "warning",
      sql: `SELECT count(*) AS n FROM {insurance_policies} WHERE expires_on BETWEEN $AS_OF AND date($AS_OF, '+60 days') AND ${s.sql}`, params: s.params },
    { key: "legal", entity: "legal_cases", label: "Court dates in the next 7 days", detail: "Evictions and claims with a hearing or deadline", href: "/app/compliance", tone: "warning",
      sql: `SELECT count(*) AS n FROM {legal_cases} WHERE closed_on IS NULL AND next_date BETWEEN $AS_OF AND date($AS_OF, '+7 days') AND ${s.sql}`, params: s.params },
  ];
  const out = await Promise.all(checks.filter((c) => (getEntity(c.entity) ? can(role, "read", c.entity) : true)).map(async (c) => ({ ...c, n: await count(ctx, c.sql, c.params).catch(() => 0) })));
  return out.filter((r) => r.n > 0).map(({ key, label, detail, n, href, tone }) => ({ key, label, detail, n, href, tone }));
}

export async function Briefing({ session, data }: { session: Session; data: DataCtx }) {
  const ctx: QueryCtx = { db: getPlatform().db, ws: session.ws, actor: session.actor };
  const { persona, actor } = session;
  const role = actor.role;
  const today = await asOf(ctx);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const s = scoped(ctx);
  const canAi = (PERMISSIONS[role].intelligence ?? "none") !== "none";
  const [queue, runs, autoNight, tasks, overdueTasks, riskList] = await Promise.all([
    proposalsPage(data, { queue: "needs_you", size: 4 }).catch(() => ({ rows: [], total: 0, counts: {} as Record<string, number> })),
    rows<Run>(ctx, "SELECT id, agent_key, status, started_at, summary, model FROM {agent_runs} WHERE started_at >= ? ORDER BY started_at DESC LIMIT 200", [since]),
    count(ctx, `SELECT count(*) AS n FROM {ai_proposals} WHERE queue_state = 'auto_handled' AND created_at >= ? AND (property_id IS NULL OR ${s.sql})`, [since, ...s.params]),
    rows<{ id: string; title: string; due_on: string | null; priority: string; entity_type: string | null; entity_id: string | null }>(ctx,
      "SELECT id, title, due_on, priority, entity_type, entity_id FROM {tasks} WHERE status IN ('Open', 'In progress') AND (assignee_id = ? OR (assignee_id IS NULL AND assignee_role = ?)) ORDER BY due_on IS NULL, due_on LIMIT 5", [persona.id, role]),
    count(ctx, "SELECT count(*) AS n FROM {tasks} WHERE status IN ('Open', 'In progress') AND (assignee_id = ? OR (assignee_id IS NULL AND assignee_role = ?)) AND due_on < $AS_OF", [persona.id, role]),
    risks(ctx, role),
  ]);
  const counts = queue.counts as Record<string, number>;
  const needs = counts.needs_you ?? 0;
  const waiting = counts.waiting ?? 0;
  const high = queue.rows.filter((p) => p.risk === "High").length;
  const byAgent = new Map<string, Run[]>();
  for (const r of runs) byAgent.set(r.agent_key, [...(byAgent.get(r.agent_key) ?? []), r]);
  const failed = runs.filter((r) => r.status === "failed").length;
  const widgets = widgetsFor(role);

  const sentence = [
    runs.length ? `Since yesterday ${byAgent.size} ${byAgent.size === 1 ? "agent" : "agents"} ran ${runs.length} ${runs.length === 1 ? "time" : "times"} and handled ${autoNight} ${autoNight === 1 ? "item" : "items"} within policy.` : "No agent runs since yesterday.",
    needs ? `${needs} ${needs === 1 ? "decision needs" : "decisions need"} you${high ? `, ${high} high risk` : ""}.` : "Nothing is waiting on your approval.",
    riskList.length ? `${riskList.reduce((a, r) => a + r.n, 0)} risks to look at.` : "",
  ].filter(Boolean).join(" ");

  const tiles = [
    { label: "Needs you", value: needs + overdueTasks, sub: `${needs} approvals · ${overdueTasks} overdue tasks`, href: "/app/ai/approvals", icon: <AlertTriangle />, tone: needs + overdueTasks ? "text-tone-warning" : "text-muted-foreground" },
    { label: "Handled by agents", value: autoNight, sub: "Since yesterday, within policy", href: "/app/ai/approvals?queue=auto_handled", icon: <CheckCircle2 />, tone: "text-tone-success" },
    { label: "Waiting on others", value: waiting, sub: "Owner approvals and replies", href: "/app/ai/approvals?queue=waiting", icon: <Hourglass />, tone: "text-tone-info" },
    { label: "Agent runs", value: runs.length, sub: failed ? `${failed} failed` : "Since yesterday, none failed", href: "/app/ai/activity", icon: <Bot />, tone: failed ? "text-tone-danger" : "text-tone-ai" },
  ];

  return (
    <PageBody className="gap-6 pt-6">
      <header className="flex flex-col gap-1">
        <p className="text-[12.5px] text-muted-foreground">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${today}T12:00:00Z`))} · {persona.scope.label}</p>
        <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.015em]">{greeting(new Date())}, {persona.name.split(" ")[0]}</h1>
        <p className="max-w-3xl text-[14px] text-muted-foreground">{sentence} <span className="inline-flex items-center gap-1 align-middle text-[11.5px] text-muted-foreground/80"><Sparkles className="size-3" />Computed from your data</span></p>
      </header>

      <BriefingAsk prompts={persona.assistantPrompts} />

      {canAi && (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <li key={t.label}>
              <Link href={t.href} className="group flex h-full flex-col gap-1 rounded-lg border bg-card p-3.5 transition-colors hover:border-primary/40">
                <span className={cn("flex items-center gap-1.5 text-[12px] font-medium [&_svg]:size-3.5", t.tone)}>{t.icon}<span className="text-muted-foreground">{t.label}</span></span>
                <span className="text-[24px] leading-8 font-semibold tabular-nums">{t.value.toLocaleString("en-US")}</span>
                <span className="text-[12px] text-muted-foreground">{t.sub}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          {canAi && (
            <Section title="What needs you" description="Agent proposals over a policy limit, highest risk first. Approving runs the action and logs it." actions={needs > queue.rows.length ? <Link href="/app/ai/approvals" className="inline-flex items-center gap-1 text-[12.5px] text-primary hover:underline">All {needs} <ArrowRight className="size-3" /></Link> : undefined}>
              {!queue.rows.length ? (
                <EmptyState compact kind="table" title="Nothing waiting on you" description="When an agent proposes something over your approval limit, it shows up here with its reasons and evidence." />
              ) : (
                <div className="flex flex-col gap-2">{queue.rows.map((p) => <ProposalCard key={String(p.id)} p={p as unknown as ProposalJson} canApprove={PERMISSIONS[role].intelligence === "approve"} />)}</div>
              )}
            </Section>
          )}

          <Section title="Your tasks" actions={<Link href="/app/tasks" className="text-[12.5px] text-primary hover:underline">All tasks</Link>}>
            {!tasks.length ? (
              <EmptyState compact kind="table" title="No open tasks" description="Tasks assigned to you or your role, from people, automations and agents." />
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                    <Clock className={cn("size-3.5 shrink-0", t.due_on && t.due_on < today ? "text-tone-danger" : "text-muted-foreground")} />
                    <Link href={`/app/tasks?task=${encodeURIComponent(t.id)}`} className="min-w-0 flex-1 truncate hover:text-primary hover:underline">{t.title}</Link>
                    {t.priority === "High" && <StatusBadge value="High" tone="warning" />}
                    {t.due_on && <RelativeDate value={t.due_on} mode="due" className="shrink-0 text-[12px]" />}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Risks and anomalies">
            {!riskList.length ? (
              <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-3 text-[12.5px] text-muted-foreground"><CheckCircle2 className="size-4 text-tone-success" />No open risks in your scope right now.</div>
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {riskList.map((r) => (
                  <li key={r.key}>
                    <Link href={r.href} className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted/50">
                      <span className={cn("mt-0.5 min-w-8 rounded px-1.5 text-center text-[13px] font-semibold tabular-nums", r.tone === "danger" ? "bg-tone-danger/10 text-tone-danger" : "bg-tone-warning/10 text-tone-warning")}>{r.n}</span>
                      <span className="min-w-0 flex-1"><span className="block font-medium">{r.label}</span><span className="block text-[12px] text-muted-foreground">{r.detail}</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Overnight" description="What the agents did since yesterday." actions={<Link href="/app/agents" className="text-[12.5px] text-primary hover:underline">Agents</Link>}>
            {!byAgent.size ? (
              <EmptyState compact kind="table" title="No runs since yesterday" description="Agents run on a schedule, on events and when someone presses Run now." action={{ label: "Open agents", href: "/app/agents" }} />
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {[...byAgent.entries()].map(([agent, list]) => {
                  const last = list[0];
                  return (
                    <li key={agent} className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Sparkles className="size-3.5 text-tone-ai" />
                        <span className="font-medium">{AGENT_LABEL[agent] ?? agent.replace(/_/g, " ")}</span>
                        <span className="text-[12px] text-muted-foreground tabular-nums">{list.length} {list.length === 1 ? "run" : "runs"}</span>
                        <Link href={`/app/ai/runs/${encodeURIComponent(last.id)}`} className="ml-auto text-[12px] text-primary hover:underline"><RelativeDate value={last.started_at} /></Link>
                      </div>
                      {last.summary && <p className="mt-0.5 line-clamp-2 pl-5.5 text-[12.5px] text-muted-foreground">{last.summary}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Quick actions">
            <div className="flex flex-wrap gap-1.5">
              {persona.quickActions.map((q) => <Link key={q.href} href={q.href} className="inline-flex h-8 items-center rounded-md border bg-card px-3 text-[12.5px] hover:border-primary/40 hover:bg-primary/[0.03]">{q.label}</Link>)}
            </div>
          </Section>

          <Section title="Recently viewed"><RecentlyViewed /></Section>
        </div>
      </div>

      {widgets.length > 0 && (
        <div className="grid grid-cols-12 gap-4">
          {widgets.map((w) => {
            const C = w.component;
            return (
              <section key={w.key} className={cn("col-span-12", w.size === "sm" && "md:col-span-6 xl:col-span-3", w.size === "md" && "xl:col-span-6", w.size === "lg" && "xl:col-span-8")}>
                <h2 className="mb-2 text-[14px] font-semibold tracking-tight">{w.title}</h2>
                <C actor={actor} />
              </section>
            );
          })}
        </div>
      )}
    </PageBody>
  );
}
