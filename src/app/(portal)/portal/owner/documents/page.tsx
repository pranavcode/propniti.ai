import Link from "@/components/Link";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/display";
import { portalCtx } from "@/extensions/owners/portal/context";
import { ownerDistributions, ownerDocuments } from "@/extensions/owners/portal/owner-data";
import { PortalTitle } from "@/extensions/owners/portal/ui/PortalTitle";
import { monthLabel } from "@/extensions/owners/statements";
import { safeHref } from "@/lib/links";

// Same-site or https links only, the rule the staff documents panel follows.
const safe = (u: string) => safeHref(u) ?? "#";

export default async function OwnerDocuments() {
  const c = await portalCtx("owner");
  if (!c) return null;
  const [docs, dists] = await Promise.all([ownerDocuments(c), ownerDistributions(c, 12)]);
  return (
    <>
      <PortalTitle title="Documents" description="Agreements, budgets, tax forms and reports, plus every monthly statement." />
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="docs-h" className="rounded-xl border bg-card">
          <h2 id="docs-h" className="border-b px-4 py-3 text-[14px] font-semibold">Agreements and reports</h2>
          {docs.length ? (
            <ul className="divide-y">
              {docs.map((d) => (
                <li key={d.id}>
                  <a href={safe(d.url)} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{d.name}</span><span className="block text-[12px] text-muted-foreground">{d.doc_type ?? "Document"} · {d.uploaded_at.slice(0, 10)}</span></span>
                  </a>
                </li>
              ))}
            </ul>
          ) : <div className="p-4"><EmptyState kind="documents" title="No documents shared yet" description="Your management agreement, budgets and tax forms will appear here." compact /></div>}
        </section>
        <section aria-labelledby="st-h" className="rounded-xl border bg-card">
          <h2 id="st-h" className="border-b px-4 py-3 text-[14px] font-semibold">Monthly statements</h2>
          <ul className="divide-y">
            {dists.map((d) => (
              <li key={d.id}>
                <Link href={`/portal/owner/statements?entity=${d.owner_entity_id}&period=${d.period}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50">
                  <FileText className="size-4 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">Owner statement, {monthLabel(d.period)}</span><span className="block truncate text-[12px] text-muted-foreground">{d.entity}</span></span>
                  <StatusBadge value="Paid" tone="success" label={`$${(d.amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`} dot={false} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
