import Link from "next/link";
import { CalendarDays, KanbanSquare, Megaphone, RefreshCw } from "lucide-react";
import { can } from "@/entities";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { ChartPanel, KpiTile, type ChartData, type KpiData } from "@/components/entity/Metrics";
import { kpis, leasingCtx } from "@/extensions/leasing/data";

export const metadata = { title: "Leasing · Propniti" };

// Leasing overview: the module dashboard. Every KPI and chart point opens the rows behind it.
const KPIS: Omit<KpiData, "value" | "previous" | "spark">[] = [
  { key: "leasing.leads_30d", label: "Leads, 30 days", format: "count", goodWhen: "up", drill: "/app/leasing/prospects?view=open", help: "New prospects in the last 30 days, against the 30 before." },
  { key: "leasing.tours_today", label: "Tours today", format: "count", drill: "/app/leasing/showings?view=today" },
  { key: "leasing.active_listings", label: "Active listings", format: "count", drill: "/app/leasing/listings?f.status=Active" },
  { key: "leasing.avg_dom", label: "Days on market", format: "days", goodWhen: "down", drill: "/app/leasing/listings?view=stale" },
  { key: "leasing.vacancy_loss_live", label: "Vacancy loss MTD", format: "money", goodWhen: "down", drill: "/app/leasing/listings?f.status=Active", help: "Asking rent for each day a listed home has been empty this month." },
  { key: "leasing.pending_decisions", label: "Awaiting decision", format: "count", goodWhen: "down", drill: "/app/leasing/applications?view=decide" },
];

const CHARTS: Omit<ChartData, "points">[] = [
  { key: "leasing.pipeline_funnel", title: "Leasing funnel, last 90 days", kind: "funnel", x: "stage", series: [{ key: "count", label: "Prospects", format: "count" }], drill: "/app/leasing/pipeline" },
  { key: "leasing.weekly", title: "Leads, tours and applications per week", kind: "line", x: "week", series: [{ key: "leads", label: "Leads", format: "count" }, { key: "tours", label: "Tours", format: "count" }, { key: "applications", label: "Applications", format: "count" }], drill: "/app/leasing/prospects" },
  { key: "leasing.dom_by_property", title: "Days on market by property", kind: "hbar", x: "name", series: [{ key: "avg_dom", label: "Avg days", format: "days" }], drill: "/app/leasing/listings?f.property_id={property_id}&f.status=Active" },
  { key: "leasing.leads_by_source", title: "Leads by source, last 90 days", kind: "bar", x: "source", series: [{ key: "leads", label: "Leads", format: "count" }, { key: "leased", label: "Leased", format: "count" }], drill: "/app/leasing/prospects?f.source={source}" },
  { key: "leasing.applications_by_stage", title: "Applications by stage, last 90 days", kind: "bar", x: "stage", series: [{ key: "count", label: "Applications", format: "count" }], drill: "/app/leasing/applications?f.stage={stage}" },
  { key: "leasing.renewals_by_status", title: "Renewal offers, last 6 months", kind: "donut", x: "status", series: [{ key: "count", label: "Offers", format: "count" }], drill: "/app/leasing/renewal-offers?f.status={status}" },
];

export default async function LeasingOverview() {
  const c = await leasingCtx();
  if (!can(c.actor.role, "read", "prospects")) {
    return <PageBody><EmptyState title="Leasing isn't part of your role" description="Switch role from your avatar menu to see this page as a leasing agent or broker." action={{ label: "Go to your home", href: "/app" }} /></PageBody>;
  }
  const [k, ch] = await Promise.all([kpis(c, KPIS.map((x) => x.key)), kpis(c, CHARTS.map((x) => x.key))]);
  const kpiData: KpiData[] = KPIS.map((d, i) => ({ ...d, value: k[i].value, previous: k[i].previous, spark: k[i].spark, asOf: k[i].asOf, error: "error" in k[i] ? (k[i] as { error?: string }).error : undefined }));
  const chartData: ChartData[] = CHARTS.map((d, i) => ({ ...d, points: ch[i].points, source: ch[i].source, error: "error" in ch[i] ? (ch[i] as { error?: string }).error : undefined }));
  return (
    <>
      <PageHeader
        title="Leasing"
        description="Leads, tours, applications, listings and renewals, live from your records."
        meta={<span>{c.actor.scope.label}</span>}
        actions={
          <>
            <Button asChild size="sm" variant="outline"><Link href="/app/leasing/listings"><Megaphone data-icon="inline-start" />Listings</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href="/app/leasing/renewals"><RefreshCw data-icon="inline-start" />Renewals</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href={c.actor.role === "broker" ? "/app/leasing/broker" : "/app/leasing/today"}><CalendarDays data-icon="inline-start" />{c.actor.role === "broker" ? "Broker desk" : "My day"}</Link></Button>
            <Button asChild size="sm"><Link href="/app/leasing/pipeline"><KanbanSquare data-icon="inline-start" />Pipeline board</Link></Button>
          </>
        }
      />
      <PageBody>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">{kpiData.map((x) => <KpiTile key={x.key} k={x} />)}</div>
        <div className="grid gap-3 lg:grid-cols-2">{chartData.map((x) => <ChartPanel key={x.key} c={x} />)}</div>
      </PageBody>
    </>
  );
}
