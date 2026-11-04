import type { Metadata } from "next";
import Link from "@/components/Link";
import { Activity, Building } from "lucide-react";
import { getEntity } from "@/entities";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { PageBody, PageHeader, Section } from "@/components/app/page";
import { ChartCard, DashboardGrid, GridItem, KpiCard, KpiRow } from "@/components/app/dashboard";
import { ListView } from "@/components/entity/pages";
import { orgSummary } from "@/extensions/platform/console";
import { PlatformOnly } from "./gate";

export const metadata: Metadata = { title: "Customer organizations · Propniti" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function PlatformPage({ searchParams }: Props) {
  const session = await currentSession();
  if (session.actor.role !== "platform_admin") return <PlatformOnly />;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) sp.append(k, x);
  const s = await orgSummary(getPlatform().db, session.ws);
  const seatUse = s.top.reduce((a, o) => a + o.users, 0);
  return (
    <>
      <PageHeader
        icon={<Building />}
        title="Customer organizations"
        description="Every org on the platform: plan, status, seats and the portfolio each one manages."
        actions={<Link href="/app/settings/platform/usage" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12.5px] font-medium hover:bg-muted"><Activity className="size-3.5" />AI usage</Link>}
      />
      <PageBody>
        <KpiRow>
          <KpiCard label="Organizations" value={s.orgs} footnote={`${s.active} active · ${s.trial} on trial`} href="/app/settings/platform/orgs" />
          <KpiCard label="Need attention" value={s.attention} goodWhen="down" footnote="Past due or suspended" href="/app/settings/platform/orgs?f.status=Past%20due,Suspended" />
          <KpiCard label="Seats sold" value={s.seats} footnote={`${seatUse} active users on file`} />
          <KpiCard label="Units managed" value={s.units} footnote="Across all customer portfolios" />
        </KpiRow>
        {s.orgs > 0 && (
          <DashboardGrid>
            <GridItem span={5}>
              <ChartCard title="Units managed by plan" description="Share of the platform's portfolio" kind="donut" data={s.plans} x="plan" series={[{ key: "units", label: "Units", format: "count" }]} drill="/app/settings/platform/orgs?f.plan={plan}" height={180} />
            </GridItem>
            <GridItem span={7}>
              <ChartCard title="Largest organizations" description="Units managed" kind="hbar" data={s.top.slice(0, 8)} x="name" series={[{ key: "units", label: "Units", format: "count" }]} drill="/app/settings/platform/orgs/{id}" height={220} />
            </GridItem>
          </DashboardGrid>
        )}
        <Section>
          <div className="-mx-4 -mt-4 md:-mx-6">
            <ListView def={getEntity("orgs")!} searchParams={sp} session={session} />
          </div>
        </Section>
      </PageBody>
    </>
  );
}
