import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { can } from "@/entities";
import { currentSession } from "@/auth/session";
import { PageBody, PageHeader } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { getPlatform } from "@/lib/platform";
import { effective } from "@/server/query";
import { Bva } from "@/extensions/accounting/budget/Bva";
import { BvaFilters } from "@/extensions/accounting/budget/BvaFilters";

export const metadata: Metadata = { title: "Budget vs actual · Propniti" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function BudgetVsActualPage({ searchParams }: Props) {
  const session = await currentSession();
  if (!can(session.actor.role, "read", "budgets")) {
    return <div className="p-6"><EmptyState title="Budgets aren't part of your role" description="Switch role from your avatar menu to see budget vs actual as an accountant or manager." action={{ label: "Go to your home", href: "/app" }} /></div>;
  }
  const sp = await searchParams;
  const db = getPlatform().db;
  const ids = session.actor.propertyIds;
  const props = (await db.prepare(`SELECT id, name FROM ${effective("properties", session.ws)} WHERE 1 = 1${ids === "all" ? "" : " AND id IN (SELECT value FROM json_each(?))"} ORDER BY name`).bind(...(ids === "all" ? [] : [JSON.stringify(ids)])).all<{ id: string; name: string }>()).results.map((r) => ({ id: String(r.id), name: String(r.name) }));
  const years = (await db.prepare(`SELECT DISTINCT year FROM ${effective("budgets", session.ws)} ORDER BY year DESC`).all<{ year: number }>()).results.map((r) => Number(r.year));
  const year = years.includes(Number(one(sp.year))) ? Number(one(sp.year)) : years[0] ?? 2026;
  const property = props.some((p) => p.id === one(sp.property)) ? one(sp.property) : null;
  const type = one(sp.type) === "Income" ? "Income" : "Expense";
  const params = Object.fromEntries(Object.entries({ property: property ?? "", year: one(sp.year), type: one(sp.type) }).filter(([, v]) => v));

  return (
    <div>
      <PageHeader icon={<BarChart3 />} title="Budget vs actual"
        description="Every property against its approved budget, by GL account and month. Click a cell for the journal entries behind it, or ✦ to have the variance explained."
        meta={<><span>{session.actor.scope.label}</span><span>Actuals through the last closed month</span></>}>
        <BvaFilters properties={props} years={years.length ? years : [year]} property={property ?? ""} year={year} type={type} />
      </PageHeader>
      <PageBody>
        <Bva session={session} year={year} type={type} property={property} explain={one(sp.explain) || null} params={params} />
      </PageBody>
    </div>
  );
}
