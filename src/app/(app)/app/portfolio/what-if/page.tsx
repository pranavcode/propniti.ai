import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { currentSession } from "@/auth/session";
import { can } from "@/entities";
import { getPlatform } from "@/lib/platform";
import { formatMonth } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { NO_CHANGE, type Levers } from "@/extensions/portfolio/whatif";
import { loadBaselines } from "@/extensions/portfolio/whatif-data";
import { Simulator, type Scope } from "@/extensions/portfolio/whatif-ui/Simulator";

export const metadata: Metadata = { title: "What-if scenarios · Propniti" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const num = (v: unknown, lo: number, hi: number) => {
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

export default async function WhatIfPage({ searchParams }: Props) {
  const sp = await searchParams;
  const session = await currentSession();
  if (!can(session.actor.role, "read", "properties")) {
    return <main className="p-6"><EmptyState title="Scenarios aren't part of your role" description="Switch role from your avatar menu to model rent, occupancy and expense changes." action={{ label: "Go to your home", href: "/app" }} /></main>;
  }
  const { rows, from, to } = await loadBaselines(getPlatform().db, session.ws, session.actor.propertyIds);
  const property = typeof sp.property === "string" && rows.some((r) => r.property_id === sp.property) ? sp.property : null;
  const metro = typeof sp.metro === "string" && rows.some((r) => r.metro === sp.metro) ? sp.metro : null;
  const scope: Scope = property ? { kind: "property", property } : metro ? { kind: "metro", metro } : { kind: "portfolio" };
  const occTarget = num(sp.occ, 50, 100);
  const levers: Levers = { ...NO_CHANGE, rentPct: num(sp.rent, -20, 20) ?? 0, opexPct: num(sp.opex, -30, 30) ?? 0, occTarget, occDeltaPts: occTarget == null ? num(sp.occd, -20, 20) ?? 0 : 0 };
  const period = `${formatMonth(`${from}-01T12:00:00Z`)} – ${formatMonth(`${to}-01T12:00:00Z`)}`;

  return (
    <main>
      <PageHeader
        icon={<FlaskConical />}
        title="What-if scenarios"
        description="Change rent, occupancy and operating expenses to see the effect on annual NOI for each property."
        meta={<><span>{session.actor.scope.label}</span><span>Baseline: trailing 12 months, {period}</span></>}
        actions={<Button asChild variant="outline" size="sm"><Link href="/app/properties">Property comparison</Link></Button>}
      />
      <PageBody>
        <Simulator key={`${scope.kind}:${property ?? metro ?? ""}`} baselines={rows} initialScope={scope} initialLevers={levers} period={period} />
      </PageBody>
    </main>
  );
}
