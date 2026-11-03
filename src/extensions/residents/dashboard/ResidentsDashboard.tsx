import Link from "next/link";
import { getEntity, type ChartDef, type KpiDef } from "@/entities";
import { metrics } from "@/server/query";
import { ChartCard, KpiCard } from "@/components/app/dashboard";
import { ErrorBanner } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { pageCtx } from "../server";

// Residents and leases dashboard: the KPIs and charts declared on the residents, leases, renters
// insurance and conversation defs, each drilling into the filtered list behind it.

const ENTITIES = ["residents", "leases", "message_threads"] as const;

export async function ResidentsDashboard() {
  const ctx = await pageCtx();
  const role = ctx.actor.role;
  const defs = ENTITIES.map((k) => getEntity(k)!).filter(Boolean);
  const kpis = defs.flatMap((d) => d.kpis ?? []).filter((k) => !k.roles || k.roles.includes(role));
  const charts = defs.flatMap((d) => d.charts ?? []).filter((c) => !c.roles || c.roles.includes(role));
  const [kv, cv] = await Promise.all([
    Promise.all(kpis.map(async (k: KpiDef) => ({ k, m: await metrics(ctx, k.metric).catch(() => null) }))),
    Promise.all(charts.map(async (c: ChartDef) => ({ c, m: await metrics(ctx, c.metric).catch(() => null) }))),
  ]);
  return (
    <main className="space-y-4 px-4 pt-5 pb-10 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Residents and leases</h1>
          <p className="text-[12.5px] text-muted-foreground">{ctx.actor.scope.label} · every tile and bar opens the rows behind it</p>
        </div>
        <div className="flex gap-1.5">
          <Button asChild size="sm" variant="outline"><Link href="/app/residents">Residents</Link></Button>
          <Button asChild size="sm" variant="outline"><Link href="/app/leases">Leases</Link></Button>
          <Button asChild size="sm" variant="outline"><Link href="/app/communications/inbox">Messages</Link></Button>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kv.map(({ k, m }) => (
          <KpiCard key={k.key} label={k.label} format={k.format} goodWhen={k.goodWhen} value={m?.value ?? null} previous={k.delta ? m?.previous ?? null : undefined} spark={k.delta ? m?.spark : undefined} href={k.drill} help={k.help?.summary} />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {cv.map(({ c, m }) => m
          ? <ChartCard key={c.key} title={c.title} kind={c.kind} data={m.points as never} x={c.x} series={c.series} drill={c.drill} help={c.help?.summary} height={220}
              legend={c.kind === "donut" ? undefined : c.series.length > 1} />
          : <ErrorBanner key={c.key} message={`${c.title} couldn't load.`} />)}
      </div>
    </main>
  );
}
