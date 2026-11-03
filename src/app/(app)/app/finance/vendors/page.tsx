import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, Users } from "lucide-react";
import "@/entities";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { effective } from "@/server/query";
import { PageBody, PageHeader } from "@/components/app/page";
import { Money, RelativeDate, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { threshold1099 } from "@/extensions/payables/tax";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Vendor payments · Propniti" };

type V = { id: string; company: string; trade: string; status: string; is_1099: number; w9_on_file: number; bank_last4: string; bank_changed_at: string | null; verified: number; paid_ytd: number; open_cents: number; open_n: number; last_paid: string | null };
const SORTS: Record<string, string> = { paid: "paid_ytd DESC", open: "open_cents DESC", name: "company ASC", bank: "bank_changed_at IS NULL, bank_changed_at DESC" };

// The finance view of vendors: what each was paid this year, what is still owed, 1099 and W-9
// status, and any bank change still waiting for verification (a payment hold).
export default async function Page({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const session = await currentSession();
  if (!["principal", "regional_manager", "accountant"].includes(session.actor.role)) {
    return <main className="p-6"><EmptyState kind="table" title="Vendor payments aren't part of your role" description="Switch to the accountant from your avatar menu." action={{ label: "Go to your home", href: "/app" }} /></main>;
  }
  const sort = (await searchParams).sort ?? "paid";
  const { db } = getPlatform();
  const ws = session.ws;
  const today = (await db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>())?.value ?? "2026-11-04";
  const year = Number(today.slice(0, 4));
  const ids = session.actor.propertyIds;
  const scope = ids === "all" ? "" : " AND x.property_id IN (SELECT value FROM json_each(?2))";
  const rows = (await db
    .prepare(`SELECT v.id, v.company, v.trade, v.status, v.is_1099, v.w9_on_file, v.bank_last4, v.bank_changed_at,
        (SELECT count(*) FROM ${effective("data_issues", ws)} di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = v.id AND di.status IN ('fixed', 'dismissed') AND di.fixed_at >= v.bank_changed_at) AS verified,
        coalesce((SELECT sum(x.amount_cents) FROM ${effective("transfers", ws)} x WHERE x.kind = 'Vendor payout' AND x.to_id = v.id AND x.status <> 'Returned' AND substr(x.created, 1, 4) = ?1${scope}), 0) AS paid_ytd,
        coalesce((SELECT sum(x.amount_cents) FROM ${effective("bills", ws)} x WHERE x.vendor_id = v.id AND x.status IN ('Draft', 'Pending approval', 'Approved')${scope}), 0) AS open_cents,
        (SELECT count(*) FROM ${effective("bills", ws)} x WHERE x.vendor_id = v.id AND x.status IN ('Draft', 'Pending approval', 'Approved')${scope}) AS open_n,
        (SELECT max(x.created) FROM ${effective("transfers", ws)} x WHERE x.kind = 'Vendor payout' AND x.to_id = v.id${scope}) AS last_paid
      FROM ${effective("vendors", ws)} v ORDER BY ${SORTS[sort] ?? SORTS.paid}`)
    .bind(String(year), ...(ids === "all" ? [] : [JSON.stringify(ids)]))
    .all<V>()).results;
  const t = threshold1099(year);
  const held = (v: V) => !!v.bank_changed_at && !v.verified && (Date.parse(today) - Date.parse(v.bank_changed_at.slice(0, 10))) / 86_400_000 <= 60;
  const th = (key: string, label: string, right = false) => (
    <th className={cn("px-3 py-2 font-medium", right ? "text-right" : "text-left")}>
      {SORTS[key] ? <Link href={`?sort=${key}`} className={cn("hover:text-foreground", sort === key && "text-foreground")}>{label}</Link> : label}
    </th>
  );

  return (
    <main>
      <PageHeader icon={<Users />} title="Vendor payments" description={`What each vendor was paid in ${year}, what is still owed, and their tax and bank status. Vendor records live under Maintenance → Vendors.`}
        meta={<><span>{rows.length} vendors</span><span>·</span><span>{rows.filter(held).length} on payment hold</span></>} />
      <PageBody>
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="max-h-[75vh] overflow-auto">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-muted/80 text-[12px] text-muted-foreground backdrop-blur">
                <tr className="border-b">
                  {th("name", "Vendor")}{th("", "Trade")}{th("paid", `Paid ${year}`, true)}{th("open", "Open bills", true)}{th("", "Last paid")}{th("", "1099")}{th("", "W-9")}{th("bank", "Bank details")}
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => (
                  <tr key={v.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-3 py-1.5"><Link href={`/app/maintenance/vendors/${v.id}?tab=bills`} className="font-medium hover:text-primary hover:underline">{v.company}</Link>{v.status !== "Active" && <StatusBadge value={v.status} className="ml-2" />}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{v.trade}</td>
                    <td className="px-3 py-1.5 text-right"><Money value={v.paid_ytd} cents /></td>
                    <td className="px-3 py-1.5 text-right">{v.open_n ? <Link href={`/app/payables/bills?f.vendor_id=${v.id}&f.status=Draft,Pending%20approval,Approved`} className="hover:underline"><Money value={v.open_cents} cents /> <span className="text-muted-foreground">({v.open_n})</span></Link> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-1.5">{v.last_paid ? <RelativeDate value={v.last_paid} mode="date" /> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-3 py-1.5">{!v.is_1099 ? <span className="text-muted-foreground">Exempt</span> : v.paid_ytd / 100 >= t ? <Link href="/app/finance/1099"><StatusBadge value="Reportable" tone="info" /></Link> : <span className="text-muted-foreground">Under ${t.toLocaleString("en-US")}</span>}</td>
                    <td className="px-3 py-1.5">{!v.is_1099 ? <span className="text-muted-foreground">—</span> : v.w9_on_file ? <span className="text-muted-foreground">On file</span> : <StatusBadge value="Missing" tone="danger" />}</td>
                    <td className="px-3 py-1.5">
                      {held(v)
                        ? <span className="inline-flex items-center gap-1 text-tone-danger"><ShieldAlert className="size-3.5" />Changed {v.bank_changed_at!.slice(0, 10)} · payments held</span>
                        : <span className="text-muted-foreground tabular-nums">••{v.bank_last4 || "—"}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PageBody>
    </main>
  );
}
