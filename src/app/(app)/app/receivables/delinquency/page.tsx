import type { Metadata } from "next";
import { staffSession } from "@/extensions/receivables/staff";
import Link from "next/link";
import { ArrowRight, X } from "lucide-react";
import { can } from "@/entities";
import { Money } from "@/components/app/display";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { getPlatform } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { AS_OF } from "@/seed/constants";
import { agingByProperty, BUCKETS, delinquentLeases, type AgingRow, type BucketKey } from "@/extensions/receivables/queries";
import { PageHeader, Pager, toParams } from "@/extensions/receivables/ui/bits";

export const metadata: Metadata = { title: "Delinquency aging · Propniti" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const SIZE = 25;
const COLS = [
  { key: "b0_30", bucket: "0-30" }, { key: "b31_60", bucket: "31-60" }, { key: "b61_90", bucket: "61-90" }, { key: "b90p", bucket: "90+" },
] as const;
const chargesHref = (f: Record<string, string>) => `/app/receivables/charges?${new URLSearchParams({ ...f, "f.status": "Overdue" })}`;

export default async function DelinquencyPage({ searchParams }: Props) {
  const sp = toParams(await searchParams);
  const session = await staffSession();
  if (!can(session.actor.role, "read", "charges")) return <div className="p-6"><EmptyState title="Delinquency isn't part of your role" description="Switch role from your avatar menu to see this page as someone who works with it." action={{ label: "Go to your home", href: "/app" }} /></div>;
  const ctx = { db: getPlatform().db, ws: session.ws, actor: session.actor };
  const bucket = BUCKETS.find((b) => b.key === sp.get("bucket"))?.key as BucketKey | undefined;
  const props = await agingByProperty(ctx).catch((e) => (console.error("aging", e), null));
  const property = props?.find((p) => p.property_id === sp.get("property"))?.property_id;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const sort = sp.get("sort") === "days" ? "days" : "total";
  const drill = await delinquentLeases(ctx, { property, bucket, page, size: SIZE, sort }).catch((e) => (console.error("delinquent leases", e), null));

  const totals = props?.reduce((t, r) => ({ b0_30: t.b0_30 + r.b0_30, b31_60: t.b31_60 + r.b31_60, b61_90: t.b61_90 + r.b61_90, b90p: t.b90p + r.b90p, total: t.total + r.total, households: t.households + r.households }), { b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0, total: 0, households: 0 });
  const max = Math.max(1, ...(props ?? []).flatMap((r) => COLS.map((c) => r[c.key])));
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp);
    next.delete("page");
    for (const [k, v] of Object.entries(patch)) if (v == null) next.delete(k); else next.set(k, v);
    return `/app/receivables/delinquency${next.size ? `?${next}` : ""}#residents`;
  };
  const cellLabel = (r: AgingRow | null, b?: string) => [r?.name ?? "All properties", b ? BUCKETS.find((x) => x.key === b)?.label : "all ages"].join(", ");

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <PageHeader
        title="Delinquency aging"
        description={<>Past-due balances by property and days late, as of {AS_OF}. Each charge ages from its own due date. Click a cell for the residents in it; click a total for the charges behind it.</>}
      >
        <Button asChild><Link href="/app/receivables/collections">Work collections<ArrowRight data-icon="inline-end" /></Link></Button>
      </PageHeader>

      {!props ? <ErrorBanner title="Aging couldn't load" message="Refresh the page to try again." /> : props.length === 0 ? <EmptyState kind="table" title="Nobody is past due" description="Every charge in your properties is paid or not yet due." /> : (
        <section aria-labelledby="by-property" className="overflow-x-auto rounded-lg border">
          <h2 id="by-property" className="sr-only">Aging by property</h2>
          <table className="w-full min-w-[720px] text-[13px]">
            <thead className="bg-muted/60 text-[11.5px] text-muted-foreground">
              <tr>
                <th scope="col" className="w-[24%] px-3 py-2 text-left font-medium">Property</th>
                {BUCKETS.map((b) => <th key={b.key} scope="col" className="px-3 py-2 text-right font-medium">{b.label}</th>)}
                <th scope="col" className="px-3 py-2 text-right font-medium">Total past due</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Households</th>
              </tr>
            </thead>
            <tbody>
              {props.map((r) => (
                <tr key={r.property_id} className={cn("border-t", property === r.property_id && "bg-primary/[0.05]")}>
                  <th scope="row" className="max-w-0 px-3 py-1.5 text-left font-normal">
                    <Link href={`/app/properties/${r.property_id}`} className="block truncate font-medium hover:text-primary hover:underline">{r.name}</Link>
                    <span className="block text-[11.5px] text-muted-foreground">{r.metro} · {r.units} units</span>
                  </th>
                  {COLS.map((c) => {
                    const v = r[c.key];
                    const active = property === r.property_id && bucket === c.bucket;
                    return (
                      <td key={c.key} className="p-0.5 text-right">
                        {v > 0 ? (
                          <Link href={href({ property: r.property_id, bucket: c.bucket })} aria-label={`Residents: ${cellLabel(r, c.bucket)}`} aria-current={active ? "true" : undefined}
                            className={cn("relative block rounded px-2.5 py-1.5 tabular-nums hover:ring-1 hover:ring-primary/40", active && "ring-2 ring-primary")}>
                            <span aria-hidden className="absolute inset-0 rounded bg-tone-danger" style={{ opacity: 0.08 + (v / max) * 0.42 }} />
                            <span className="relative"><Money value={v} cents style="whole" tone="none" /></span>
                          </Link>
                        ) : <span className="block px-2.5 py-1.5 text-muted-foreground/50">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 text-right font-medium tabular-nums"><Link href={chargesHref({ "f.property_id": r.property_id })} className="hover:text-primary hover:underline"><Money value={r.total} cents style="whole" tone="none" /></Link></td>
                  <td className="px-3 text-right tabular-nums"><Link href={href({ property: r.property_id, bucket: null })} className="hover:text-primary hover:underline">{r.households}</Link></td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot className="border-t-2 bg-muted/40 font-semibold">
                <tr>
                  <th scope="row" className="px-3 py-2 text-left">All properties</th>
                  {COLS.map((c) => <td key={c.key} className="px-3 text-right tabular-nums"><Link href={chargesHref({ "f.aging": c.bucket })} className="hover:text-primary hover:underline"><Money value={totals[c.key]} cents style="whole" tone="none" /></Link></td>)}
                  <td className="px-3 text-right tabular-nums"><Link href={chargesHref({})} className="hover:text-primary hover:underline"><Money value={totals.total} cents style="whole" tone="none" /></Link></td>
                  <td className="px-3 text-right tabular-nums">{totals.households}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </section>
      )}

      <section id="residents" aria-labelledby="residents-h" className="flex flex-col gap-2 scroll-mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="residents-h" className="text-[14px] font-semibold">Delinquent residents</h2>
          {(property || bucket) && (
            <Link href={href({ property: null, bucket: null })} className="inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2 text-[12px] hover:bg-muted">
              {cellLabel(props?.find((p) => p.property_id === property) ?? null, bucket)}<X className="size-3" aria-label="Clear filter" />
            </Link>
          )}
          <span className="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground">
            Sort:
            <Link href={href({ sort: null })} aria-current={sort === "total" ? "true" : undefined} className={cn("rounded px-1.5 py-0.5", sort === "total" ? "bg-muted font-medium text-foreground" : "hover:text-foreground")}>Balance</Link>
            <Link href={href({ sort: "days" })} aria-current={sort === "days" ? "true" : undefined} className={cn("rounded px-1.5 py-0.5", sort === "days" ? "bg-muted font-medium text-foreground" : "hover:text-foreground")}>Days late</Link>
          </span>
        </div>
        {!drill ? <ErrorBanner title="Residents couldn't load" message="Refresh the page to try again." /> : drill.rows.length === 0 ? <EmptyState compact kind="filtered" title="No one in this cell" description="Choose another property or age bucket." /> : (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-[13px]">
                <thead className="bg-muted/60 text-[11.5px] text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-[26%] px-3 py-2 text-left font-medium">Resident</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Unit</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Past due</th>
                    {BUCKETS.map((b) => <th key={b.key} scope="col" className="hidden px-3 py-2 text-right font-medium lg:table-cell">{b.label}</th>)}
                    <th scope="col" className="px-3 py-2 text-right font-medium">Days late</th>
                    <th scope="col" className="px-3 py-2"><span className="sr-only">Ledger</span></th>
                  </tr>
                </thead>
                <tbody>
                  {drill.rows.map((r) => (
                    <tr key={r.lease_id} className="border-t hover:bg-muted/30">
                      <td className="max-w-0 px-3 py-1.5">
                        {r.resident_id ? <Link href={`/app/residents/${r.resident_id}`} className="block truncate font-medium hover:text-primary hover:underline">{r.household}</Link> : <span className="block truncate font-medium">{r.household}</span>}
                        <span className="block truncate text-[11.5px] text-muted-foreground">{r.lease_id} · {r.lease_status}{r.rent_cents ? <> · rent <Money value={r.rent_cents} cents style="whole" tone="none" /></> : null}</span>
                      </td>
                      <td className="px-3 text-muted-foreground">{r.property} #{r.unit}</td>
                      <td className="px-3 text-right font-medium tabular-nums"><Link href={chargesHref({ "f.lease_id": r.lease_id })} className="hover:text-primary hover:underline"><Money value={r.total} cents tone="none" /></Link></td>
                      {COLS.map((c) => <td key={c.key} className="hidden px-3 text-right tabular-nums text-muted-foreground lg:table-cell">{r[c.key] ? <Money value={r[c.key]} cents style="whole" tone="none" /> : "—"}</td>)}
                      <td className="px-3 text-right tabular-nums">{r.days_late}</td>
                      <td className="px-3 text-right"><Link href={`/app/receivables/ledger/${r.lease_id}`} className="whitespace-nowrap text-[12.5px] font-medium text-primary hover:underline">Ledger →</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} size={SIZE} total={drill.total} params={sp} base="/app/receivables/delinquency" />
          </>
        )}
      </section>
    </div>
  );
}
