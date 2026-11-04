import type { Metadata } from "next";
import Link from "@/components/Link";
import { FileStack } from "lucide-react";
import "@/entities";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { PageBody, PageHeader } from "@/components/app/page";
import { KpiCard, KpiRow } from "@/components/app/dashboard";
import { AIBadge } from "@/components/app/ai";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { prepare1099 } from "@/extensions/payables/tax";
import { Prep1099 } from "@/extensions/payables/ui/Prep1099";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "1099 preparation · Propniti" };

const YEARS = [2026, 2025];

export default async function Page({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const session = await currentSession();
  if (!["accountant", "principal"].includes(session.actor.role)) {
    return <main className="p-6"><EmptyState kind="table" title="1099 preparation isn't part of your role" description="Switch to the accountant from your avatar menu to prepare 1099s." action={{ label: "Go to your home", href: "/app" }} /></main>;
  }
  const sp = await searchParams;
  const year = YEARS.includes(Number(sp.year)) ? Number(sp.year) : YEARS[0];
  const { rows, threshold, excludedVendors } = await prepare1099(getPlatform().db, session.ws, session.actor, year);
  const reportable = rows.filter((r) => r.state === "Reportable");
  const missingW9 = reportable.filter((r) => !r.w9).length;
  const formsCreated = reportable.filter((r) => r.form_id).length;
  const near = rows.filter((r) => r.state === "Near threshold").length;

  return (
    <main>
      <PageHeader
        icon={<FileStack />}
        title="1099 preparation"
        description={`Payments to 1099 vendors from each owner entity's trust account in ${year}. Each payer files its own 1099-NEC for every vendor it paid $${threshold.toLocaleString("en-US")} or more.`}
        meta={<><span>{excludedVendors} vendors excluded as corporations or utilities (not 1099 vendors)</span><AIBadge source="rules" /></>}
        actions={<>
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Tax year">
            {YEARS.map((y) => <Link key={y} href={`?year=${y}`} aria-current={y === year ? "page" : undefined} className={cn("rounded px-2.5 py-1 text-[12.5px] tabular-nums", y === year ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>{y}</Link>)}
          </div>
          <Button asChild size="sm" variant="outline"><Link href={`/app/payables/1099s?f.year=${year}`}>Forms</Link></Button>
        </>}
      />
      <PageBody>
        <KpiRow className="xl:grid-cols-4">
          <KpiCard label="Reportable pairs" format="count" value={reportable.length} footnote={`Vendor × payer at or over $${threshold.toLocaleString("en-US")}`} />
          <KpiCard label="Forms created" format="count" value={formsCreated} footnote={`of ${reportable.length} reportable`} href={`/app/payables/1099s?f.year=${year}`} />
          <KpiCard label="Missing W-9" format="count" value={missingW9} goodWhen="down" footnote="Reportable vendors without a W-9" href="/app/maintenance/vendors?view=no-w9" />
          <KpiCard label="Near threshold" format="count" value={near} goodWhen="down" footnote="Within 15% below; watch December payments" />
        </KpiRow>
        <Prep1099 rows={rows} year={year} />
        <p className="text-[12px] text-muted-foreground">Threshold: $600 for payments through 2025, $2,000 from 2026. Amounts are vendor payouts that cleared or are in transit; voided and returned payments are excluded. Card and third-party network payments are reported on 1099-K by the processor and aren&apos;t included here.</p>
      </PageBody>
    </main>
  );
}
