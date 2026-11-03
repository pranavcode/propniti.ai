import Link from "next/link";
import { ArrowRight, CalendarCheck, Sparkles } from "lucide-react";
import { ChartCard, KpiCard } from "@/components/app/dashboard";
import { Money, StatusBadge } from "@/components/app/display";
import { Button } from "@/components/ui/button";
import { portalCtx } from "@/extensions/owners/portal/context";
import { ownerApprovals, ownerDistributions, ownerEntities, ownerMonthly, ownerProperties } from "@/extensions/owners/portal/owner-data";
import { answerOwner } from "@/extensions/owners/portal/answers/owner";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { PortalAsk } from "@/extensions/owners/portal/ui/PortalAsk";
import { monthLabel } from "@/extensions/owners/statements";

const hero = (photos: string, id: string) => {
  try {
    return (JSON.parse(photos) as string[])[0] ?? `/img/props/${id}.webp`;
  } catch {
    return `/img/props/${id}.webp`;
  }
};

// Owner home: what was paid, how the properties are doing, what needs a decision, and a briefing
// that explains the latest distribution from the statements.
export default async function OwnerHome() {
  const c = await portalCtx("owner");
  if (!c) return null;
  const [ents, dists, months, props, approvals, brief] = await Promise.all([ownerEntities(c), ownerDistributions(c, 13), ownerMonthly(c, 12), ownerProperties(c), ownerApprovals(c), answerOwner(c, "Why was my distribution lower or higher this month?")]);
  const waiting = approvals.filter((a) => !a.decision);
  const byMonth = new Map<string, number>();
  for (const d of dists) byMonth.set(d.period, (byMonth.get(d.period) ?? 0) + d.amount_cents / 100);
  const distPoints = [...byMonth].sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, amount]) => ({ month, amount }));
  const [last, prev] = [distPoints.at(-1), distPoints.at(-2)];
  const m = months.at(-1);
  const pm = months.at(-2);
  const first = c.persona.name.split(" ")[0];

  return (
    <div className="space-y-6">
      <PortalTitle eyebrow={ents.map((e) => e.name).join(" · ")} title={`Good morning, ${first}`} description={`${props.length} properties, ${props.reduce((a, p) => a + p.units, 0).toLocaleString("en-US")} homes. Figures are as of ${monthLabel(m?.month ?? "2026-10")}, your last closed month.`} />

      <section aria-label="Briefing" className="rounded-xl border border-tone-ai/20 bg-gradient-to-br from-tone-ai/[0.06] to-transparent p-4 md:p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-tone-ai/10 text-tone-ai"><Sparkles className="size-4" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-tone-ai">Your monthly briefing</p>
            <p className="mt-1 text-[14px] leading-relaxed text-pretty">{brief.answer}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {brief.links?.map((l) => <Button key={l.href} asChild size="sm" variant="outline"><Link href={l.href}>{l.label}<ArrowRight /></Link></Button>)}
              {waiting.length > 0 && <Button asChild size="sm"><Link href="/portal/owner/approvals"><CalendarCheck />{waiting.length} repair{waiting.length === 1 ? "" : "s"} to approve</Link></Button>}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">Computed from your statements: {brief.trace.map((t) => t.label.toLowerCase()).join(", ")}.</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label={`Distributed, ${last ? monthLabel(last.month) : "last month"}`} value={last?.amount ?? null} previous={prev?.amount} format="money" spark={distPoints.map((p) => p.amount)} href="/portal/owner/statements" />
        <KpiCard label="Net operating income" value={m?.noi ?? null} previous={pm?.noi} format="money" spark={months.map((x) => x.noi)} footnote={m?.budget != null ? <span>Budget <Money value={m.budget} style="whole" /></span> : undefined} href="/portal/owner/properties" />
        <KpiCard label="Occupancy" value={m?.occupancy ?? null} previous={pm?.occupancy} format="pct" spark={months.map((x) => x.occupancy ?? 0)} href="/portal/owner/properties" />
        <KpiCard label="Rent collected" value={m?.collections ?? null} previous={pm?.collections} format="pct" spark={months.map((x) => x.collections ?? 0)} help="Rent collected as a share of rent charged in the month." />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Distributions, last 12 months" kind="bar" data={distPoints} x="month" series={[{ key: "amount", label: "Distributed", format: "money" }]} drill="/portal/owner/statements?period={month}" />
        <ChartCard title="NOI against budget" kind="line" data={months} x="month" series={[{ key: "noi", label: "NOI", format: "money" }, { key: "budget", label: "Budget", format: "money", dashed: true }]} />
      </div>

      <section aria-labelledby="props-h">
        <div className="mb-2.5 flex items-end justify-between"><h2 id="props-h" className="text-[15px] font-semibold">Your properties</h2><Link href="/portal/owner/properties" className="text-[13px] font-medium text-primary hover:underline">See all</Link></div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {props.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-xl border bg-card">
              <Link href={`/portal/owner/properties#${p.id}`} className="block focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
                {/* eslint-disable-next-line @next/next/no-img-element -- static webp in /public; the Workers build has no image optimizer */}
                <img src={hero(p.photos, p.id).replace(/\.webp$/, "-400.webp")} alt={`${p.name}, ${p.neighborhood || p.metro}`} width={400} height={240} loading="lazy" className="aspect-[5/3] w-full object-cover" />
                <div className="p-3">
                  <p className="truncate text-[13.5px] font-semibold">{p.name}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{p.neighborhood || p.metro} · {p.units} homes</p>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                    <div><dt className="text-muted-foreground">Occupancy</dt><dd className="font-medium tabular-nums">{p.occupancy != null ? `${(p.occupancy * 100).toFixed(1)}%` : "—"}</dd></div>
                    <div><dt className="text-muted-foreground">NOI</dt><dd className="font-medium"><Money value={p.noi_cents} cents style="whole" /></dd></div>
                  </dl>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <section aria-labelledby="pay-h" className="rounded-xl border bg-card">
          <h2 id="pay-h" className="border-b px-4 py-3 text-[14px] font-semibold">Recent distributions</h2>
          <ul className="divide-y">
            {dists.slice(0, 5).map((d) => (
              <li key={d.id}>
                <Link href={`/portal/owner/statements?entity=${d.owner_entity_id}&period=${d.period}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
                  <div className="min-w-0 flex-1"><p className="text-[13px] font-medium">{monthLabel(d.period)}</p><p className="text-[12px] text-muted-foreground">Paid {d.paid_on} by ACH</p></div>
                  <StatusBadge value={d.status === "Pending" ? "On its way" : "Paid"} tone={d.status === "Pending" ? "info" : "success"} />
                  <Money value={d.amount_cents} cents className="w-28 text-right font-medium" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <PortalAsk title="Ask about your portfolio" prompts={c.persona.assistantPrompts} />
      </div>
    </div>
  );
}
