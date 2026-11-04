import Link from "@/components/Link";
import { Receipt } from "lucide-react";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { effective } from "@/server/query";
import { Money } from "@/components/app/display";
import { registerWidget, type WidgetProps } from "../widgets";

// Payables card for the property manager's and maintenance supervisor's homes: bills at their
// properties waiting on approval or payment, and the ones past due.
async function ApSummary({ actor }: WidgetProps) {
  const { db } = getPlatform();
  const { ws } = await currentSession();
  const ids = actor.propertyIds;
  const scope = ids === "all" ? "" : " AND b.property_id IN (SELECT value FROM json_each(?))";
  const r = await db
    .prepare(`SELECT b.status, count(*) AS n, sum(b.amount_cents) AS c, sum(b.due_on < coalesce((SELECT value FROM meta WHERE key = 'as_of'), date('now'))) AS late
      FROM ${effective("bills", ws)} b WHERE b.status IN ('Pending approval', 'Approved')${scope} GROUP BY b.status`)
    .bind(...(ids === "all" ? [] : [JSON.stringify(ids)]))
    .all<{ status: string; n: number; c: number; late: number }>()
    .catch(() => ({ results: [] as { status: string; n: number; c: number; late: number }[] }));
  const row = (s: string) => r.results.find((x) => x.status === s);
  const late = r.results.reduce((s, x) => s + Number(x.late ?? 0), 0);
  return (
    <section className="flex h-full flex-col rounded-lg border bg-card">
      <header className="flex items-center gap-2 border-b px-3 py-2"><Receipt className="size-4 text-muted-foreground" /><h2 className="text-[13px] font-semibold">Vendor bills</h2>
        <Link href="/app/payables/bills" className="ml-auto text-[12px] text-primary hover:underline">All bills</Link></header>
      <dl className="grid flex-1 grid-cols-3 divide-x">
        {[["Waiting for approval", "Pending approval", "/app/payables/bills?view=to-approve"], ["Approved, not paid", "Approved", "/app/payables/bills?view=ready-to-pay"]].map(([label, s, href]) => (
          <Link key={s} href={href} className="px-3 py-2.5 hover:bg-muted/40">
            <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-[18px] font-semibold tabular-nums">{row(s)?.n ?? 0}</dd>
            <dd className="text-[12px] text-muted-foreground"><Money value={row(s)?.c ?? 0} cents style="compact" /></dd>
          </Link>
        ))}
        <Link href="/app/payables/bills?view=past-due" className="px-3 py-2.5 hover:bg-muted/40">
          <dt className="text-[11.5px] text-muted-foreground">Past due</dt>
          <dd className={late ? "mt-0.5 text-[18px] font-semibold tabular-nums text-tone-danger" : "mt-0.5 text-[18px] font-semibold tabular-nums"}>{late}</dd>
          <dd className="text-[12px] text-muted-foreground">Accounting pays these</dd>
        </Link>
      </dl>
    </section>
  );
}

registerWidget({ key: "payables.ap_summary", title: "Vendor bills", roles: ["property_manager", "maintenance_supervisor"], size: "md", component: ApSummary });
