import Link from "@/components/Link";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { can } from "@/entities";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/display";
import { leasingCtx, renewalDrafts, renewalHistory, renewals } from "@/extensions/leasing/data";
import { PrepareDrafts } from "@/extensions/leasing/ui/BulkRenewals";
import { RenewalPanel, type Selected } from "@/extensions/leasing/ui/RenewalsWorkbench";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata = { title: "Renewals · Propniti" };

type Props = { searchParams: Promise<Record<string, string | undefined>> };
const WINDOWS = [30, 60, 90, 120];
const STATUSES = ["No offer", "Draft", "Sent", "Countered", "Accepted", "Declined"];
const SIZE = 25;
const WRITERS = ["principal", "regional_manager", "property_manager", "leasing_agent", "broker"];

// Renewals workbench: leases ending soon on the left, the selected lease's offer flow on the right.
export default async function RenewalsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const c = await leasingCtx();
  if (!can(c.actor.role, "read", "renewal_offers")) {
    return <PageBody><EmptyState title="Renewals aren't part of your role" description="Switch role to a leasing agent or property manager to work renewals." action={{ label: "Go to your home", href: "/app" }} /></PageBody>;
  }
  const window = WINDOWS.includes(Number(sp.window)) ? Number(sp.window) : 90;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const [data, drafts] = await Promise.all([renewals(c, { window, status, page, size: SIZE }), WRITERS.includes(c.actor.role) ? renewalDrafts(c, window) : Promise.resolve([])]);
  const total = status ? data.counts[status] ?? 0 : data.total;
  const pages = Math.max(1, Math.ceil(total / SIZE));
  const sel = data.rows.find((r) => r.leaseId === sp.lease) ?? data.rows.find((r) => r.status === "No offer" || r.status === "Draft") ?? data.rows[0];
  const history = sel ? await renewalHistory(c, sel.leaseId) : [];
  const href = (patch: Record<string, string | number | undefined>) => {
    const q = new URLSearchParams();
    const next = { window, status, page, lease: sel?.leaseId, ...patch };
    for (const [k, v] of Object.entries(next)) if (v != null && v !== "" && !(k === "page" && v === 1) && !(k === "window" && v === 90)) q.set(k, String(v));
    const s = q.toString();
    return `/app/leasing/renewals${s ? `?${s}` : ""}`;
  };

  const selected: Selected | null = sel ? {
    leaseId: sel.leaseId, resident: sel.resident, property: sel.property, propertyId: sel.propertyId, unit: sel.unit, unitType: sel.unitType, endOn: sel.endOn, daysLeft: sel.daysLeft, rent: sel.rent, market: sel.market,
    offer: sel.offer ? { id: sel.offer.id, status: sel.offer.status, rent: sel.offer.rent, term: Number(history[0]?.term_months ?? 12), version: sel.offer.version, sentAt: sel.offer.sentAt } : null,
    history: history.map((h) => ({ id: String(h.id), version: Number(h.version), status: String(h.status), rent: Number(h.rent_cents) / 100, sentAt: (h.sent_at as string) ?? null, respondedAt: (h.responded_at as string) ?? null })),
    suggestion: sel.agent?.rentCents ? { rent: sel.agent.rentCents / 100, reasons: sel.agent.why.map((w) => ({ direction: /under|on time|toward market/i.test(w) ? "+" as const : /capped|late|balance|returned/i.test(w) ? "-" as const : "=" as const, text: w })), confidence: sel.agent.confidence, runId: sel.agent.runId, source: sel.agent.source, model: sel.agent.model ?? undefined, title: sel.agent.title } : null,
    canEdit: WRITERS.includes(c.actor.role),
  } : null;

  return (
    <>
      <PageHeader
        title="Renewals"
        description="Leases ending soon. The Renewals agent proposes a rent with its reasons; you accept or edit it, then send an AI-drafted offer."
        meta={<><span>{data.total} lease{data.total === 1 ? "" : "s"} ending in {window} days</span><span>{data.counts["No offer"] ?? 0} without an offer</span><span>{c.actor.scope.label}</span></>}
        actions={<Button asChild size="sm" variant="outline"><Link href="/app/leasing/renewal-offers">All offers</Link></Button>}
      >
        <div className="flex flex-wrap items-center gap-3">
          <nav aria-label="Offer status" className="flex gap-1 overflow-x-auto">
            {[undefined, ...STATUSES].map((st) => (
              <Link key={st ?? "all"} href={href({ status: st, page: 1, lease: undefined })} aria-current={st === status ? "page" : undefined}
                className={cn("rounded-md px-2.5 py-1 text-[12.5px] whitespace-nowrap", st === status ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}>
                {st ?? "All"} <span className="tabular-nums text-muted-foreground">{st ? data.counts[st] ?? 0 : data.total}</span>
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1 text-[12px] text-muted-foreground">
            Ending within
            {WINDOWS.map((w) => <Link key={w} href={href({ window: w, page: 1, lease: undefined })} aria-current={w === window ? "page" : undefined} className={cn("rounded px-1.5 py-0.5 tabular-nums", w === window ? "bg-primary/10 font-medium text-primary" : "hover:text-foreground")}>{w}d</Link>)}
          </div>
        </div>
      </PageHeader>
      <PageBody>
        <PrepareDrafts drafts={drafts} />
        {!data.rows.length ? (
          <EmptyState title={status ? `No leases with status “${status}”` : "No leases ending in this window"} description="Try a longer window or another status." action={{ label: "Show all", href: "/app/leasing/renewals" }} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
            <div className="min-w-0 overflow-hidden rounded-lg border bg-card" data-tour="renewals-table">
              <div className="overflow-x-auto">
                <Table className="text-[13px]">
                  <TableHeader className="bg-muted/40 text-left text-[12px] text-muted-foreground">
                    <TableRow><TableHead className="px-3 py-2 font-medium">Resident</TableHead><TableHead className="px-3 py-2 font-medium">Ends</TableHead><TableHead className="px-3 py-2 text-right font-medium">Rent</TableHead><TableHead className="px-3 py-2 text-right font-medium">Market</TableHead><TableHead className="px-3 py-2 text-right font-medium">Suggested</TableHead><TableHead className="px-3 py-2 font-medium">Offer</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((r) => (
                      <TableRow key={r.leaseId} className={cn(r.leaseId === sel?.leaseId && "bg-primary/[0.06] hover:bg-primary/[0.08]")}>
                        <TableCell className="max-w-64 px-3 py-2">
                          <Link href={`${href({ lease: r.leaseId })}#renewal-panel`} className="block truncate font-medium hover:text-primary" aria-current={r.leaseId === sel?.leaseId ? "true" : undefined}>{r.resident}</Link>
                          <span className="block truncate text-[11.5px] text-muted-foreground">{r.property} · #{r.unit}</span>
                        </TableCell>
                        <TableCell className={cn("px-3 py-2 whitespace-nowrap tabular-nums", r.daysLeft <= 30 && "text-tone-warning")}>{r.endOn ? formatDate(r.endOn) : "Month-to-month"} <span className="text-[11.5px] text-muted-foreground">{r.endOn ? `${r.daysLeft}d` : ""}</span></TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums">{formatMoney(r.rent, "whole")}</TableCell>
                        <TableCell className="px-3 py-2 text-right text-muted-foreground tabular-nums">{r.market != null ? formatMoney(r.market, "whole") : "—"}</TableCell>
                        <TableCell className="px-3 py-2 text-right tabular-nums">{r.agent?.rentCents ? <span className="inline-flex items-center gap-1 text-tone-ai"><Sparkles className="size-3" />{formatMoney(r.agent.rentCents / 100, "whole")}</span> : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="px-3 py-2"><StatusBadge value={r.status} tone={r.status === "No offer" ? "warning" : undefined} />{r.offer && r.offer.status !== "Draft" ? <span className="ml-1.5 text-[11.5px] text-muted-foreground tabular-nums">{formatMoney(r.offer.rent, "whole")}</span> : null}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <footer className="flex items-center justify-between border-t px-3 py-2 text-[12px] text-muted-foreground">
                <span className="tabular-nums">{(page - 1) * SIZE + 1}–{Math.min(page * SIZE, total)} of {total}</span>
                <span className="flex gap-1">
                  <Button asChild={page > 1} size="icon-sm" variant="ghost" disabled={page <= 1} aria-label="Previous page">{page > 1 ? <Link href={href({ page: page - 1, lease: undefined })}><ChevronLeft data-icon="inline-start" /></Link> : <ChevronLeft data-icon="inline-start" />}</Button>
                  <Button asChild={page < pages} size="icon-sm" variant="ghost" disabled={page >= pages} aria-label="Next page">{page < pages ? <Link href={href({ page: page + 1, lease: undefined })}><ChevronRight data-icon="inline-start" /></Link> : <ChevronRight data-icon="inline-start" />}</Button>
                </span>
              </footer>
            </div>
            <aside id="renewal-panel" className="scroll-mt-16 self-start rounded-lg border bg-card p-4 xl:sticky xl:top-4">
              {selected ? <RenewalPanel key={selected.leaseId + (selected.offer?.id ?? "") + (selected.suggestion?.runId ?? "")} s={selected} /> : null}
            </aside>
          </div>
        )}
      </PageBody>
    </>
  );
}
