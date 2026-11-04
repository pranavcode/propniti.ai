import Link from "@/components/Link";
import { decidableSql } from "@/ai/decide";
import { AlertTriangle, ArrowRight, Bot, CalendarClock, CircleDollarSign, HeartPulse, MessageSquare, ShieldAlert, Sparkles, Wrench, Zap } from "lucide-react";
import { ApprovalsInbox } from "@/ai/ui/ApprovalsInbox";
import { pageData } from "@/ai/ui/server";
import { proposalsPage } from "@/ai/views";
import { agingByProperty } from "@/extensions/receivables/queries";
import { metrics } from "@/server/query";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { ChartCard, KpiCard } from "@/components/app/dashboard";
import { RelativeDate, StatusBadge } from "@/components/app/display";
import { ErrorBanner } from "@/components/app/states";
import { formatDate, personaGreeting } from "@/lib/format";
import { cn } from "@/lib/utils";
import { asOfDate, scopeIn, sql } from "../server";
import { AskToday } from "./AskToday";

// Today: the property manager's home. An AI briefing computed from the persona's properties, the
// approvals queue, the numbers that move day to day, and the conversations and data issues
// waiting. Every number links to the rows behind it.

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const OPEN_WO = ["New", "Triaged", "Assigned", "Scheduled", "In progress", "On hold", "Submitted"];
const WO_OPEN_Q = `f.status=${OPEN_WO.map(encodeURIComponent).join(",")}`;

type Bullet = { icon: typeof Bot; tone: "ai" | "danger" | "warning" | "info" | "success"; text: React.ReactNode; href: string; cta: string };

async function settle<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    console.error("today", e);
    return fallback;
  }
}

export async function TodayPage() {
  const session = await currentSession();
  const { data } = await pageData();
  const ctx = { db: getPlatform().db, ws: session.ws, actor: session.actor };
  const { actor, persona } = session;
  const today = await asOfDate(ctx.db);
  const p = (col: string) => scopeIn(actor, col);

  const [late, runs, auto, needs, leases, wo, threads, issues, insurance, unread, initialQueue, kColl, kExp, exp, woPri] = await Promise.all([
    // Same live aging the receivables pages show (cached per scope), so the figures agree across modules.
    settle(agingByProperty(ctx), []),
    settle(sql<{ agent_key: string; n: number }>(ctx, "SELECT agent_key, count(*) AS n FROM {agent_runs} WHERE started_at >= datetime(?, '-1 day') GROUP BY agent_key ORDER BY n DESC", [today]), []),
    settle(sql<{ n: number }>(ctx, `SELECT count(*) AS n FROM {ai_proposals} WHERE queue_state = 'auto_handled' AND created_at >= datetime(?, '-1 day') AND ${p("property_id").sql}`, [today, ...p("property_id").binds]), []),
    settle(sql<{ n: number; high: number }>(ctx, `SELECT count(*) AS n, sum(risk = 'High') AS high FROM {ai_proposals} pr WHERE queue_state = 'needs_you' AND NOT EXISTS (SELECT 1 FROM {ai_decisions} d WHERE d.proposal_id = pr.id) AND ${decidableSql(actor.role, "pr").sql} AND ${p("pr.property_id").sql}`, [...decidableSql(actor.role, "pr").params, ...p("pr.property_id").binds]), []),
    settle(sql(ctx, `SELECT l.id, l.end_on, l.rent_cents, u.number AS unit, h.name AS household, pr.name AS property
      FROM {leases} l LEFT JOIN {units} u ON u.id = l.unit_id LEFT JOIN {households} h ON h.id = l.household_id LEFT JOIN {properties} pr ON pr.id = l.property_id
      WHERE l.status = 'Active' AND l.end_on BETWEEN ? AND date(?, '+60 days') AND NOT EXISTS (SELECT 1 FROM {renewal_offers} o WHERE o.lease_id = l.id) AND l.id NOT IN (SELECT n.renewal_of FROM {leases} n WHERE n.renewal_of IS NOT NULL) AND ${p("l.property_id").sql}
      ORDER BY l.end_on LIMIT 200`, [today, today, ...p("l.property_id").binds]), []),
    settle(sql<{ open: number; urgent: number; late: number }>(ctx, `SELECT count(*) AS open, sum(priority IN ('Emergency', 'Urgent')) AS urgent, sum(sla_due_at IS NOT NULL AND substr(sla_due_at, 1, 10) < ?) AS late FROM {work_orders} WHERE status IN (SELECT value FROM json_each(?)) AND ${p("property_id").sql}`, [today, JSON.stringify(OPEN_WO), ...p("property_id").binds]), []),
    settle(sql(ctx, `SELECT t.id, t.subject, t.party_kind, t.last_message_at, t.unread,
      (SELECT m.body FROM {messages} m WHERE m.thread_id = t.id ORDER BY m.sent_at DESC LIMIT 1) AS preview,
      CASE t.party_kind WHEN 'resident' THEN (SELECT r.first_name || ' ' || r.last_name FROM {residents} r WHERE r.id = t.party_id) WHEN 'vendor' THEN (SELECT v.company FROM {vendors} v WHERE v.id = t.party_id) WHEN 'owner' THEN (SELECT o.name FROM {owners} o WHERE o.id = t.party_id) ELSE t.party_id END AS party
      FROM {message_threads} t WHERE t.status = 'Open' AND ${p("t.property_id").sql} ORDER BY t.unread DESC, t.last_message_at DESC LIMIT 5`, p("t.property_id").binds), []),
    settle(sql<{ entity_type: string; rule_id: string; n: number }>(ctx, `SELECT entity_type, rule_id, count(*) AS n FROM {data_issues} WHERE status = 'open' AND entity_type IN ('residents', 'leases', 'households', 'message_threads') AND ${p("property_id").sql} GROUP BY 1, 2 ORDER BY n DESC`, p("property_id").binds), []),
    settle(sql<{ lapsed: number; expiring: number }>(ctx, `SELECT sum(status = 'Lapsed') AS lapsed, sum(status = 'Expiring') AS expiring FROM {renters_insurance} WHERE ${p("property_id").sql}`, p("property_id").binds), []),
    settle(sql<{ n: number }>(ctx, `SELECT count(*) AS n FROM {message_threads} WHERE status = 'Open' AND unread = 1 AND ${p("property_id").sql}`, p("property_id").binds), []),
    settle(proposalsPage(data, { queue: "needs_you", size: 6 }), null),
    settle(metrics(ctx, "receivables.collections_rate"), null),
    settle(metrics(ctx, "residents.expiring_60"), null),
    settle(metrics(ctx, "residents.expirations"), null),
    settle(metrics(ctx, "residents.wo_by_priority"), null),
  ]);

  const w = wo[0] ?? { open: 0, urgent: 0, late: 0 };
  const needN = Number(needs[0]?.n ?? 0), highN = Number(needs[0]?.high ?? 0);
  const runN = runs.reduce((a, r) => a + Number(r.n), 0);
  const autoN = Number(auto[0]?.n ?? 0);
  const unreadN = Number(unread[0]?.n ?? 0);
  const issueN = issues.reduce((a, i) => a + Number(i.n), 0);
  const lapsed = Number(insurance[0]?.lapsed ?? 0);
  const sum = (k: "b0_30" | "b31_60" | "b61_90" | "b90p" | "total" | "households") => late.reduce((a, r) => a + Number(r[k]), 0);
  const lateCents = sum("total"), lateHouseholds = sum("households"), over30 = sum("b31_60") + sum("b61_90") + sum("b90p");
  const aging = ([["0-30", "b0_30"], ["31-60", "b31_60"], ["61-90", "b61_90"], ["90+", "b90p"]] as const).map(([bucket, k]) => ({ bucket, label: `${bucket} days`, amount: sum(k) / 100 }));
  const worst = late[0];
  const soon30 = leases.filter((l) => String(l.end_on) <= new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10)).length;

  // The briefing: what happened, then what needs you, most urgent first. Figures are computed here.
  const bullets: Bullet[] = [];
  if (runN) bullets.push({ icon: Bot, tone: "ai", text: <>Agents ran <b>{runN}</b> time{runN === 1 ? "" : "s"} in the last 24 hours{runs.length ? ` (${runs.slice(0, 3).map((r) => `${r.agent_key.replace(/_/g, " ")} ${r.n}`).join(", ")})` : ""} and handled <b>{autoN}</b> low-risk item{autoN === 1 ? "" : "s"} on their own.</>, href: "/app/ai/activity", cta: "See activity" });
  if (needN) bullets.push({ icon: Zap, tone: highN ? "danger" : "warning", text: <><b>{needN}</b> proposal{needN === 1 ? " needs" : "s need"} your decision{highN ? <>, <b>{highN}</b> high risk</> : ""}.</>, href: "/app/ai/approvals", cta: "Review" });
  if (lateCents) bullets.push({ icon: CircleDollarSign, tone: over30 ? "danger" : "warning", text: <><b>{lateHouseholds}</b> household{lateHouseholds === 1 ? " owes" : "s owe"} <b>{usd(lateCents)}</b> past due, <b>{usd(over30)}</b> of it over 30 days{worst && late.length > 1 ? <>; most at {worst.name} ({usd(Number(worst.total))})</> : ""}.</>, href: "/app/receivables/delinquency", cta: "Delinquency" });
  if (w.late || w.urgent) bullets.push({ icon: Wrench, tone: w.late ? "danger" : "warning", text: <><b>{w.open}</b> open work orders: <b>{w.urgent}</b> emergency or urgent, <b>{w.late}</b> past SLA.</>, href: `/app/maintenance/work-orders?view=past-sla`, cta: "Work orders" });
  if (leases.length) bullets.push({ icon: CalendarClock, tone: soon30 ? "warning" : "info", text: <><b>{leases.length}</b> lease{leases.length === 1 ? " ends" : "s end"} in the next 60 days with no renewal offer, <b>{soon30}</b> within 30 days.</>, href: "/app/leases?view=expiring-60", cta: "Leases" });
  if (unreadN) bullets.push({ icon: MessageSquare, tone: "info", text: <><b>{unreadN}</b> unread conversation{unreadN === 1 ? "" : "s"} from residents, vendors and owners.</>, href: "/app/communications/inbox?unread=1", cta: "Inbox" });
  if (issueN) bullets.push({ icon: HeartPulse, tone: "warning", text: <><b>{issueN}</b> data issue{issueN === 1 ? "" : "s"} on residents and leases, such as {issues.slice(0, 2).map((i) => i.rule_id.split(".")[1].replace(/_/g, " ")).join(" and ")}. Each has a suggested fix.</>, href: "/app/data-health", cta: "Fix" });
  if (lapsed) bullets.push({ icon: ShieldAlert, tone: "warning", text: <><b>{lapsed}</b> renters insurance polic{lapsed === 1 ? "y has" : "ies have"} lapsed.</>, href: "/app/residents/insurance?f.status=Lapsed", cta: "Policies" });

  const kpi = (m: Awaited<typeof kColl>) => ({ value: m?.value ?? null, previous: m?.previous ?? null, spark: m?.spark });

  return (
    <main className="flex flex-col gap-5 px-4 pt-5 pb-10 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">{personaGreeting(persona)}</h1>
          <p className="text-[12.5px] text-muted-foreground">{formatDate(today, "always")} · {actor.scope.label}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {persona.quickActions.map((q) => <Button key={q.href} asChild size="sm" variant="outline"><Link href={q.href}>{q.label}</Link></Button>)}
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-lg border border-tone-ai/25 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--tone-ai)_5%,var(--card)),var(--card)_60%)]" data-tour="briefing" aria-labelledby="briefing-h">
          <header className="flex items-center gap-2 border-b border-tone-ai/15 px-4 py-2.5">
            <Sparkles className="size-4 text-tone-ai" />
            <h2 id="briefing-h" className="shrink-0 text-[13.5px] font-semibold">Your briefing</h2>
            <span className="ml-auto min-w-0 text-right text-[11.5px] text-muted-foreground" title="Every figure is computed from your properties' records when the page loads; no model writes or changes them.">Computed from your records just now · figures link to the rows behind them</span>
          </header>
          {bullets.length === 0 ? <p className="px-4 py-6 text-[13px] text-muted-foreground">Nothing needs you right now. Agents will flag anything new here.</p> : (
            <ul className="divide-y divide-tone-ai/10">
              {bullets.map((b) => (
                <li key={b.href} className="flex items-start gap-3 px-4 py-2.5">
                  <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", { ai: "bg-tone-ai/10 text-tone-ai", danger: "bg-tone-danger/10 text-tone-danger", warning: "bg-tone-warning/12 text-tone-warning", info: "bg-tone-info/10 text-tone-info", success: "bg-tone-success/10 text-tone-success" }[b.tone])}><b.icon className="size-3.5" /></span>
                  <p className="min-w-0 flex-1 text-[13px] leading-relaxed">{b.text}</p>
                  <Link href={b.href} className="mt-0.5 inline-flex shrink-0 items-center gap-0.5 text-[12px] font-medium text-primary hover:underline">{b.cta}<ArrowRight className="size-3" /></Link>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-tone-ai/15 p-3"><AskToday suggestions={persona.assistantPrompts} /></div>
        </section>

        <aside className="flex flex-col gap-3">
          <section className="rounded-lg border bg-card">
            <header className="flex items-center justify-between border-b px-3 py-2">
              <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><MessageSquare className="size-3.5 text-muted-foreground" />Conversations waiting</h2>
              <Link href="/app/communications/inbox" className="text-[12px] text-primary hover:underline">Inbox</Link>
            </header>
            {threads.length === 0 ? <p className="px-3 py-3 text-[12.5px] text-muted-foreground">No open conversations.</p> : (
              <ul className="divide-y">
                {threads.map((t) => (
                  <li key={String(t.id)}>
                    <Link href={`/app/communications/inbox?t=${encodeURIComponent(String(t.id))}`} className="block px-3 py-2 hover:bg-muted/50">
                      <div className="flex items-center gap-1.5 text-[12.5px]">
                        {t.unread ? <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" /> : null}
                        <span className={cn("min-w-0 flex-1 truncate", t.unread ? "font-semibold" : "font-medium")}>{String(t.party ?? "")}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground"><RelativeDate value={String(t.last_message_at)} /></span>
                      </div>
                      <p className="truncate text-[12px] text-muted-foreground">{String(t.subject)} · {String(t.preview ?? "")}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border bg-card">
            <header className="flex items-center justify-between border-b px-3 py-2">
              <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><HeartPulse className="size-3.5 text-muted-foreground" />Data health in your area</h2>
              <Link href="/app/data-health" className="text-[12px] text-primary hover:underline">All issues</Link>
            </header>
            {issues.length === 0 ? <p className="px-3 py-3 text-[12.5px] text-muted-foreground">No open issues on residents or leases.</p> : (
              <ul className="divide-y">
                {issues.slice(0, 6).map((i) => (
                  <li key={i.rule_id} className="flex items-center gap-2 px-3 py-1.5 text-[12.5px]">
                    <AlertTriangle className="size-3.5 shrink-0 text-tone-warning" />
                    <Link href={`/app/data-health?f.rule_id=${encodeURIComponent(i.rule_id)}`} className="min-w-0 flex-1 truncate hover:text-primary hover:underline">{i.rule_id.split(".")[1].replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</Link>
                    <span className="text-muted-foreground capitalize">{i.entity_type}</span>
                    <span className="w-6 text-right font-medium tabular-nums">{i.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Past-due balance" format="money" goodWhen="down" value={lateCents / 100} href="/app/receivables/delinquency" help="Unpaid charges past their due date, all aging buckets, as of today." footnote={`${lateHouseholds} household${lateHouseholds === 1 ? "" : "s"} · ${usd(over30)} over 30 days`} />
        <KpiCard label="Collections rate" format="pct" goodWhen="up" {...kpi(kColl)} href="/app/receivables/payments" help="Collected this month as a share of what was charged." />
        <KpiCard label="Leases ending in 60 days" format="count" goodWhen="down" value={kExp?.value ?? null} href="/app/leases?view=expiring-60" footnote={`${leases.length} without a renewal offer`} />
        <KpiCard label="Open work orders" format="count" goodWhen="down" value={Number(w.open)} href={`/app/maintenance/work-orders?${WO_OPEN_Q}`} footnote={`${w.late} past SLA · ${w.urgent} urgent`} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <ChartCard title="Delinquency aging" description="Past-due balance by days late" kind="bar" data={lateCents ? aging : []} x="bucket" series={[{ key: "amount", label: "Past due", format: "money" }]} drill="/app/receivables/charges?f.aging={bucket}" height={220} help="Click a bucket for the charges in it." />
        <ChartCard title="Lease expirations by month" description="Active and on-notice leases, next 12 months" kind="bar" data={(exp?.points ?? []) as never} x="label" series={[{ key: "count", label: "Leases ending", format: "count" }]} drill="/app/leases?f.end_on.min={from}&f.end_on.max={to}&f.status=Active,Notice" height={220} />
        <ChartCard title="Open work orders by priority" description="Within SLA and past SLA" kind="stacked" data={(woPri?.points ?? []) as never} x="priority" series={[{ key: "within", label: "Within SLA", format: "count", color: "var(--chart-1)" }, { key: "past_sla", label: "Past SLA", format: "count", color: "var(--tone-danger)" }]} drill={`/app/maintenance/work-orders?${WO_OPEN_Q}&f.priority={priority}`} height={220} />
      </div>

      <section data-tour="queue" aria-labelledby="queue-h" className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h2 id="queue-h" className="text-[14px] font-semibold tracking-tight">Approvals</h2>
            <p className="text-[12.5px] text-muted-foreground">Agents propose; you approve. Low-risk items inside your policies run on their own and are listed under Handled automatically.</p>
          </div>
          <Link href="/app/ai/approvals" className="text-[12px] text-primary hover:underline">Open approvals</Link>
        </div>
        {initialQueue ? <ApprovalsInbox initial={JSON.parse(JSON.stringify(initialQueue))} initialQueue="needs_you" /> : <ErrorBanner message="The approvals queue couldn't load. Open approvals to try again." />}
      </section>

      {leases.length > 0 && (
        <section className="rounded-lg border bg-card">
          <header className="flex items-center justify-between border-b px-3 py-2">
            <h2 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><CalendarClock className="size-3.5 text-muted-foreground" />Ending soon without a renewal offer</h2>
            <Link href="/app/leases?view=expiring-60" className="text-[12px] text-primary hover:underline">All {leases.length}</Link>
          </header>
          <table className="w-full text-[12.5px]">
            <tbody>
              {leases.slice(0, 6).map((l) => (
                <tr key={String(l.id)} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="px-3 py-1.5"><Link href={`/app/leases/${encodeURIComponent(String(l.id))}?tab=terms`} className="font-medium hover:text-primary hover:underline">{String(l.household ?? l.id)}</Link></td>
                  <td className="px-3 py-1.5 text-muted-foreground">{String(l.property)} #{String(l.unit)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(Number(l.rent_cents))}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatDate(String(l.end_on), "always")}</td>
                  <td className="w-24 px-3 py-1.5 text-right"><StatusBadge value={`${Math.round((Date.parse(String(l.end_on)) - Date.parse(today)) / 86_400_000)} days`} tone={String(l.end_on) <= new Date(Date.parse(today) + 30 * 86_400_000).toISOString().slice(0, 10) ? "warning" : "neutral"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
