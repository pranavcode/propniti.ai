import type { Metadata } from "next";
import Link from "@/components/Link";
import { ArrowRight, Bot, ClipboardCheck, FileBadge, Gavel, ShieldAlert, ShieldCheck } from "lucide-react";
import { can, getEntity, type ChartDef, type EntityKey, type KpiDef } from "@/entities";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { metrics, QueryError, type QueryCtx } from "@/server/query";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { StatusBadge, RelativeDate } from "@/components/app/display";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { KpiTile, type ChartData, type KpiData } from "@/components/entity/Metrics";
import { ChartCard } from "@/components/app/dashboard";
import type { ChartPoint, ChartSeries } from "@/components/app/dashboard";
import { ProposalCard } from "@/ai/ui/RunView";
import { pageData } from "@/ai/ui/server";
import { proposalsPage } from "@/ai/views";
import type { ProposalJson } from "@/ai/ui/client";
import { expiries, LAPSED, type Expiry, type ExpiryKind } from "@/extensions/risk/timeline";
import { RequestCoiButton } from "@/extensions/risk/ui/RequestCoi";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Compliance · Propniti" };

// Compliance dashboard: what lapses next across vendor certificates, property insurance and
// compliance items, the legal docket, and what the Compliance agent proposes. Lists and records
// are the generic pages under /app/compliance/*.

const KPIS: (KpiDef & { needs: EntityKey })[] = [
  { key: "expiring", label: "Expiring in 30 days", metric: "risk.expiring_30", format: "count", goodWhen: "down", drill: "/app/compliance/items?view=attention", help: { summary: "Vendor certificates, insurance policies and compliance items that lapse in the next 30 days." }, needs: "compliance_items" },
  { key: "overdue", label: "Overdue compliance items", metric: "risk.overdue_items", format: "count", goodWhen: "down", drill: "/app/compliance/items?f.status=Overdue", help: { summary: "Permits, inspections, certificates and training past their due date and not yet done." }, needs: "compliance_items" },
  { key: "exposed", label: "Vendors working uninsured", metric: "risk.exposed_vendors", format: "count", goodWhen: "down", drill: "/app/compliance/cois?view=exposed", help: { summary: "Vendors whose current certificate is expired or missing but who still have open work orders." }, needs: "vendor_cois" },
  { key: "legal", label: "Open legal cases", metric: "risk.legal_open", format: "count", goodWhen: "down", drill: "/app/compliance/legal?view=open", needs: "legal_cases" },
  { key: "legal_balance", label: "Balance in legal cases", metric: "risk.legal_balance", format: "money", goodWhen: "down", drill: "/app/compliance/legal?view=open", help: { summary: "Unpaid balances at issue in open evictions and small-claims cases." }, needs: "legal_cases" },
];

// Status is encoded with the reserved status tones (each also labelled in the legend), and the
// colour follows the status, not its position, so an absent status never repaints the rest.
const TONE = { success: "var(--tone-success)", warning: "var(--tone-warning)", danger: "var(--tone-danger)", neutral: "var(--tone-neutral)", info: "var(--tone-info)" };
const SERIES_TONE: Record<string, Record<string, string>> = { by_kind: { overdue: TONE.danger, due_soon: TONE.warning, open: TONE.info, done: TONE.success } };
const POINT_TONE: Record<string, Record<string, string>> = { coi: { Valid: TONE.success, Expiring: TONE.warning, "Pending verification": TONE.info, Expired: TONE.danger, Rejected: TONE.danger, Missing: TONE.neutral } };

const CHARTS: (ChartDef & { needs: EntityKey })[] = [
  { key: "by_month", title: "Upcoming expiries, next 12 months", kind: "stacked", metric: "risk.expiries_by_month", x: "month", needs: "compliance_items",
    series: [{ key: "item", label: "Compliance items", format: "count" }, { key: "coi", label: "Vendor COIs", format: "count" }, { key: "policy", label: "Insurance policies", format: "count" }],
    drill: "/app/compliance/items?f.due_on.min={from}&f.due_on.max={to}" },
  { key: "by_kind", title: "Compliance items by type and status", kind: "stacked", metric: "risk.items_by_kind", x: "kind", needs: "compliance_items",
    series: [{ key: "overdue", label: "Overdue", format: "count" }, { key: "due_soon", label: "Due soon", format: "count" }, { key: "open", label: "Open", format: "count" }, { key: "done", label: "Done", format: "count" }],
    drill: "/app/compliance/items?f.kind={kind}" },
  { key: "coi", title: "Current vendor certificates by status", kind: "donut", metric: "risk.coi_status", x: "status", needs: "vendor_cois",
    series: [{ key: "count", label: "Vendors", format: "count" }], drill: "/app/compliance/cois?f.is_current=true&f.status={status}" },
  { key: "legal", title: "Legal cases by stage", kind: "bar", metric: "risk.legal_by_stage", x: "stage", needs: "legal_cases",
    series: [{ key: "cases", label: "Cases", format: "count" }], drill: "/app/compliance/legal?f.stage={stage}" },
];

const errMsg = (e: unknown) => (e instanceof QueryError ? e.message : "This figure couldn't load. Refresh to try again.");

async function kpi(ctx: QueryCtx, k: KpiDef): Promise<KpiData> {
  const base = { key: k.key, label: k.label, format: k.format, goodWhen: k.goodWhen, drill: k.drill, help: k.help?.summary, previous: null, spark: [] };
  try {
    const m = await metrics(ctx, k.metric);
    return { ...base, value: m.value ?? null };
  } catch (e) {
    return { ...base, value: null, error: errMsg(e) };
  }
}

async function chart(ctx: QueryCtx, c: ChartDef): Promise<ChartData> {
  const base = { key: c.key, title: c.title, kind: c.kind, x: c.x, series: c.series, drill: c.drill };
  try {
    const m = await metrics(ctx, c.metric);
    return { ...base, points: m.points, source: m.source };
  } catch (e) {
    return { ...base, points: [], error: errMsg(e) };
  }
}

const LISTS: { entity: EntityKey; label: string; icon: typeof ShieldCheck; href: string }[] = [
  { entity: "compliance_items", label: "Compliance items", icon: ClipboardCheck, href: "/app/compliance/items" },
  { entity: "vendor_cois", label: "Vendor COIs", icon: FileBadge, href: "/app/compliance/cois?view=current" },
  { entity: "insurance_policies", label: "Property insurance", icon: ShieldCheck, href: "/app/compliance/insurance" },
  { entity: "legal_cases", label: "Legal and evictions", icon: Gavel, href: "/app/compliance/legal" },
];

const KIND: Record<ExpiryKind, { label: string; entity: EntityKey }> = {
  item: { label: "Compliance", entity: "compliance_items" },
  coi: { label: "Vendor COI", entity: "vendor_cois" },
  policy: { label: "Insurance", entity: "insurance_policies" },
};

const day = (s: string) => Date.parse(`${s}T00:00:00Z`);
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// Lapsed items first, then one group per week (Monday start) over the window.
function groupByWeek(rows: Expiry[], today: string) {
  const t = day(today);
  const isLapsed = (r: Expiry) => day(r.date) < t || LAPSED.includes(r.status);
  const lapsed = rows.filter(isLapsed);
  const weeks = new Map<number, Expiry[]>();
  for (const r of rows.filter((x) => !isLapsed(x))) {
    const d = new Date(day(r.date));
    const monday = day(r.date) - ((d.getUTCDay() + 6) % 7) * 86_400_000;
    weeks.set(monday, [...(weeks.get(monday) ?? []), r]);
  }
  return { lapsed, weeks: [...weeks.entries()].sort((a, b) => a[0] - b[0]) };
}

// Lapsed certificates can be chased from here: the vendor gets a portal request, at most once a week.
const canChase = (r: Expiry) => r.kind === "coi" && ["Expired", "Missing", "Rejected"].includes(r.status);

function TimelineRow({ r, lapsed, chase }: { r: Expiry; lapsed?: boolean; chase?: boolean }) {
  return (
    <li className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2">
      <span className={cn("w-fit rounded px-1.5 py-0.5 text-[11px] font-medium", r.kind === "item" ? "bg-tone-info/10 text-tone-info" : r.kind === "coi" ? "bg-tone-warning/10 text-tone-warning" : "bg-tone-neutral/10 text-foreground")}>{KIND[r.kind].label}</span>
      <div className="min-w-0">
        <Link href={r.href} className="block truncate font-medium hover:text-primary hover:underline">{r.title}</Link>
        {r.where && <div className="truncate text-[12px] text-muted-foreground">{r.where}</div>}
      </div>
      <div className="flex items-center gap-2 text-right">
        {chase && canChase(r) && (r.requested
          ? <span className="text-[11.5px] text-muted-foreground">Asked <RelativeDate value={r.requested} /></span>
          : <RequestCoiButton ids={[r.id]} />)}
        <StatusBadge value={r.status} tone={lapsed ? "danger" : r.status === "Due soon" || r.status === "Expiring" ? "warning" : "neutral"} />
        <RelativeDate value={r.date} mode="due" className={cn("w-24 text-[12px] tabular-nums", lapsed ? "text-tone-danger" : "text-muted-foreground")} />
      </div>
    </li>
  );
}

function Timeline({ rows, today, chase }: { rows: Expiry[]; today: string; chase: boolean }) {
  const { lapsed, weeks } = groupByWeek(rows, today);
  const toChase = chase ? lapsed.filter((r) => canChase(r) && !r.requested).map((r) => r.id) : [];
  if (!rows.length) return <EmptyState compact kind="table" title="Nothing lapses in the next 90 days" description="Certificates, policies and compliance items due later show in the lists." />;
  return (
    <div className="flex max-h-[560px] flex-col overflow-y-auto rounded-lg border bg-card">
      {lapsed.length > 0 && (
        <section className="border-b border-tone-danger/20 bg-tone-danger/[0.04]">
          <h3 className="sticky top-0 z-10 flex items-center justify-between bg-tone-danger/[0.06] px-3 py-1.5 text-[12px] font-semibold text-tone-danger backdrop-blur">
            <span>Lapsed, needs action</span>
            <span className="flex items-center gap-2">{toChase.length > 1 && <RequestCoiButton ids={toChase} label={`Request all ${toChase.length} certificates`} className="bg-card" />}<span className="tabular-nums">{lapsed.length}</span></span>
          </h3>
          <ul className="divide-y divide-tone-danger/10">{lapsed.map((r) => <TimelineRow key={`${r.kind}-${r.id}`} r={r} lapsed chase={chase} />)}</ul>
        </section>
      )}
      {weeks.map(([monday, items]) => (
        <section key={monday} className="border-b last:border-0">
          <h3 className="sticky top-0 z-10 flex items-center justify-between bg-muted/80 px-3 py-1.5 text-[12px] font-medium text-muted-foreground backdrop-blur">
            <span>Week of {fmtDay(monday)}</span><span className="tabular-nums">{items.length}</span>
          </h3>
          <ul className="divide-y">{items.map((r) => <TimelineRow key={`${r.kind}-${r.id}`} r={r} />)}</ul>
        </section>
      ))}
    </div>
  );
}

export default async function CompliancePage() {
  const session = await currentSession();
  const role = session.actor.role;
  const readable = LISTS.filter((l) => getEntity(l.entity) && can(role, "read", l.entity));
  if (!readable.length) {
    return <main className="p-6"><EmptyState title="Compliance isn't part of your role" description="Switch role from your avatar menu to see certificates, inspections and legal cases." action={{ label: "Go to your home", href: "/app" }} /></main>;
  }
  const ctx: QueryCtx = { db: getPlatform().db, ws: session.ws, actor: session.actor };
  const { data } = await pageData();
  const canTimeline = can(role, "read", "compliance_items");
  const [kpis, charts, timeline, proposals] = await Promise.all([
    Promise.all(KPIS.filter((k) => can(role, "read", k.needs)).map((k) => kpi(ctx, k))),
    Promise.all(CHARTS.filter((c) => can(role, "read", c.needs)).map((c) => chart(ctx, c))),
    canTimeline ? expiries(ctx, 90).then((r) => ({ ...r, error: null }), () => ({ today: "", rows: [] as Expiry[], error: "The timeline couldn't load. Refresh to try again." })) : null,
    proposalsPage(data, { queue: "needs_you", agent: "compliance", size: 6 }).catch(() => null),
  ]);
  const props = proposals ? (JSON.parse(JSON.stringify(proposals.rows)) as ProposalJson[]) : null;

  return (
    <main>
      <PageHeader
        icon={<ShieldAlert />}
        title="Compliance"
        description="Property insurance, vendor certificates, inspections, permits and legal cases, with what lapses next."
        meta={<><span>{session.actor.scope.label}</span>{timeline?.today && <span>As of <RelativeDate value={timeline.today} mode="date" /></span>}</>}
        actions={<Button asChild size="sm" variant="outline"><Link href="/app/agents"><Bot /> Run Compliance agent</Link></Button>}
      >
        <nav aria-label="Compliance lists" className="flex flex-wrap gap-1.5">
          {readable.map((l) => (
            <Link key={l.entity} href={l.href} className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-card px-2.5 text-[12.5px] font-medium shadow-xs transition-colors hover:bg-muted">
              <l.icon className="size-3.5 text-muted-foreground" />{l.label}
            </Link>
          ))}
        </nav>
      </PageHeader>
      <PageBody>
        <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3", kpis.length > 3 && (kpis.length === 4 ? "xl:grid-cols-4" : "xl:grid-cols-5"))}>{kpis.map((k) => <KpiTile key={k.key} k={k} />)}</div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          {timeline && (
            <Section title="Expiries timeline" description="Lapsed items first, then the next 90 days by week." actions={<Link href="/app/compliance/items?view=next-90" className="text-[12px] text-primary hover:underline">All upcoming</Link>}>
              {timeline.error ? <ErrorBanner message={timeline.error} /> : <Timeline rows={timeline.rows} today={timeline.today} chase={can(role, "vendor_cois.request_certificate", "vendor_cois")} />}
            </Section>
          )}
          <Section
            title="Compliance agent proposals"
            description="Renewal requests and escalations waiting for a person."
            actions={<Link href="/app/ai/approvals?agent=compliance" className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline">All approvals <ArrowRight className="size-3" /></Link>}
          >
            {!props ? <ErrorBanner message="Proposals couldn't load. Refresh to try again." /> : props.length === 0 ? (
              <div className="rounded-lg border bg-card"><EmptyState compact kind="table" title="Nothing waiting on you" description="The Compliance agent checks certificates and due dates daily. Its handled items are in AI activity." action={{ label: "Open agents", href: "/app/agents" }} /></div>
            ) : (
              <div className="flex flex-col gap-2">
                {props.map((p) => <ProposalCard key={p.id} p={p} variant="card" />)}
                {(proposals?.total ?? 0) > props.length && <Link href="/app/ai/approvals?agent=compliance" className="text-center text-[12px] text-primary hover:underline">{(proposals?.total ?? 0) - props.length} more waiting</Link>}
              </div>
            )}
          </Section>
        </div>

        {charts.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-2">
            {charts.map((c) => (
              <ChartCard key={c.key} title={c.title} kind={c.kind} x={c.x} drill={c.drill}
                series={c.series.map((ser): ChartSeries => ({ ...ser, color: SERIES_TONE[c.key]?.[ser.key] }))}
                data={c.points.map((pt) => ({ ...pt, color: POINT_TONE[c.key]?.[String(pt[c.x])] ?? null }) as ChartPoint)}
                empty={c.error ?? "Nothing to chart yet."} />
            ))}
          </div>
        )}
      </PageBody>
    </main>
  );
}
