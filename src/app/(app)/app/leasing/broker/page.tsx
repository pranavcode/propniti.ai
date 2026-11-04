import Link from "@/components/Link";
import { AlertTriangle, ArrowUpRight, Cpu, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { CollapseBody, CollapseButton, Collapsible, WhenCollapsed, WhenExpanded } from "@/components/app/collapsible/Collapsible";
import { EmptyState } from "@/components/app/states";
import { KpiTile, type KpiData } from "@/components/entity/Metrics";
import { AGENT_NAME, fairHousingFlags, kpis, leasingAgents, leasingCtx, leasingProposals, sourceOf, staleLeadsByAgent, waitingApplications } from "@/extensions/leasing/data";
import { ReassignLeads, SendFollowUps } from "@/extensions/leasing/ui/BulkLeads";
import { AskPanel, ProposalQueue, type ProposalView } from "@/extensions/leasing/ui/HomeBits";
import { formatMoney, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollX } from "@/components/app/ScrollX";

export const metadata = { title: "Broker desk · Propniti" };

const KPIS: Omit<KpiData, "value" | "previous" | "spark">[] = [
  { key: "leasing.pending_decisions", label: "Awaiting your decision", format: "count", goodWhen: "down", drill: "/app/leasing/applications?view=decide" },
  { key: "leasing.approval_rate", label: "Approval rate, 90 days", format: "pct", drill: "/app/leasing/applications?f.stage=Approved,Conditional,Leased" },
  { key: "leasing.leads_30d", label: "Leads, 30 days", format: "count", goodWhen: "up", drill: "/app/leasing/prospects?view=open" },
  { key: "leasing.follow_ups", label: "Leads going stale", format: "count", goodWhen: "down", drill: "/app/leasing/prospects?view=follow-up" },
];
const REC: Record<string, string> = { Approve: "text-tone-success", Conditional: "text-tone-warning", Deny: "text-tone-danger" };

// The broker's AI-first home: applications waiting on a decision with the Leasing Agent's score,
// what the agents proposed, how each leasing agent is doing, and fair-housing flags to clear.
export default async function BrokerDesk() {
  const c = await leasingCtx();
  const [apps, proposals, flags, k, perf, stale, team] = await Promise.all([
    waitingApplications(c, 12),
    leasingProposals(c, { actions: ["applications.decide"], limit: 6 }),
    fairHousingFlags(c),
    kpis(c, KPIS.map((x) => x.key)),
    kpis(c, ["leasing.agent_performance"]),
    staleLeadsByAgent(c),
    leasingAgents(c),
  ]);
  const agents = perf[0].points as { agent_id: string; agent: string | null; leads: number; tours: number; applied: number; leased: number; stale: number; conversion: number; first_reply_h: number | null }[];
  const items: ProposalView[] = proposals.map((p) => ({
    id: String(p.id), agent: AGENT_NAME[String(p.agent)] ?? String(p.agent), title: String(p.title), why: p.why, evidence: p.evidence, risk: p.risk as ProposalView["risk"], confidence: Number(p.confidence),
    runId: (p.run_id as string) ?? null, recordHref: p.href, createdAt: String(p.created_at), source: sourceOf(p), model: (p.model as string) ?? undefined, canApprove: p.canApprove,
  }));
  const unscored = apps.rows.filter((a) => a.score == null).length;
  const oldest = apps.rows[0];

  return (
    <>
      <PageHeader
        title={`Broker desk · ${c.persona.name.split(" ")[0]}`}
        description={`Applications to decide, agent recommendations, team performance and fair-housing checks · ${c.actor.scope.label}`}
        actions={c.persona.quickActions.map((q) => <Button key={q.href} asChild size="sm" variant="outline"><Link href={q.href}>{q.label}</Link></Button>)}
      />
      <PageBody>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Collapsible id="briefing" label="Briefing" className="peer/brief xl:data-collapsed:col-span-full relative overflow-hidden rounded-lg border bg-card" aria-labelledby="brief-h">
            <div className="flex items-center gap-2 border-b px-4 py-2.5 group-data-collapsed/collapse:border-b-0">
              <Sparkles className="size-3.5 text-tone-ai" />
              <h2 id="brief-h" className="shrink-0 text-[13px] font-semibold">Briefing</h2>
              <WhenExpanded><span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-px text-[11px] text-muted-foreground"><Cpu className="size-3" />Computed from your records</span></WhenExpanded>
              <WhenCollapsed><span className="min-w-0 truncate text-[12px] text-muted-foreground tabular-nums">{`${apps.total.toLocaleString("en-US")} need you · ${flags.length} to fix`}</span></WhenCollapsed>
              <CollapseButton className="-mr-1.5 ml-auto" />
            </div>
            <CollapseBody>
            <ul className="flex flex-col gap-1.5 p-4 text-[13px]">
              <li><Link href="#approvals" className="hover:text-primary"><span className="font-semibold tabular-nums">{apps.total}</span> application{apps.total === 1 ? "" : "s"} waiting on you{oldest ? <>, the oldest for <span className="font-semibold tabular-nums">{Number(oldest.waiting)}</span> days ({String(oldest.applicant)})</> : null}.</Link></li>
              {unscored > 0 && <li className="text-muted-foreground"><span className="font-semibold text-foreground tabular-nums">{unscored}</span> of the ones shown have no AI score yet; open one and choose “Score with AI”.</li>}
              <li><Link href="#compliance" className={cn("hover:text-primary", flags.length && "text-tone-danger")}><span className="font-semibold tabular-nums">{flags.length}</span> listing{flags.length === 1 ? "" : "s"} with fair-housing wording to fix.</Link></li>
              {agents.filter((a) => a.stale > 0).sort((a, b) => b.stale - a.stale).slice(0, 1).map((a) => (
                <li key={a.agent_id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                  <span>{a.agent ?? "Unassigned"} has the most leads going stale ({a.stale}).</span>
                  <SendFollowUps ids={(stale[String(a.agent_id)] ?? []).map((l) => l.id)} label="Send follow-ups" who={`${a.agent ?? "the unassigned"}'s stale leads`} />
                  <ReassignLeads leads={stale[String(a.agent_id)] ?? []} from={String(a.agent_id)} fromName={a.agent ?? "Unassigned"} agents={team} />
                </li>
              ))}
            </ul>
            <div className="border-t px-4 py-3">
              <AskPanel suggestions={c.persona.assistantPrompts} placeholder="Ask about applications, agents or listings…" />
            </div>
            </CollapseBody>
          </Collapsible>
          <div className="grid grid-cols-2 gap-3 self-start xl:peer-data-collapsed/brief:col-span-full xl:peer-data-collapsed/brief:grid-cols-4">{KPIS.map((d, i) => <KpiTile key={d.key} k={{ ...d, value: k[i].value, previous: k[i].previous, spark: k[i].spark, asOf: k[i].asOf }} />)}</div>
        </div>

        <Section title={<span id="approvals" className="scroll-mt-16">Applications waiting on you</span>} description="Oldest first. The score and recommendation come from the Leasing Agent and use financial and rental-history facts only." actions={<Button asChild size="sm" variant="ghost"><Link href="/app/leasing/applications?view=decide">All {apps.total}</Link></Button>}>
          <ScrollX className="rounded-lg border bg-card" data-tour="broker-approvals">
            {apps.rows.length ? (
              <table className="w-full text-[13px]">
                <TableHeader className="bg-muted/40 text-left text-[12px] text-muted-foreground">
                  <TableRow><TableHead className="px-3 py-2 font-medium">Applicant</TableHead><TableHead className="px-3 py-2 font-medium max-sm:hidden">Home</TableHead><TableHead className="px-3 py-2 text-right font-medium">Rent</TableHead><TableHead className="px-3 py-2 text-right font-medium">Income ÷ rent</TableHead><TableHead className="px-3 py-2 font-medium">Screening</TableHead><TableHead className="px-3 py-2 font-medium">AI recommends</TableHead><TableHead className="px-3 py-2 text-right font-medium">Waiting</TableHead><TableHead className="px-3 py-2"><span className="sr-only">Actions</span></TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {apps.rows.map((a) => (
                    <TableRow key={String(a.id)}>
                      <TableCell className="px-3 py-2"><Link href={`/app/leasing/applications/${a.id}`} className="font-medium hover:text-primary hover:underline">{String(a.applicant)}</Link><span className="block max-w-44 truncate text-[12px] text-muted-foreground sm:hidden">{String(a.property)}{a.unit ? ` #${a.unit}` : ""}</span></TableCell>
                      <TableCell className="max-w-56 truncate px-3 py-2 text-muted-foreground max-sm:hidden">{String(a.property)}{a.unit ? ` #${a.unit}` : ""}</TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">{formatMoney(Number(a.rent_cents) / 100, "whole")}</TableCell>
                      <TableCell className={cn("px-3 py-2 text-right tabular-nums", Number(a.income_to_rent) < 3 && "text-tone-warning")}>{a.income_to_rent == null ? "—" : `${Number(a.income_to_rent).toFixed(1)}×`}</TableCell>
                      <TableCell className="px-3 py-2">{String(a.screening ?? "Running")}</TableCell>
                      <TableCell className="px-3 py-2">
                        {a.score != null ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Sparkles className="size-3 text-tone-ai" />
                            {a.proposalId
                              ? <Link href={`/app/ai/approvals?proposal=${encodeURIComponent(a.proposalId)}`} className={cn("font-medium hover:underline", REC[String(a.recommendation)])} aria-label={`${String(a.recommendation)}: open the recommendation for ${String(a.applicant)} in approvals`}>{String(a.recommendation)}</Link>
                              : <span className={cn("font-medium", REC[String(a.recommendation)])}>{String(a.recommendation)}</span>}
                            <span className="text-muted-foreground tabular-nums">· {Number(a.score)}</span>
                            {a.runId && <Link href={`/app/ai/runs/${a.runId}`} className="text-[11.5px] text-primary hover:underline" aria-label={`View the scoring run for ${String(a.applicant)}`}>run<ArrowUpRight className="inline size-3" /></Link>}
                          </span>
                        ) : <span className="text-muted-foreground">Not scored</span>}
                      </TableCell>
                      <TableCell className={cn("px-3 py-2 text-right tabular-nums", Number(a.waiting) > 3 && "text-tone-warning")}>{Number(a.waiting)}d</TableCell>
                      <TableCell className="px-3 py-2 text-right"><Button asChild size="sm" variant="outline"><Link href={`/app/leasing/applications/${a.id}`}>Review</Link></Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            ) : <EmptyState compact kind="inbox" title="No applications waiting" description="Applications land here once screening is back." />}
          </ScrollX>
        </Section>

        <div className="grid gap-4 xl:grid-cols-2">
          <Section title={<span id="compliance" className="flex scroll-mt-16 items-center gap-1.5">{flags.length ? <AlertTriangle className="size-4 text-tone-danger" /> : <ShieldCheck className="size-4 text-tone-success" />}Fair-housing language</span>} description="Listings whose wording states a preference about who may live there. Publishing is blocked until they're fixed.">
            <div className="rounded-lg border bg-card" data-tour="broker-compliance">
              {flags.length ? (
                <ul className="divide-y">
                  {flags.slice(0, 8).map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <div className="min-w-[min(100%,16rem)] flex-1">
                        <Link href={`/app/leasing/listings/${f.id}`} className="block truncate font-medium hover:text-primary hover:underline">{f.property}{f.unit ? ` #${f.unit}` : ""} · {f.headline}</Link>
                        <p className="mt-1 text-[12.5px]">{f.flags.map((x) => <span key={x.phrase + x.index} className="mr-2 inline-block"><span className="rounded bg-tone-danger/10 px-1 text-tone-danger">“{x.phrase}”</span> <span className="text-muted-foreground">{x.category}</span></span>)}</p>
                      </div>
                      <Button asChild size="sm" variant="outline" className="shrink-0"><Link href={`/app/leasing/listings/${f.id}?rewrite=1`}><Sparkles className="text-tone-ai" data-icon="inline-start" />Rewrite with AI</Link></Button>
                      <Button asChild size="sm" variant="ghost" className="shrink-0"><Link href={`/app/leasing/listings/${f.id}`}>Fix wording</Link></Button>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState compact kind="inbox" title="No flags" description="Every live and draft listing passed the fair-housing language check." />}
            </div>
          </Section>

          <Section title="Leasing agent performance" description="Leads created in the last 30 days, by assigned agent.">
            <ScrollX className="rounded-lg border bg-card" data-tour="broker-agents">
              {agents.length === 0 ? <EmptyState compact kind="table" title="No leads in the last 30 days" description="Agent numbers appear once leads are assigned." /> : <table className="w-full text-[13px]">
                <TableHeader className="bg-muted/40 text-left text-[12px] text-muted-foreground">
                  <TableRow><TableHead className="px-3 py-2 font-medium">Agent</TableHead><TableHead className="px-3 py-2 text-right font-medium">Leads</TableHead><TableHead className="px-3 py-2 text-right font-medium">Toured</TableHead><TableHead className="px-3 py-2 text-right font-medium">Applied</TableHead><TableHead className="px-3 py-2 text-right font-medium">Leased</TableHead><TableHead className="px-3 py-2 text-right font-medium">Going stale</TableHead><TableHead className="px-3 py-2"><span className="sr-only">Actions</span></TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {agents.map((a) => (
                    <TableRow key={a.agent_id ?? "none"}>
                      <TableCell className="px-3 py-2"><Link href={`/app/leasing/prospects?f.assigned_to=${a.agent_id}`} className="font-medium hover:text-primary hover:underline">{a.agent ?? "Unassigned"}</Link></TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">{a.leads}</TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">{a.tours} <span className="text-[11.5px] text-muted-foreground">{formatPct(a.leads ? a.tours / a.leads : 0, 0)}</span></TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">{a.applied}</TableCell>
                      <TableCell className="px-3 py-2 text-right tabular-nums">{a.leased}</TableCell>
                      <TableCell className={cn("px-3 py-2 text-right tabular-nums", a.stale > 5 && "text-tone-warning")}><Link href={`/app/leasing/prospects?f.follow_up_due=true&f.assigned_to=${a.agent_id}`} className="hover:underline">{a.stale}</Link></TableCell>
                      <TableCell className="py-1.5 pr-2 pl-0 text-right whitespace-nowrap">{a.stale > 0 && <span className="inline-flex gap-1"><SendFollowUps ids={(stale[String(a.agent_id)] ?? []).map((l) => l.id)} label="Follow up" size="xs" who={`${a.agent ?? "the unassigned"}'s stale leads`} /><ReassignLeads size="xs" leads={stale[String(a.agent_id)] ?? []} from={String(a.agent_id)} fromName={a.agent ?? "Unassigned"} agents={team} /></span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>}
            </ScrollX>
          </Section>
        </div>

        <Section title="Leasing Agent recommendations" description="Approve to accept the agent's recommendation as your decision; it is logged with your name. Open the application to decide differently.">
          <ProposalQueue items={items} empty="When the Leasing Agent scores an application, its recommendation waits here for you." />
        </Section>
      </PageBody>
    </>
  );
}
