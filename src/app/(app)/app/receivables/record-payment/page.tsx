import type { Metadata } from "next";
import { staffSession } from "@/extensions/receivables/staff";
import Link from "@/components/Link";
import { Search } from "lucide-react";
import { can } from "@/entities";
import { Money } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { formatDate } from "@/lib/format";
import { getPlatform } from "@/lib/platform";
import { effective, type QueryCtx } from "@/server/query";
import { delinquentLeases, leaseLedger } from "@/extensions/receivables/queries";
import { PageHeader } from "@/extensions/receivables/ui/bits";
import { RecordPaymentButton } from "@/extensions/receivables/ui/RecordPayment";

export const metadata: Metadata = { title: "Record payment · Propniti" };

type Props = { searchParams: Promise<{ q?: string; property?: string }> };
type Hit = { lease_id: string; property_id: string; household: string; property: string; unit: string; status: string };

async function find(ctx: QueryCtx, q: string, property?: string): Promise<Hit[]> {
  const term = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const scope = ctx.actor.propertyIds === "all" ? "" : "AND l.property_id IN (SELECT value FROM json_each(?))";
  const res = await ctx.db
    .prepare(
      `SELECT l.id AS lease_id, l.property_id, h.name AS household, p.name AS property, u.number AS unit, l.status
       FROM ${effective("leases", ctx.ws)} AS l JOIN ${effective("households", ctx.ws)} AS h ON h.id = l.household_id
       JOIN ${effective("properties", ctx.ws)} AS p ON p.id = l.property_id LEFT JOIN ${effective("units", ctx.ws)} AS u ON u.id = l.unit_id
       WHERE (h.name LIKE ?1 ESCAPE '\\' OR l.id LIKE ?1 ESCAPE '\\' OR u.number = ?2
              OR l.household_id IN (SELECT r.household_id FROM ${effective("residents", ctx.ws)} AS r WHERE r.first_name || ' ' || r.last_name LIKE ?1 ESCAPE '\\'))
         AND l.status NOT IN ('Expired', 'Terminated') ${property ? "AND l.property_id = ?3" : ""} ${scope}
       ORDER BY h.name LIMIT 8`,
    )
    .bind(term, q, ...(property ? [property] : []), ...(ctx.actor.propertyIds === "all" ? [] : [JSON.stringify(ctx.actor.propertyIds)]))
    .all<Hit>();
  return res.results.map((r) => ({ ...r }));
}

export default async function RecordPaymentPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const session = await staffSession();
  if (!can(session.actor.role, "charges.record_payment", "charges")) return <div className="p-6"><EmptyState title="Recording payments isn't part of your role" description="Property managers and accountants record payments received in the office." action={{ label: "Go to your home", href: "/app" }} /></div>;
  const ctx: QueryCtx = { db: getPlatform().db, ws: session.ws, actor: session.actor };
  // "Record another" keeps the property of the payment just recorded (?property=).
  const property = sp.property && /^[A-Za-z0-9_-]{1,40}$/.test(sp.property) ? sp.property : undefined;
  const hits: Hit[] = q ? await find(ctx, q, property) : (await delinquentLeases(ctx, { property, page: 1, size: 6, sort: "days" })).rows.map((r) => ({ lease_id: r.lease_id, property_id: r.property_id, household: r.household, property: r.property, unit: r.unit, status: r.lease_status }));
  const propertyName = property ? hits[0]?.property ?? null : null;
  const ledgers = await Promise.all(hits.map(async (h) => ({ h, open: (await leaseLedger(ctx, h.lease_id)).rows.filter((r) => r.kind === "charge" && (r.open ?? 0) > 0 && r.status !== "Processing") })));

  return (
    <div className="flex max-w-4xl flex-col gap-4 p-4 md:p-6">
      <PageHeader title="Record payment" description="Find the resident, then record the check, money order or cash against the charge it pays. It's deposited to the property's trust account today. Partial payments are fine." />
      <form role="search" className="flex items-center gap-2 rounded-lg border bg-card px-3 focus-within:ring-2 focus-within:ring-ring/50">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <label htmlFor="rp-q" className="sr-only">Resident, unit or lease</label>
        {property && <input type="hidden" name="property" value={property} />}
        <input id="rp-q" name="q" defaultValue={q} autoFocus autoComplete="off" spellCheck={false} placeholder="Resident name, unit number or lease ID…" className="h-10 flex-1 bg-transparent text-[13.5px] outline-none" />
      </form>
      {property && (
        <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          {q ? "Searching" : "Showing"} {propertyName ?? "one property"} only.
          <Link href={q ? `/app/receivables/record-payment?q=${encodeURIComponent(q)}` : "/app/receivables/record-payment"} className="text-primary hover:underline">All your properties</Link>
        </p>
      )}
      {!q && <h2 className="text-[12.5px] font-medium text-muted-foreground">Longest overdue {property ? `at ${propertyName ?? "this property"}` : "in your properties"}</h2>}
      {ledgers.length === 0 ? (q
        ? <EmptyState compact kind="filtered" title={`No current lease matches “${q}”`} description="Try the last name, the unit number (412) or the lease ID (L-10001)." />
        : <EmptyState compact kind="table" title="No overdue balances in your properties" description="Search for a resident to record a payment against a charge that isn't due yet." />) : (
        <ul className="flex flex-col gap-3">
          {ledgers.map(({ h, open }) => (
            <li key={h.lease_id} className="rounded-lg border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
                <div className="text-[13px]"><span className="font-medium">{h.household}</span><span className="text-muted-foreground"> · {h.property} #{h.unit} · {h.lease_id} · {h.status}</span></div>
                <Link href={`/app/receivables/ledger/${h.lease_id}`} className="text-[12.5px] text-primary hover:underline">Ledger →</Link>
              </div>
              {open.length === 0 ? <p className="px-3 py-2.5 text-[12.5px] text-muted-foreground">Nothing open on this lease.</p> : (
                <table className="w-full text-[13px]">
                  <tbody>
                    {open.slice(0, 5).map((c) => (
                      <tr key={c.id} className="border-t first:border-0">
                        <td className="px-3 py-1.5"><Link href={c.href} className="font-medium hover:text-primary hover:underline">{c.description}</Link><span className="ml-2 text-[11.5px] text-muted-foreground">due {formatDate(c.date, "always")}</span></td>
                        <td className="px-3 text-right tabular-nums"><Money value={c.open ?? 0} cents tone="none" /> open</td>
                        <td className="w-40 px-3 py-1.5 text-right"><RecordPaymentButton size="xs" charge={{ id: c.id, description: c.description, open: (c.open ?? 0) / 100, due_on: c.date }} next={{ leaseId: h.lease_id, propertyId: h.property_id }} /></td>
                      </tr>
                    ))}
                  </tbody>
                  {open.length > 5 && (
                    <tfoot><tr className="border-t"><td colSpan={3} className="px-3 py-1.5 text-[12px] text-muted-foreground"><Link href={`/app/receivables/ledger/${h.lease_id}`} className="hover:text-foreground hover:underline">{open.length - 5} older open charges on the ledger →</Link></td></tr></tfoot>
                  )}
                </table>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
