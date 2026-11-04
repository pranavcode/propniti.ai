import Link from "@/components/Link";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/app/states";
import { portalCtx } from "@/extensions/owners/portal/context";
import { ownerEntities } from "@/extensions/owners/portal/owner-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { monthLabel, periodsOf, statementOf } from "@/extensions/owners/statements";
import { StatementView } from "@/extensions/owners/ui/StatementView";

type Props = { searchParams: Promise<{ entity?: string; period?: string }> };

// The owner's monthly statements as documents (print or save as PDF), with "Explain" on every line.
export default async function OwnerStatements({ searchParams }: Props) {
  const c = await portalCtx("owner");
  if (!c) return null;
  const sp = await searchParams;
  const ents = await ownerEntities(c);
  if (!ents.length) return <EmptyState title="No statements yet" description="Statements appear here after your first full month." />;
  const entity = ents.find((e) => e.id === sp.entity) ?? ents[0];
  const periods = await periodsOf(c, entity.id);
  const closed = periods.filter((p) => p.closed);
  const period = periods.find((p) => p.period === sp.period)?.period ?? closed[0]?.period ?? periods[0].period;
  const st = await statementOf(c, entity.id, period);
  const href = (p: string, e = entity.id) => `/portal/owner/statements?entity=${e}&period=${p}`;
  return (
    <>
      <PortalTitle title="Statements" description="Your monthly owner statement: what came in, what was spent and what was paid to you. Tap Explain on any line to see how it was worked out." />
      {ents.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Entities">
          {ents.map((e) => <Link key={e.id} href={`/portal/owner/statements?entity=${e.id}`} aria-current={e.id === entity.id ? "page" : undefined} className={cn("rounded-md border px-2.5 py-1 text-[12.5px]", e.id === entity.id ? "border-primary/40 bg-primary/[0.07] font-medium text-primary" : "bg-card")}>{e.name}</Link>)}
        </div>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Statement months" className="overflow-x-auto rounded-xl border bg-card print:hidden">
          <ul className="flex gap-1 p-1.5 lg:flex-col">
            {periods.slice(0, 19).map((p) => (
              <li key={p.period} className="shrink-0">
                <Link href={href(p.period)} aria-current={p.period === period ? "page" : undefined}
                  className={cn("flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-[13px] hover:bg-muted", p.period === period && "bg-primary/[0.08] font-medium text-primary")}>
                  <span>{p.closed ? monthLabel(p.period) : "This month (open)"}</span>
                  {p.amount_cents != null && <span className="hidden text-[12px] text-muted-foreground tabular-nums lg:inline">${Math.round(p.amount_cents / 100).toLocaleString("en-US")}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {st ? <StatementView st={st} explainUrl="/portal/owner/statements/explain" mode="owner" /> : <EmptyState title="No statement for this month" description="Pick another month." />}
      </div>
    </>
  );
}
