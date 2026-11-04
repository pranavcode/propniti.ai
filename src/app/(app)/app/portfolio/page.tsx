import type { Metadata } from "next";
import Link from "@/components/Link";
import { Briefcase, Building, FlaskConical, LayoutPanelTop, Map as MapIcon } from "lucide-react";
import "@/entities";
import { can } from "@/entities";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { formatMoney, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { list, metrics } from "@/server/query";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { ChartCard, DashboardGrid, GridItem, KpiRow, type ChartPoint } from "@/components/app/dashboard";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { ExplainableKpi, ExplainLink } from "@/extensions/portfolio/ui/Explain";
import { LAST_CLOSED } from "@/extensions/portfolio/home/data";

// Portfolio module dashboard: the asset view of everything in scope. KPIs explain themselves,
// charts drill to filtered lists, and every property shows as a photo card.

export const metadata: Metadata = { title: "Portfolio · Propniti" };

const monthLong = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const label = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(" ", " ’");
const STATUS_ORDER = ["Occupied", "Notice", "Vacant", "Make-ready", "Down", "Model"];
const STATUS_COLOR: Record<string, string> = { Occupied: "var(--tone-success)", Notice: "var(--tone-warning)", Vacant: "var(--muted-foreground)", "Make-ready": "var(--tone-info)", Down: "var(--tone-danger)", Model: "var(--tone-ai)" };

export default async function PortfolioDashboard() {
  const session = await currentSession();
  const q = { db: getPlatform().db, ws: session.ws, actor: session.actor };
  if (!can(session.actor.role, "read", "properties")) {
    return <main className="p-6"><EmptyState title="The portfolio isn't part of your role" description="Switch role from your avatar menu to see the portfolio dashboard." action={{ label: "Go to your home", href: "/app" }} /></main>;
  }
  const closed = { month: LAST_CLOSED, months: 12 };
  const settle = <T,>(p: Promise<T>) => p.then((v) => v, () => null);
  const [noi, occ, vac, econ, metro, status, props] = await Promise.all([
    settle(metrics(q, "portfolio.noi", closed)),
    settle(metrics(q, "portfolio.occupancy", closed)),
    settle(metrics(q, "leasing.vacancy_loss", closed)),
    settle(metrics(q, "portfolio.economic_occupancy", closed)),
    settle(metrics(q, "portfolio.by_metro", { month: LAST_CLOSED })),
    settle(metrics(q, "portfolio.unit_status")),
    settle(list(q, "properties", { size: 60, sort: ["name", "asc"] })),
  ]);
  const statusPts = (status?.points ?? []).sort((a, b) => STATUS_ORDER.indexOf(String(a.status)) - STATUS_ORDER.indexOf(String(b.status))).map((p) => ({ ...p, color: STATUS_COLOR[String(p.status)] })) as ChartPoint[];
  const occupancyPts = (occ?.points ?? []).map((p) => ({ ...p, label: label(String(p.month)) })) as ChartPoint[];
  const noiPts = (noi?.points ?? []).map((p) => ({ ...p, label: label(String(p.month)) })) as ChartPoint[];
  const failed = [noi, occ, vac, econ, metro, status, props].some((x) => x == null);
  const role = session.actor.role;

  return (
    <main>
      <PageHeader
        title="Portfolio"
        meta={<><span>{session.actor.scope.label}</span><span>·</span><span>{props?.total ?? 0} properties</span><span>·</span><span>{monthLong(LAST_CLOSED)} close</span></>}
        actions={<>
          {can(role, "read", "regions") && <Button asChild size="sm" variant="ghost"><Link href="/app/regions"><MapIcon />Regions</Link></Button>}
          {can(role, "read", "portfolios") && <Button asChild size="sm" variant="ghost"><Link href="/app/portfolios"><Briefcase />Portfolios</Link></Button>}
          <Button asChild size="sm" variant="ghost"><Link href="/app/buildings"><Building />Buildings</Link></Button>
          <Button asChild size="sm" variant="ghost"><Link href="/app/floor-plans"><LayoutPanelTop />Floor plans</Link></Button>
          <Button asChild size="sm"><Link href="/app/portfolio/what-if"><FlaskConical />What-if</Link></Button>
        </>}
      />
      <PageBody>
        {failed && <ErrorBanner title="Some figures didn't load" message="The rest of the page is current. Reload to try again." />}
        <KpiRow>
          <ExplainableKpi metric="portfolio.noi" label="NOI" format="money" value={noi?.value ?? null} previous={noi?.previous ?? null} spark={noi?.spark} href="/app/properties?sort=-noi_month" footnote={monthLong(LAST_CLOSED)} />
          <ExplainableKpi metric="portfolio.occupancy" label="Occupancy" format="pct" value={occ?.value ?? null} previous={occ?.previous ?? null} spark={occ?.spark} href="/app/units?f.status=Vacant" footnote="Physical, month end" />
          <ExplainableKpi metric="leasing.vacancy_loss" label="Vacancy loss" format="money" value={vac?.value ?? null} previous={vac?.previous ?? null} spark={vac?.spark} goodWhen="down" href="/app/units?view=vacant" footnote="Rent lost on empty units" />
          <ExplainableKpi metric="portfolio.economic_occupancy" label="Economic occupancy" format="pct" value={econ?.value ?? null} previous={econ?.previous ?? null} spark={econ?.spark} href="/app/units?view=below-market" footnote={`${statusPts.find((p) => p.status === "Vacant")?.units ?? 0} of ${status?.value ?? 0} units vacant today`} help="Rent actually earned over gross potential rent: vacancy, concessions and bad debt all pull it down." />
        </KpiRow>

        <DashboardGrid>
          <GridItem span={8}><ChartCard title="NOI vs budget" description="Trailing 12 closed months" kind="line" data={noiPts} x="label" series={[{ key: "noi", label: "NOI", format: "money" }, { key: "budget", label: "Budget", format: "money", dashed: true }]} drill="/app/properties?sort=-noi_month" height={250} actions={<ExplainLink metric="portfolio.noi" label="NOI" />} /></GridItem>
          <GridItem span={4}><ChartCard title="Units by status" description="Live, all properties in scope" kind="donut" data={statusPts} x="status" series={[{ key: "units", label: "Units", format: "count" }]} drill="/app/units?f.status={status}" height={250} /></GridItem>
          <GridItem span={6}><ChartCard title="NOI vs budget by metro" description={monthLong(LAST_CLOSED)} kind="bar" data={(metro?.points ?? []) as ChartPoint[]} x="metro" series={[{ key: "noi", label: "NOI", format: "money" }, { key: "budget", label: "Budget", format: "money" }]} drill="/app/properties?f.metro={metro}" height={240} /></GridItem>
          <GridItem span={6}><ChartCard title="Occupancy trend" description="Physical vs economic" kind="line" data={occupancyPts} x="label" series={[{ key: "physical", label: "Physical", format: "pct" }, { key: "economic", label: "Economic", format: "pct" }]} drill="/app/units?f.status=Vacant" height={240} actions={<ExplainLink metric="portfolio.occupancy" label="Occupancy" />} /></GridItem>
        </DashboardGrid>

        <Section title="Properties" description="Live occupancy and last month's NOI. Open one for photos, the unit stack, floor plans and financials." actions={<Button asChild size="sm" variant="ghost"><Link href="/app/properties">Open as table</Link></Button>}>
          {props?.rows.length ? (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {props.rows.map((p) => {
                const occupancy = p.occupancy == null ? null : Number(p.occupancy);
                return (
                  <li key={String(p.id)}>
                    <Link href={`/app/properties/${p.id}`} className="group block overflow-hidden rounded-lg border bg-card transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-[0_2px_10px_-4px_oklch(0_0_0/0.15)] focus-visible:ring-2 focus-visible:ring-ring/60 outline-none">
                      <div className="relative aspect-[16/9] overflow-hidden bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element -- static WebP, no image optimizer on Workers */}
                        <img src={String(p._image ?? `/img/props/${p.id}-400.webp`)} alt="" loading="lazy" width={400} height={225} className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
                        <span className="absolute top-2 left-2 rounded bg-background/90 px-1.5 py-0.5 text-[11px] font-medium backdrop-blur">{String(p.metro)}</span>
                        {p.status !== "Stabilized" && <span className="absolute top-2 right-2 rounded bg-tone-info px-1.5 py-0.5 text-[11px] font-medium text-white">{String(p.status)}</span>}
                      </div>
                      <div className="px-3 py-2.5">
                        <div className="truncate text-[13.5px] font-semibold group-hover:text-primary">{String(p.name)}</div>
                        <div className="truncate text-[12px] text-muted-foreground">{String(p.type)}{p.class ? ` · Class ${p.class}` : ""} · {Number(p.units ?? 0)} units</div>
                        <dl className="mt-2 grid grid-cols-3 gap-2 border-t pt-2 text-[12px] tabular-nums">
                          <div><dt className="text-[11px] text-muted-foreground">Occupancy</dt><dd className={cn("font-medium", occupancy != null && occupancy < 0.9 && "text-tone-warning")}>{occupancy == null ? "—" : formatPct(occupancy, 1)}</dd></div>
                          <div><dt className="text-[11px] text-muted-foreground">NOI</dt><dd className="font-medium">{p.noi_month == null ? "—" : formatMoney(Number(p.noi_month), "compact")}</dd></div>
                          <div><dt className="text-[11px] text-muted-foreground">Delinquent</dt><dd className="font-medium">{p.delinquent == null ? "—" : formatMoney(Number(p.delinquent), "compact")}</dd></div>
                        </dl>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState kind="table" title="No properties in your scope" description="Properties you manage appear here with photos, occupancy and NOI." />}
        </Section>
      </PageBody>
    </main>
  );
}
