import Link from "@/components/Link";
import { AlertTriangle, ArrowRight, Bot, CalendarRange, ChevronRight, ClipboardPlus, KanbanSquare, ShieldAlert, Smartphone, Sparkles } from "lucide-react";
import { can } from "@/entities";
import type { Row } from "@/entities/types";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { formatDate, formatMoney, formatPct, formatRelative, personaGreeting } from "@/lib/format";
import { cn } from "@/lib/utils";
import { metrics } from "@/server/query";
import { proposalOut } from "@/ai/views";
import type { ProposalJson } from "@/ai/ui/client";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { ChartCard, DashboardGrid, GridItem, KpiCard, KpiRow, type ChartPoint } from "@/components/app/dashboard";
import { ImprovableKpi } from "@/components/app/ai/ImproveWithAI";
import { StatusBadge } from "@/components/app/display";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { CollapseBody, CollapseButton, Collapsible, WhenCollapsed, WhenExpanded } from "@/components/app/collapsible/Collapsible";
import { AIBadge, Confidence } from "@/components/app/ai";
import { homeData, maintenanceProposals } from "@/extensions/maintenance/queries";
import { OPEN_FILTER } from "@/extensions/maintenance/store";
import { MxApprovals, MxAsk } from "@/extensions/maintenance/ui/home";

export const metadata = { title: "Maintenance · Propniti" };

// Maintenance home: the supervisor's AI briefing, triage queue and approvals first, then live SLA
// KPIs and charts that each open the work orders behind them.

const OPEN = encodeURIComponent(OPEN_FILTER);
// Priority is ordered, so it reads as one hue from dark (Emergency) to light (Low), built from the
// kit's chart-4 so it follows the theme. Validated in light and dark (ordinal checks, dataviz skill).
const PRIORITY_SERIES = [
  { key: "Emergency", label: "Emergency", color: "color-mix(in oklch, var(--chart-4) 55%, var(--foreground))" },
  { key: "Urgent", label: "Urgent", color: "color-mix(in oklch, var(--chart-4) 78%, var(--foreground))" },
  { key: "Normal", label: "Normal", color: "var(--chart-4)" },
  { key: "Low", label: "Low", color: "color-mix(in oklch, var(--chart-4) 72%, var(--card))" },
];
const ageText = (iso: string) => formatRelative(iso).replace(/^in /, "");

async function safe<T>(p: Promise<T>): Promise<{ v: T | null; error: boolean }> {
  try {
    return { v: await p, error: false };
  } catch (e) {
    console.error("maintenance home", e);
    return { v: null, error: true };
  }
}

export default async function MaintenanceHome() {
  const session = await currentSession();
  const { actor, persona, ws } = session;
  if (!can(actor.role, "read", "work_orders")) {
    return <main className="p-6"><EmptyState title="Maintenance isn't part of your role" description="Switch role from your avatar menu to see this page as someone who works with it." action={{ label: "Go to your home", href: "/app" }} /></main>;
  }
  const db = getPlatform().db;
  const q = { db, ws, actor };
  const m = (key: string) => safe(metrics(q, key));
  const [home, props, sla, open, ageP, trade, spend, techs] = await Promise.all([
    safe(homeData(db, ws, actor)), safe(maintenanceProposals(db, ws, actor, 7)),
    m("maintenance.sla"), m("maintenance.wo_open"), m("maintenance.by_age_priority"), m("maintenance.sla_by_trade"),
    m("maintenance.vendor_spend"), m("maintenance.tech_workload"),
  ]);
  const h = home.v;
  const c = h?.counts ?? {};
  const proposals = (props.v ?? []).map((r: Row) => proposalOut(r) as unknown as ProposalJson);
  const isSup = persona.role === "maintenance_supervisor";
  const failed = [home, sla, ageP, trade, spend, techs].some((x) => x.error);
  const invoiceTotal = (h?.invoices ?? []).reduce((a, r) => a + Number(r.invoice_cents ?? 0), 0);

  const watch: { text: string; href: string; tone: string }[] = [];
  if (Number(c.emergencies)) watch.push({ text: `${c.emergencies} emergency work order${c.emergencies > 1 ? "s" : ""} open`, href: `/app/maintenance/work-orders?f.priority=Emergency&f.status=${OPEN}`, tone: "bg-tone-danger" });
  if (Number(c.past_sla)) watch.push({ text: `${c.past_sla} past SLA, ${c.due_today} more due today`, href: "/app/maintenance/work-orders?view=past-sla", tone: "bg-tone-danger" });
  if (h?.turns.late) watch.push({ text: `${h.turns.late} make-readies past their target date`, href: "/app/maintenance/turnovers?view=late", tone: "bg-tone-warning" });
  if (h?.pm.overdue) watch.push({ text: `${h.pm.overdue} preventive tasks overdue`, href: "/app/maintenance/preventive?view=due-7", tone: "bg-tone-warning" });
  if (h?.cois.length) watch.push({ text: `${h.cois.length} vendor insurance certificate${h.cois.length > 1 ? "s" : ""} expired or expiring within 30 days`, href: "/app/maintenance/vendors?view=coi-expiring", tone: "bg-tone-warning" });

  return (
    <main>
      <PageHeader
        title={isSup ? personaGreeting(persona) : "Maintenance"}
        meta={<><span>{persona.title}</span><span>·</span><span>{persona.scope.label}</span><span>·</span><span>As of {formatDate("2026-11-04", "always")}</span></>}
        actions={<>
          <Button asChild size="sm" variant="outline"><Link href="/app/maintenance/board"><KanbanSquare />Board</Link></Button>
          <Button asChild size="sm" variant="outline"><Link href="/app/maintenance/my-jobs"><Smartphone />Technician view</Link></Button>
          {can(actor.role, "create", "work_orders") && <Button asChild size="sm"><Link href="/app/maintenance/intake"><ClipboardPlus />New request</Link></Button>}
        </>}
      />
      <PageBody>
        {failed && <ErrorBanner title="Some figures didn't load" message="The rest of the page is current. Reload to try again." />}

        <div className="grid gap-3 xl:grid-cols-12">
          <Collapsible id="briefing" label="Briefing" data-tour="mx-briefing" className="peer/brief flex flex-col rounded-xl border bg-card xl:col-span-8 xl:data-collapsed:col-span-full">
            <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3 group-data-collapsed/collapse:flex-nowrap group-data-collapsed/collapse:border-b-0">
              <span className="flex size-6 items-center justify-center rounded-md bg-tone-ai/10 text-tone-ai"><Sparkles className="size-3.5" /></span>
              <h2 className="shrink-0 text-[13.5px] font-semibold">Briefing</h2>
              <WhenExpanded><span className="text-[12px] text-muted-foreground">Work orders, invoices, make-ready and vendors in your scope</span></WhenExpanded>
              <WhenCollapsed><span className="min-w-0 truncate text-[12px] text-muted-foreground tabular-nums">{`${Number(c.untriaged ?? 0).toLocaleString("en-US")} need you · ${watch.length} to watch`}</span></WhenCollapsed>
              <Link href="/app/ai/runs?agent=maintenance_triage" className="ml-auto shrink-0 text-[12px] text-muted-foreground hover:text-foreground max-sm:group-data-collapsed/collapse:hidden">Agent runs <ChevronRight className="inline size-3" /></Link>
              <CollapseButton className="-mr-1.5 max-sm:group-data-collapsed/collapse:ml-auto" />
            </header>
            <CollapseBody className="flex-1">
            <div className="flex h-full flex-col">
            <div className="grid flex-1 md:grid-cols-3 md:divide-x">
              <div className="flex flex-col gap-2 px-4 py-3">
                <h3 className="text-[11.5px] font-medium text-muted-foreground">What happened</h3>
                <p className="text-[13px] leading-relaxed"><b className="font-semibold tabular-nums">{Number(c.open ?? 0)}</b> work orders open. <b className={cn("font-semibold tabular-nums", sla.v?.value != null && sla.v.value < 0.9 && "text-tone-danger")}>{formatPct(sla.v?.value ?? null, 1)}</b> of jobs due this month met their SLA{sla.v?.previous != null ? `, against ${formatPct(sla.v.previous, 1)} last month` : ""}.</p>
                <p className="text-[12.5px] text-muted-foreground"><Bot className="mr-1 inline size-3.5" />{h?.overnight.runs ? `${h.overnight.runs} triage and compliance runs in the last day, ${h.overnight.proposals} proposals.` : "No agent runs in the last day in this workspace yet."}</p>
              </div>
              <div className="flex flex-col gap-2 px-4 py-3">
                <h3 className="text-[11.5px] font-medium text-muted-foreground">Needs you</h3>
                <Link href="#triage" className="group flex items-baseline gap-2">
                  <span className="text-[28px] leading-8 font-semibold tracking-tight tabular-nums">{Number(c.untriaged ?? 0)}</span>
                  <span className="text-[12.5px] text-muted-foreground group-hover:text-foreground">new requests to dispatch <ArrowRight className="inline size-3" /></span>
                </Link>
                <Link href="/app/maintenance/work-orders?view=awaiting-approval" className="text-[12.5px] text-muted-foreground hover:text-foreground">{h?.invoices.length ?? 0} vendor invoices to approve ({formatMoney(invoiceTotal / 100, "whole")}) · {proposals.length} agent proposals</Link>
              </div>
              <div className="flex flex-col gap-2 px-4 py-3">
                <h3 className="text-[11.5px] font-medium text-muted-foreground">Watch</h3>
                {watch.length ? (
                  <ul className="flex flex-col gap-1.5">{watch.slice(0, 5).map((w) => <li key={w.text}><Link href={w.href} className="flex gap-2 text-[12.5px] leading-snug hover:text-primary"><span className={cn("mt-[6px] size-1.5 shrink-0 rounded-full", w.tone)} />{w.text}</Link></li>)}</ul>
                ) : <p className="text-[12.5px] text-muted-foreground">Nothing outside normal ranges.</p>}
              </div>
            </div>
            <footer className="flex items-center gap-2 border-t px-4 py-2 text-[11.5px] text-muted-foreground"><AIBadge source="rules" size="xs" />Counts are computed live from work orders, turnovers, schedules and certificates. Suggestions come from logged agent runs.</footer>
            </div>
            </CollapseBody>
          </Collapsible>
          <div className="flex flex-col gap-3 xl:col-span-4 xl:peer-data-collapsed/brief:col-span-full">
            <MxAsk suggestions={persona.role === "maintenance_supervisor" ? persona.assistantPrompts : ["Which work orders will breach SLA today?", "Which vendors have expiring insurance?", "How many units are not rent-ready?"]} />
            <div className="flex flex-wrap gap-1.5">
              <Button asChild size="sm" variant="outline"><Link href={`/app/maintenance/work-orders?f.status=New`}>Unassigned work orders</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href="/app/maintenance/turnovers?view=open">Make-ready board</Link></Button>
              <Button asChild size="sm" variant="outline"><Link href="/app/maintenance/preventive?view=due-7">Preventive due this week</Link></Button>
              <Button asChild size="sm" variant="ghost"><Link href="/app/maintenance/board?view=calendar"><CalendarRange />Calendar</Link></Button>
            </div>
          </div>
        </div>

        <KpiRow className="xl:grid-cols-6">
          <ImprovableKpi metric="maintenance.sla" red={Number(c.past_sla ?? 0) > 0 || undefined} label="SLA met" format="pct" value={sla.v?.value ?? null} previous={sla.v?.previous ?? null} spark={sla.v?.spark} goodWhen="up" href="/app/maintenance/work-orders?view=past-sla" footnote={`${Number(c.past_sla ?? 0)} open past due now`} help="Work orders completed by their SLA due time, over work orders due this month. Open jobs past due count as missed. Emergency 4 h, urgent 24 h, normal 72 h." />
          <KpiCard label="Open work orders" format="count" value={Number(c.open ?? 0)} spark={open.v?.spark} goodWhen="down" href="/app/maintenance/work-orders?view=open" footnote={`${Number(c.on_hold ?? 0)} on hold`} />
          <KpiCard label="Waiting to dispatch" format="count" value={Number(c.untriaged ?? 0)} goodWhen="down" href="/app/maintenance/work-orders?f.status=New,Triaged" footnote="New and triaged" />
          <KpiCard label="Invoices to approve" format="money" value={invoiceTotal / 100} goodWhen="down" href="/app/maintenance/work-orders?view=awaiting-approval" footnote={`${h?.invoices.length ?? 0} submitted`} />
          <KpiCard label="Units not rent-ready" format="count" value={h?.turns.open ?? null} goodWhen="down" href="/app/maintenance/turnovers?view=open" footnote={`${h?.turns.late ?? 0} past target`} />
          <KpiCard label="Preventive due this week" format="count" value={h?.pm.due ?? null} goodWhen="down" href="/app/maintenance/preventive?view=due-7" footnote={`${h?.pm.overdue ?? 0} overdue`} />
        </KpiRow>

        <div className="grid gap-5 xl:grid-cols-12">
          <Section id="triage" title="Triage queue" description="New requests, emergencies first. The Maintenance Triage agent's suggestion is ready on most; open one to review and dispatch." className="xl:col-span-7"
            actions={<Button asChild size="sm" variant="ghost"><Link href="/app/maintenance/work-orders?f.status=New,Triaged">All {Number(c.untriaged ?? 0)} <ArrowRight /></Link></Button>}>
            <div data-tour="mx-triage" className="overflow-hidden rounded-lg border bg-card">
              {h?.triage.length ? (
                <ul className="divide-y">
                  {h.triage.map((w) => (
                    <li key={String(w.id)}>
                      <Link href={`/app/maintenance/intake/${encodeURIComponent(String(w.id))}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                        {w.photo
                          // eslint-disable-next-line @next/next/no-img-element -- 400px static thumb
                          ? <img src={String(w.photo).replace(/\.webp$/, "-400.webp")} alt="" className="size-10 shrink-0 rounded-md object-cover ring-1 ring-border" loading="lazy" />
                          : <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] text-muted-foreground">No photo</span>}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2"><span className="truncate text-[13px] font-medium">{String(w.title)}</span><StatusBadge value={w.priority} tone={w.priority === "Emergency" ? "danger" : w.priority === "Urgent" ? "warning" : "neutral"} /></span>
                          <span className="block truncate text-[12px] text-muted-foreground">{String(w.id)} · {String(w.property)}{w.unit ? ` · ${w.unit}` : ""} · opened {ageText(String(w.opened_at))}</span>
                          {w.suggestion ? <span className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] text-tone-ai"><Sparkles className="size-3 shrink-0" /><span className="truncate">{String(w.suggestion).replace(/^[\w-]+: /, "")}</span>{w.confidence != null && <Confidence value={Number(w.confidence)} />}</span>
                            : <span className="mt-0.5 block text-[12px] text-muted-foreground">Not triaged yet</span>}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState compact kind="inbox" title="Every request is dispatched" description="New requests from residents, inspections and staff land here first." action={{ label: "Log a request", href: "/app/maintenance/intake" }} />}
            </div>
          </Section>
          <Section title="Approvals" description="Agent proposals in maintenance that wait for a person." className="xl:col-span-5">
            <div data-tour="mx-approvals"><MxApprovals rows={proposals} more={0} /></div>
          </Section>
        </div>

        <DashboardGrid>
          <GridItem span={6}><ChartCard title="Open work orders by age and priority" description="Click a bar to open those work orders" kind="stacked" data={(ageP.v?.points ?? []) as ChartPoint[]} x="bucket"
            series={PRIORITY_SERIES}
            drill={`/app/maintenance/work-orders?f.status=${OPEN}&f.age_days.min={min}&f.age_days.max={max}&sort=-age_days`} /></GridItem>
          <GridItem span={6}><ChartCard title="SLA by trade" description="Open work orders inside and past their SLA" kind="stacked" data={(trade.v?.points ?? []) as ChartPoint[]} x="category"
            series={[{ key: "on_time", label: "Within SLA", color: "var(--chart-1)" }, { key: "breached", label: "Past SLA", color: "var(--chart-4)" }]} drill={`/app/maintenance/work-orders?f.category={category}&f.status=${OPEN}&sort=sla_due_at`} /></GridItem>
          {can(actor.role, "read", "bills") || actor.role === "maintenance_supervisor" ? (
            <GridItem span={6}><ChartCard title="Vendor spend" description="Maintenance vendors, bills in the last 12 months, top 10" kind="hbar" data={(spend.v?.points ?? []) as ChartPoint[]} x="vendor"
              series={[{ key: "spend", label: "Spend", format: "money" }]} drill="/app/maintenance/vendors/{vendor_id}?tab=bills" height={300} /></GridItem>
          ) : null}
          <GridItem span={6}><ChartCard title="Technician workload" description="Open in-house jobs per technician" kind="hbar" data={(techs.v?.points ?? []) as ChartPoint[]} x="name"
            series={[{ key: "open", label: "Open jobs", color: "var(--chart-1)" }, { key: "past_sla", label: "Past SLA", color: "var(--chart-4)" }]} drill={`/app/maintenance/my-jobs?tech={staff_id}`} height={300} /></GridItem>
          <GridItem span={12}><ChartCard title="Work orders opened and past SLA, trailing 12 months" kind="bar" data={(open.v?.points ?? []) as ChartPoint[]} x="month"
            series={[{ key: "opened", label: "Opened" }, { key: "open", label: "Open at month end" }, { key: "breached", label: "Past SLA" }]} drill={`/app/maintenance/work-orders?view=open`} height={240} /></GridItem>
        </DashboardGrid>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Invoices to approve" description="Submitted vendor work, checked against its purchase order." actions={<Button asChild size="sm" variant="ghost"><Link href="/app/maintenance/work-orders?view=awaiting-approval">All <ArrowRight /></Link></Button>}>
            <div className="overflow-hidden rounded-lg border bg-card">
              {h?.invoices.length ? (
                <table className="w-full text-[13px]">
                  <tbody>{h.invoices.map((r) => {
                    const over = r.po_cents != null && Number(r.invoice_cents) > Number(r.po_cents) * 1.02;
                    return (
                      <tr key={String(r.id)} className="border-b last:border-0 hover:bg-muted/40">
                        <td className="max-w-0 px-3 py-2"><Link href={`/app/maintenance/work-orders/${r.id}?tab=wo_invoice`} className="block truncate font-medium hover:text-primary">{String(r.title)}</Link><span className="block truncate text-[12px] text-muted-foreground">{String(r.id)} · {String(r.vendor ?? "")} · {String(r.property)}</span></td>
                        <td className="w-28 px-3 py-2 text-right tabular-nums">{formatMoney(Number(r.invoice_cents ?? 0) / 100)}</td>
                        <td className="w-32 px-3 py-2 text-right">{r.po_cents == null ? <StatusBadge value="No PO" tone="neutral" /> : over ? <StatusBadge value="Over PO" tone="warning" /> : <StatusBadge value="Matches PO" tone="success" />}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              ) : <EmptyState compact kind="inbox" title="No invoices waiting" description="Vendor invoices land here once the work is submitted." />}
            </div>
          </Section>
          <Section title="Vendor insurance" description="Vendors who worked at your properties this year, with certificates expired or expiring in 30 days. The triage agent won't suggest them.">
            <div className="overflow-hidden rounded-lg border bg-card">
              {h?.cois.length ? (
                <ul className="divide-y">{h.cois.map((x) => (
                  <li key={String(x.vendor_id)}><Link href={`/app/maintenance/vendors/${x.vendor_id}?tab=cois`} className="flex items-center gap-2 px-3 py-2 text-[13px] hover:bg-muted/40">
                    {x.status === "Expired" ? <ShieldAlert className="size-4 text-tone-danger" /> : <AlertTriangle className="size-4 text-tone-warning" />}
                    <span className="flex-1 truncate font-medium">{String(x.company)}</span>
                    <span className="text-[12px] text-muted-foreground">{x.status === "Expired" ? "Expired" : "Expires"} {formatDate(String(x.expires_on))}</span>
                  </Link></li>
                ))}</ul>
              ) : <EmptyState compact kind="table" title="All certificates are current" />}
            </div>
          </Section>
        </div>
      </PageBody>
    </main>
  );
}
