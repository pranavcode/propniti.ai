import Link from "next/link";
import { Workflow } from "lucide-react";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { Money, RelativeDate, StatusBadge } from "@/components/app/display";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { AUTONOMY_LEVELS, automationsView } from "@/ai/automations";
import { STALE_RUN_MS, SWEEP_RUN_BUDGET_MS, SWEEP_EVERY_MS, VISIT_GRACE_MS } from "@/ai/orchestrator";
import { pageData } from "@/ai/ui/server";
import { SETTLE_MS } from "@/lib/ledger";
import { RETURNED_PAYMENT_FEE_CENTS } from "@/server/money";
import { AutonomySelect } from "./AutonomySelect";

export const metadata = { title: "Automations · Propniti" };

const OPTIONS = Object.entries(AUTONOMY_LEVELS).map(([value, l]) => ({ value, label: l.label }));
const TH = "px-3 py-2 font-medium";
const TD = "px-3 py-2 align-top";
const link = "hover:text-primary hover:underline";
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;
const mins = (ms: number) => Math.round(ms / 60_000);

// What runs on its own, when, and under which rules: the agents with their schedules and event
// triggers, the 15-minute sweep, the approval rules every agent action passes, and the rules built
// into the product's actions. Agent detail lives on the Agents page and the runs list.
export default async function AutomationsPage() {
  const { data } = await pageData();
  const v = await automationsView(data);
  if (!v.can.view) {
    return (
      <main className="p-6">
        <EmptyState kind="table" title="Automations aren't part of your role" description="Ask an admin if you need to see which agents and rules run on their own." secondary={{ label: "Go to your home", href: "/app" }} />
      </main>
    );
  }
  const on = v.agents.filter((a) => a.enabled).length;
  const queued = v.events.reduce((s, e) => s + e.queued, 0);
  const { lateFeePct, nsfCents } = v.stateCaps;
  return (
    <main>
      <PageHeader
        icon={<Workflow />}
        title="Automations"
        description="What runs on its own, when, and under which rules. Agents propose; a person approves anything involving money, legal terms or safety unless an approval rule below allows it."
        meta={<>
          <span>{on} of {v.agents.length} agents on</span>
          <span>Sweep every {v.sweep.everyMin} min · next in {v.sweep.nextInMin} min</span>
          <span className={v.sweep.late ? "text-tone-warning" : undefined}>{v.sweep.lastAgoMin == null ? "No sweep yet" : `Last sweep ${v.sweep.lastAgoMin} min ago`}</span>
          <span>{queued} event{queued === 1 ? "" : "s"} waiting</span>
        </>}
        actions={<>
          <Button asChild variant="outline" size="sm"><Link href="/app/ai/activity">All runs</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href="/app/ai/approvals">Approvals</Link></Button>
          <Button asChild size="sm"><Link href="/app/agents">Agents</Link></Button>
        </>}
      />
      <PageBody>
        <Section title="Agents" description="Each agent runs on its schedule, when an event it listens for happens, or when someone presses Run now on the Agents page. Open an agent to see its runs.">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table aria-label="Agents" className="w-full min-w-[1080px] text-[13px]">
              <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                <tr className="whitespace-nowrap"><th className={TH}>Automation</th><th className={TH}>Trigger</th><th className={TH}>Scope</th><th className={TH}>Autonomy</th><th className={TH}>Last run</th><th className={TH}>Next due</th><th className={`${TH} text-right`}>Runs, 30 days</th><th className={TH}>Status</th></tr>
              </thead>
              <tbody>
                {v.agents.map((a) => (
                  <tr key={a.key} className="border-t">
                    <td className={`${TD} max-w-[13rem]`}>
                      <Link href={a.href} className={`font-medium text-foreground ${link}`}>{a.name}</Link>
                      <div className="truncate text-[12px] text-muted-foreground" title={a.goal}>{a.goal}</div>
                    </td>
                    <td className={`${TD} min-w-[11.5rem]`}>
                      {a.scheduleText ? <div title={`Cron: ${a.schedule}`}>{a.scheduleText}</div> : <div className="text-muted-foreground">No schedule</div>}
                      {a.events.length > 0 && <div className="mt-0.5 text-[12px] text-muted-foreground">On {a.events.map((e) => e.label.toLowerCase()).join(", ")}</div>}
                    </td>
                    <td className={`${TD} max-w-[10rem]`}><div className="truncate" title={a.scope}>{a.scope}</div><div className="text-[12px] text-muted-foreground">All properties</div></td>
                    <td className={TD}>
                      {v.can.editAutonomy
                        ? <AutonomySelect agent={a.key} name={a.name} value={a.autonomy.value} options={OPTIONS} />
                        : <StatusBadge value={a.autonomy.value} label={a.autonomy.label} tone={a.autonomy.value === "auto_within_policy" ? "ai" : "info"} />}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>
                      {a.lastRun ? <Link href={a.lastRun.href} className={link}><RelativeDate value={a.lastRun.started_at} /></Link> : <span className="text-muted-foreground">Never</span>}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}>{a.nextDueAt ? <RelativeDate value={a.nextDueAt} /> : <span className="text-muted-foreground">{!a.enabled ? "Off" : a.schedule ? "Over a week away" : "Events only"}</span>}</td>
                    <td className={`${TD} text-right whitespace-nowrap tabular-nums`}>
                      <Link href={a.href} className={link}>{a.runs30}</Link>
                      {a.failed30 > 0 && <> · <Link href={`${a.href}&status=failed`} className="text-tone-danger hover:underline">{a.failed30} failed</Link></>}
                    </td>
                    <td className={TD}><StatusBadge value={a.status.label} label={a.status.label} tone={a.status.tone} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">Next due is when the schedule fires on the demo clock. Each sweep starts one piece of work, so an agent that is due may start a sweep or two later. {AUTONOMY_LEVELS.act_with_approval.label}: {AUTONOMY_LEVELS.act_with_approval.help} {AUTONOMY_LEVELS.auto_within_policy.label}: {AUTONOMY_LEVELS.auto_within_policy.help}</p>
        </Section>

        <Section title="The 15-minute sweep" description="A Cloudflare Cron Trigger starts the sweep. It is what runs scheduled agents and hands queued events to the agents that listen for them.">
          <ul className="grid gap-2 rounded-lg border bg-card p-4 text-[13px] md:grid-cols-2">
            <li><span className="font-medium">Every {mins(SWEEP_EVERY_MS)} minutes.</span> <span className="text-muted-foreground">Next sweep in {v.sweep.nextInMin} min. {v.sweep.lastAgoMin == null ? "None has run yet." : `The last one ran ${v.sweep.lastAgoMin} min ago.`}</span></li>
            <li><span className="font-medium">One piece of work per sweep.</span> <span className="text-muted-foreground">Either the scheduled agent that has waited longest, or one agent&apos;s queued events. When both are waiting, sweeps alternate between them.</span></li>
            <li><span className="font-medium">A missed sweep is caught up.</span> <span className="text-muted-foreground">If no sweep has run for {mins(SWEEP_EVERY_MS + VISIT_GRACE_MS)} minutes, the next visit to an AI page starts one.</span></li>
            <li><span className="font-medium">Time limits.</span> <span className="text-muted-foreground">A scheduled run gets {SWEEP_RUN_BUDGET_MS / 1000} seconds and keeps what it finished. A run still marked running after {mins(STALE_RUN_MS)} minutes is marked failed.</span></li>
          </ul>
        </Section>

        <Section title="Event triggers" description="Which events start which agent. Events wait in a queue until the next sweep picks them up.">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table aria-label="Event triggers" className="w-full min-w-[760px] text-[13px]">
              <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                <tr className="whitespace-nowrap"><th className={TH}>Event</th><th className={TH}>Raised when</th><th className={TH}>Starts</th><th className={`${TH} text-right`}>Waiting now</th></tr>
              </thead>
              <tbody>
                {v.events.map((e) => (
                  <tr key={e.type} className="border-t">
                    <td className={`${TD} whitespace-nowrap`}><div className="font-medium">{e.label}</div><code className="text-[11px] text-muted-foreground">{e.type}</code></td>
                    <td className={TD}>{e.source ?? <span className="text-muted-foreground">Nothing in the product raises this event yet; the agent covers this work on its schedule.</span>}</td>
                    <td className={`${TD} whitespace-nowrap`}>{e.agents.map((x, i) => <span key={x.key}>{i > 0 && ", "}<Link href={`/app/ai/activity?agent=${x.key}`} className={link}>{x.name}</Link></span>)}</td>
                    <td className={`${TD} text-right tabular-nums`}>{e.queued}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Approval rules"
          description="The org defaults agents check before anything applies on its own. Above a limit, the action becomes a proposal in the approvals inbox."
          actions={v.can.policiesHref && <Link href={v.can.policiesHref} className="text-[12.5px] text-primary hover:underline">{v.can.editPolicies ? "Edit approval policies" : "Approval policies"}</Link>}
        >
          {!v.policiesOk && <ErrorBanner className="mb-3" tone="warning" title="Approval policies couldn't be read" message="Until they can, every agent acts as Approve first: nothing applies without a person." />}
          {v.policies.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table aria-label="Approval rules" className="w-full min-w-[640px] text-[13px]">
                <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                  <tr className="whitespace-nowrap"><th className={TH}>Decision</th><th className={`${TH} text-right`}>Acts alone up to</th><th className={TH}>Approver above that</th><th className={`${TH} text-right`}>Owner approves above</th></tr>
                </thead>
                <tbody>
                  {v.policies.map((p) => (
                    <tr key={p.id} className="border-t">
                      <th scope="row" className={`${TD} text-left font-medium`}>{p.category}</th>
                      <td className={`${TD} text-right`}>{p.alwaysHuman ? <StatusBadge value="always" label="Always a person" tone="warning" /> : p.limit == null || p.limit === 0 ? <span className="text-muted-foreground">Always a person</span> : <Money value={p.limit} style="whole" />}</td>
                      <td className={TD}>{p.approver}</td>
                      <td className={`${TD} text-right`}>{p.ownerOver == null ? <span className="text-muted-foreground">Never</span> : <Money value={p.ownerOver} style="whole" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : v.policiesOk && <EmptyState compact kind="table" title="No approval policies" description="With no policies, every agent action that moves money waits for a person." />}
          <ul className="mt-3 grid list-disc gap-1.5 pl-5 text-[12.5px] text-muted-foreground marker:text-border md:grid-cols-2 md:gap-x-8">
            <li>An action applies on its own only when its agent is set to Auto within policy, the action is low risk and its amount is within the limit above. A category with no limit always goes to a person.</li>
            <li>High-risk actions, and every legal and safety action, wait for a person whatever the autonomy.</li>
            <li>An amount above the owner threshold waits for the owner.</li>
            <li>Approving is refused if the record changed after the agent looked at it; the agent is re-run instead.</li>
            <li>An agent keeps one open proposal per record and action, so a re-run doesn&apos;t add duplicates.</li>
            <li>If the approval policies can&apos;t be read, every agent falls back to Approve first.</li>
          </ul>
        </Section>

        <Section title="Rules built into the product" description="Checks and limits that apply automatically inside actions, without an agent.">
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table aria-label="Rules built into the product" className="w-full min-w-[760px] text-[13px]">
              <thead className="bg-muted/50 text-left text-[12px] text-muted-foreground">
                <tr className="whitespace-nowrap"><th className={TH}>Rule</th><th className={TH}>When it runs</th><th className={TH}>What it does</th></tr>
              </thead>
              <tbody>
                <tr className="border-t">
                  <th scope="row" className={`${TD} text-left font-medium whitespace-nowrap`}><Link href="/app/data-health" className={link}>Data health checks</Link></th>
                  <td className={TD}>Each Data Health agent run</td>
                  <td className={TD}>{v.dataRules} checks look for duplicates, miscoded bills, unverified bank changes and other bad records. Each finding becomes an issue with a suggested fix.</td>
                </tr>
                <tr className="border-t">
                  <th scope="row" className={`${TD} text-left font-medium whitespace-nowrap`}>{v.can.settings ? <Link href="/app/settings/state-rules" className={link}>Late fee cap</Link> : "Late fee cap"}</th>
                  <td className={TD}>When someone posts late fees</td>
                  <td className={TD}>One fee per lease per month, only after the grace period, at the property&apos;s late-fee policy{lateFeePct.length ? <>, capped by state: {lateFeePct.map((c) => `${c.state} ${c.value}% of rent`).join(", ")}</> : null}.</td>
                </tr>
                <tr className="border-t">
                  <th scope="row" className={`${TD} text-left font-medium whitespace-nowrap`}>{v.can.settings ? <Link href="/app/settings/state-rules" className={link}>Returned payment fee cap</Link> : "Returned payment fee cap"}</th>
                  <td className={TD}>When someone marks a payment returned</td>
                  <td className={TD}>Charges a {dollars(RETURNED_PAYMENT_FEE_CENTS)} fee{nsfCents.length ? <>, capped by state: {nsfCents.map((c) => `${c.state} ${dollars(c.value)}`).join(", ")}</> : null}, reopens the charges it paid, and raises Payment returned for the Collections agent.</td>
                </tr>
                <tr className="border-t">
                  <th scope="row" className={`${TD} text-left font-medium whitespace-nowrap`}>Payment clearing</th>
                  <td className={TD}>On the next request after a transfer&apos;s clearing time</td>
                  <td className={TD}>Rent, vendor and owner transfers clear {SETTLE_MS / 1000} seconds after they are sent (demo timing). A cleared rent payment posts to the lease ledger with the management fee.</td>
                </tr>
                <tr className="border-t">
                  <th scope="row" className={`${TD} text-left font-medium whitespace-nowrap`}>Sample data reset</th>
                  <td className={TD}>Midnight Pacific</td>
                  <td className={TD}>Your changes to the sample data are deleted and the original sample data returns.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>
      </PageBody>
    </main>
  );
}
