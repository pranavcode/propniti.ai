import Link from "@/components/Link";
import { Plus } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { AIBadge } from "@/components/app/ai";
import { portalCtx, rows } from "@/extensions/owners/portal/context";
import { invoices } from "@/extensions/owners/portal/vendor-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { InvoiceForm } from "@/extensions/owners/portal/ui/vendor/InvoiceForm";
import { Pager } from "@/extensions/owners/portal/ui/vendor/Pager";

type Props = { searchParams: Promise<{ new?: string; wo?: string; page?: string }> };
const TONE: Record<string, "success" | "info" | "warning" | "neutral"> = { Paid: "success", "On its way": "info", "Awaiting approval": "warning" };

export default async function VendorInvoices({ searchParams }: Props) {
  const c = await portalCtx("vendor");
  if (!c) return null;
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [list, ready] = await Promise.all([
    invoices(c, page),
    sp.new ? rows<{ id: string; title: string; property: string; estimate_cents: number | null }>(c, `SELECT w.id, w.title, p.name AS property, w.estimate_cents FROM {work_orders} w JOIN {properties} p ON p.id = w.property_id
      WHERE w.vendor_id = ? AND w.status IN ('Scheduled', 'In progress', 'Completed', 'On hold') AND NOT EXISTS (SELECT 1 FROM {wo_events} e WHERE e.work_order_id = w.id AND e.kind = 'Submission') ORDER BY w.status = 'Completed' DESC, w.opened_at DESC LIMIT 50`, c.me) : Promise.resolve([]),
  ]);
  return (
    <>
      <PortalTitle title="Invoices" description={`Send an invoice for finished work and follow it to payment. ${list.unpaid_cents ? `$${(list.unpaid_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })} is waiting to be paid.` : "Nothing is waiting to be paid."}`}
        actions={!sp.new && <Button asChild><Link href="/portal/vendor/invoices?new=1"><Plus />Send an invoice</Link></Button>} />
      {sp.new && <div className="mb-5"><InvoiceForm me={c.me} jobs={ready} initialJob={sp.wo} /></div>}
      <section className="overflow-hidden rounded-xl border bg-card">
        {list.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead><tr className="border-b text-left text-[11.5px] text-muted-foreground"><th className="px-3 py-2 font-medium">Invoice</th><th className="px-3 py-2 font-medium">Job</th><th className="px-3 py-2 font-medium">Sent</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 text-right font-medium">Amount</th></tr></thead>
              <tbody>
                {list.rows.map((r, i) => (
                  <tr key={`${r.invoice_number}-${i}`} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{r.invoice_number}{r.source === "live" && <AIBadge source="live" size="xs" className="ml-1.5" />}</td>
                    <td className="px-3 py-2"><span className="block max-w-72 truncate">{r.title}</span><span className="text-[12px] text-muted-foreground">{r.work_order_id ?? "—"} · {r.property}</span></td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{formatDate(r.at)}</td>
                    <td className="px-3 py-2"><StatusBadge value={r.status} tone={TONE[r.status] ?? "neutral"} /></td>
                    <td className="px-3 py-2 text-right"><Money value={Number(r.total_cents)} cents /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="p-4"><EmptyState kind="documents" title="No invoices yet" description="Invoices you send for finished jobs show up here with their payment status." compact /></div>}
        <Pager base="/portal/vendor/invoices" params={{}} page={page} size={list.size} total={list.total} />
      </section>
    </>
  );
}
