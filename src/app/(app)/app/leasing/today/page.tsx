import Link from "@/components/Link";
import { ArrowRight, ArrowUpRight, CalendarDays, Cpu, KanbanSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { CollapseBody, CollapseButton, Collapsible, WhenCollapsed, WhenExpanded } from "@/components/app/collapsible/Collapsible";
import { KpiTile, type KpiData } from "@/components/entity/Metrics";
import { AGENT_NAME, followUps, kpis, localTime, sourceOf, leasingCtx, leasingProposals, overnight, todaysTours } from "@/extensions/leasing/data";
import { AskPanel, FollowUpList, ProposalQueue, TourList, type ProposalView } from "@/extensions/leasing/ui/HomeBits";
import { AS_OF } from "@/seed/constants";

export const metadata = { title: "My leasing day · Propniti" };

const KPIS: Omit<KpiData, "value" | "previous" | "spark">[] = [
  { key: "leasing.leads_30d", label: "Leads, 30 days", format: "count", goodWhen: "up", drill: "/app/leasing/prospects?view=open" },
  { key: "leasing.tour_conversion", label: "Lead to tour", format: "pct", goodWhen: "up", drill: "/app/leasing/showings" },
  { key: "leasing.avg_dom", label: "Days on market", format: "days", goodWhen: "down", drill: "/app/leasing/listings?view=stale" },
  { key: "leasing.vacancy_loss_live", label: "Vacancy loss MTD", format: "money", goodWhen: "down", drill: "/app/leasing/listings?f.status=Active" },
];

const card = "rounded-lg border bg-card";
const greeting = () => {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Chicago" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

// The leasing agent's AI-first home: a briefing of what came in and what needs her, the agents'
// proposals for her to approve, today's tours, follow-ups, and the numbers she is measured on.
export default async function LeasingToday() {
  const c = await leasingCtx();
  const [tours, follow, proposals, night, k] = await Promise.all([
    todaysTours(c, c.actor.role === "leasing_agent" ? c.actor.personaId : undefined),
    followUps(c, 8),
    leasingProposals(c, { limit: 20 }),
    overnight(c),
    kpis(c, KPIS.map((x) => x.key)),
  ]);
  const first = c.persona.name.split(" ")[0];
  const scheduled = tours.filter((t) => t.status === "Scheduled").length;
  // Only what this person can act on; the broker's application decisions wait on the broker desk.
  const items: ProposalView[] = proposals.filter((p) => p.canApprove).slice(0, 6).map((p) => ({
    id: String(p.id), agent: AGENT_NAME[String(p.agent)] ?? String(p.agent), title: String(p.title), why: p.why, evidence: p.evidence, risk: p.risk as ProposalView["risk"], confidence: Number(p.confidence),
    runId: (p.run_id as string) ?? null, recordHref: p.href, createdAt: String(p.created_at), source: sourceOf(p), model: (p.model as string) ?? undefined,
    canApprove: p.canApprove,
  }));
  const needs = [
    scheduled && { n: scheduled, text: `tour${scheduled === 1 ? "" : "s"} still to run today`, href: "#tours" },
    follow.total && { n: follow.total, text: `lead${follow.total === 1 ? "" : "s"} waiting on a reply`, href: "/app/leasing/prospects?view=follow-up" },
    items.length && { n: items.length, text: `agent proposal${items.length === 1 ? "" : "s"} waiting for you`, href: "#proposals" },
  ].filter(Boolean) as { n: number; text: string; href: string }[];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${first}`}
        description={`${new Date(`${AS_OF}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })} · ${c.actor.scope.label}`}
        actions={
          <>
            <Button asChild size="sm" variant="outline"><Link href="/app/leasing/prospects?new=1">Add prospect</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href="/app/units?f.status=Vacant">Available units</Link></Button>
            <Button asChild size="sm"><Link href="/app/leasing/pipeline"><KanbanSquare data-icon="inline-start" />Pipeline board</Link></Button>
          </>
        }
      />
      <PageBody>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Collapsible id="briefing" label="Briefing" className={`${card} relative overflow-hidden`} aria-labelledby="brief-h">
            <div className="flex items-center gap-2 border-b px-4 py-2.5 group-data-collapsed/collapse:border-b-0">
              <Sparkles className="size-3.5 text-tone-ai" />
              <h2 id="brief-h" className="shrink-0 text-[13px] font-semibold">Briefing</h2>
              <WhenExpanded><span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground"><Cpu className="size-3" />Computed from your records</span></WhenExpanded>
              <WhenCollapsed><span className="min-w-0 truncate text-[12px] text-muted-foreground tabular-nums">{`${needs.reduce((a, x) => a + x.n, 0).toLocaleString("en-US")} need you · ${night.leads} new ${night.leads === 1 ? "lead" : "leads"}`}</span></WhenCollapsed>
              <CollapseButton className="-mr-1.5 ml-auto" />
            </div>
            <CollapseBody>
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <div>
                <h3 className="mb-1.5 text-[12px] font-medium text-muted-foreground">Since yesterday</h3>
                <ul className="flex flex-col gap-1.5 text-[13px]">
                  <li><span className="font-semibold tabular-nums">{night.leads}</span> new lead{night.leads === 1 ? "" : "s"}, <span className="font-semibold tabular-nums">{night.tours}</span> tour{night.tours === 1 ? "" : "s"} completed, <span className="font-semibold tabular-nums">{night.applications}</span> application{night.applications === 1 ? "" : "s"} submitted</li>
                  {night.runs.map((r) => (
                    <li key={String(r.id)} className="flex items-start gap-1.5 text-muted-foreground">
                      <Sparkles className="mt-0.5 size-3 shrink-0 text-tone-ai" />
                      <span className="min-w-0"><span className="text-foreground">{AGENT_NAME[String(r.agent_key)] ?? String(r.agent_key)}:</span> <span className="line-clamp-2 inline">{String(r.summary ?? r.status).split("\n")[0]}</span> <Link href={`/app/ai/runs/${r.id}`} aria-label={`View the ${AGENT_NAME[String(r.agent_key)] ?? "agent"} run`} className="inline-flex items-center text-primary hover:underline">run<ArrowUpRight className="size-3" /></Link></span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-1.5 text-[12px] font-medium text-muted-foreground">Needs you</h3>
                {needs.length ? (
                  <ul className="flex flex-col gap-1.5 text-[13px]">
                    {needs.map((x) => <li key={x.text}><Link href={x.href} className="group inline-flex items-center gap-1 hover:text-primary"><span className="font-semibold tabular-nums">{x.n}</span> {x.text}<ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" /></Link></li>)}
                  </ul>
                ) : <p className="text-[13px] text-muted-foreground">You’re clear. New leads and tours will show up here.</p>}
              </div>
            </div>
            <div className="border-t px-4 py-3">
              <AskPanel suggestions={c.persona.assistantPrompts} placeholder="Ask about your leads, tours, units or listings…" />
            </div>
            </CollapseBody>
          </Collapsible>

          <div className="grid grid-cols-2 gap-3 self-start">{KPIS.map((d, i) => <KpiTile key={d.key} k={{ ...d, value: k[i].value, previous: k[i].previous, spark: k[i].spark, asOf: k[i].asOf }} />)}</div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Section title={<span id="tours" className="flex scroll-mt-16 items-center gap-1.5"><CalendarDays className="size-4 text-muted-foreground" />Today’s tours</span>} description={`${tours.length} booked · ${scheduled} still to run`} actions={<Button asChild size="sm" variant="ghost"><Link href="/app/leasing/showings?view=upcoming">Upcoming</Link></Button>}>
            <div className={card} data-tour="leasing-tours">
              <TourList canAct tours={tours.map((t) => ({ id: String(t.id), at: String(t.scheduled_at), time: localTime(t.scheduled_at, t.metro) ?? "—", status: String(t.status), kind: String(t.kind), prospect: String(t.prospect), prospectId: String(t.prospect_id), unit: (t.unit as string) ?? null, property: String(t.property), beds: t.desired_beds == null ? null : Number(t.desired_beds), budget: t.budget_cents == null ? null : Number(t.budget_cents) / 100, agent: (t.agent as string) ?? null, feedback: String(t.feedback ?? "") }))} />
            </div>
          </Section>
          <Section title="Follow-ups due" description={`${follow.total} lead${follow.total === 1 ? "" : "s"} with no contact in 3 to 30 days`} actions={<Button asChild size="sm" variant="ghost"><Link href="/app/leasing/prospects?view=follow-up">All {follow.total}</Link></Button>}>
            <div className={card} data-tour="leasing-followups">
              <FollowUpList rows={follow.rows.map((r) => ({ id: String(r.id), name: String(r.name), stage: String(r.stage), property: String(r.property), days: Number(r.days), beds: r.desired_beds == null ? null : Number(r.desired_beds), budget: r.budget_cents == null ? null : Number(r.budget_cents) / 100, source: String(r.source ?? "") }))} />
            </div>
          </Section>
        </div>

        <Section title={<span id="proposals" className="scroll-mt-16">Waiting on you from the agents</span>} description="Follow-ups and renewal offers the Leasing and Renewals agents prepared. Approving sends exactly what's shown; every one links to its run." actions={<Button asChild size="sm" variant="ghost"><Link href="/app/ai/approvals">All approvals</Link></Button>}>
          <ProposalQueue items={items} empty="When the Leasing or Renewals agent drafts a follow-up or an offer for you, it waits here with its reasons." />
        </Section>
      </PageBody>
    </>
  );
}
