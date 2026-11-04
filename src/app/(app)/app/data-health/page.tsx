import { HeartPulse } from "lucide-react";
import Link from "@/components/Link";
import { PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { DataHealthCenter } from "@/ai/ui/DataHealthCenter";
import { pageData } from "@/ai/ui/server";
import { dataHealth, issuesPage } from "@/ai/views";

export const metadata = { title: "Data health · Propniti" };

// Data Health center: a score per property and module, the open issues with before/after fixes,
// one-click apply for safe fixes and a person's review for money, fraud and legal ones.
export default async function DataHealthPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { data } = await pageData();
  const filters = { severity: sp.severity, rule: sp.rule, property: sp.property, entity: sp.entity };
  const [health, issues] = await Promise.all([dataHealth(data), issuesPage(data, { ...filters, page: Number(sp.page) || 1 })]);
  return (
    <main>
      <PageHeader
        icon={<HeartPulse />}
        title="Data health"
        description="Know your portfolio is right. Rules check the records money decisions depend on; each problem comes with a fix, its reasons and a confidence, and every fix is logged with before and after."
        actions={<Button asChild size="sm" variant="outline"><Link href="/app/ai/activity?agent=data_health">Data Health Agent runs</Link></Button>}
      />
      <div className="mt-5">
        <DataHealthCenter health={JSON.parse(JSON.stringify(health))} issues={JSON.parse(JSON.stringify(issues))} filters={filters} />
      </div>
    </main>
  );
}
