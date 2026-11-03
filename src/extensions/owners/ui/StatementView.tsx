"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Printer, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AIBadge } from "@/components/app/ai";
import { StatusBadge } from "@/components/app/display";
import type { ExplainReply } from "../explain";
import type { Statement } from "../statements";
import { useShellMaybe } from "@/components/app/shell/context";
import { ASK_EVENT } from "../portal/ui/PortalAssistant";

const usd = (cents: number) => formatMoney(cents / 100);
const month = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

// One statement as a document: lines with per-property detail, each with "Explain this line".
// Staff see links into the records and the distribute / fix actions; owners see a print view.
export function StatementView({ st, explainUrl, mode, canDistribute, canFix }: {
  st: Statement;
  explainUrl: string;
  mode: "staff" | "owner";
  canDistribute?: boolean;
  canFix?: boolean;
}) {
  const shell = useShellMaybe();
  // Staff follow-ups go to the assistant dock; the portals listen for this event.
  const onAsk = (q: string) => (shell ? shell.assistant.ask(q, { entity: "owner_entities", id: st.entity.id, title: st.entity.name }) : window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: q })));
  const [open, setOpen] = useState<string | null>(null);
  const payout = st.lines.find((l) => l.key === "distribution");
  return (
    <article className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_oklch(0_0_0/0.04)] print:border-0 print:shadow-none" aria-label={`Statement for ${month(st.period)}`}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b bg-muted/30 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">Owner statement · {month(st.period)}</p>
          <h2 className="mt-1 text-[17px] font-semibold tracking-tight text-balance">{st.entity.name}</h2>
          <p className="text-[12.5px] text-muted-foreground">Prepared for {st.entity.owner_name} by Summit Residential Partners</p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {st.closed
            ? <StatusBadge value={st.distribution?.status === "Pending" ? "On its way" : "Paid"} tone={st.distribution?.status === "Pending" ? "info" : "success"} />
            : <StatusBadge value="Open" tone="warning" label="Open · not yet distributed" />}
          {st.issue?.status === "open" && <StatusBadge value="Data issue" tone="danger" label="Data Health: needs review" />}
          {mode === "owner" && (
            <Button variant="ghost" size="sm" className="print:hidden" onClick={() => window.print()}><Printer />Print or save PDF</Button>
          )}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-4">
        {[
          ["Income", st.totals.rent_cents + st.totals.other_cents],
          ["Expenses", st.totals.vendor_cents],
          ["Management fee", st.totals.fee_cents],
          [st.closed ? "Distributed" : "Available now", payout?.amount_cents ?? 0],
        ].map(([label, v]) => (
          <div key={label as string} className="bg-card px-5 py-3">
            <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-[17px] font-semibold tabular-nums">{usd(v as number)}</dd>
          </div>
        ))}
      </dl>

      <table className="w-full text-[13px]">
        <caption className="sr-only">Statement lines</caption>
        <thead>
          <tr className="border-b text-[11.5px] text-muted-foreground">
            <th scope="col" className="py-2 pl-3 text-left font-medium sm:px-5">Line</th>
            <th scope="col" className="px-2 py-2 text-right font-medium sm:px-5">Amount</th>
            <th scope="col" className="w-px px-3 py-2 print:hidden"><span className="sr-only">Explain</span></th>
          </tr>
        </thead>
        <tbody>
          {st.lines.map((l) => {
            const expandable = !!l.children?.length;
            const isOpen = open === l.key;
            const total = l.key === "distribution";
            return (
              <Fragment key={l.key}>
                <tr className={cn("border-b align-top", total && "bg-muted/40 font-semibold", l.key === "gap" && "bg-tone-danger/5")}>
                  <td className="py-2.5 pr-2 pl-3 sm:px-5">
                    <div className="flex items-start gap-1.5">
                      {expandable ? (
                        <button type="button" onClick={() => setOpen(isOpen ? null : l.key)} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} detail for ${l.label}`}
                          className="mt-0.5 rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none print:hidden">
                          <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
                        </button>
                      ) : <span className="w-3.5 shrink-0 print:hidden" />}
                      <div className="min-w-0">
                        <p className={cn(l.key === "gap" && "text-tone-danger")}>{l.label}</p>
                        {l.detail && <p className="text-[11.5px] font-normal text-muted-foreground">{l.detail}</p>}
                        {l.key === "gap" && canFix && st.distributionId && <FixGap distributionId={st.distributionId} amount={l.amount_cents} />}
                      </div>
                    </div>
                  </td>
                  <td className={cn("px-2 py-2.5 text-right tabular-nums whitespace-nowrap sm:px-5", l.sign < 0 && !total && "text-muted-foreground")}>
                    {l.sign < 0 && !total ? `(${usd(l.amount_cents)})` : usd(l.amount_cents)}
                  </td>
                  <td className="py-2 pr-2 pl-0 sm:px-3 print:hidden">
                    <ExplainButton url={`${explainUrl}?entity=${st.entity.id}&period=${st.period}&line=${l.key}`} label={l.label} onAsk={onAsk} tour={l.key === "rent"} />
                  </td>
                </tr>
                {isOpen && l.children!.map((c) => (
                  <tr key={c.label} className="border-b bg-muted/20 text-[12.5px]">
                    <td className="py-1.5 pr-5 pl-12">{mode === "staff" && c.href ? <a href={c.href} className="hover:text-primary hover:underline">{c.label}</a> : c.label}</td>
                    <td className="px-5 py-1.5 text-right tabular-nums text-muted-foreground">{usd(c.amount_cents)}</td>
                    <td className="print:hidden" />
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <footer className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[11.5px] text-muted-foreground">
        <p>
          {st.totals.items.toLocaleString("en-US")} trust account movements
          {st.distribution ? `, paid ${st.distribution.paid_on} (transfer ${st.distribution.transfer_id})` : " since the last distribution"}.
          {" "}Every figure comes from the operating trust ledger.
        </p>
        {canDistribute && !st.closed && <DistributeButton entityId={st.entity.id} entityName={st.entity.name} amount={payout?.amount_cents ?? 0} />}
      </footer>
    </article>
  );
}

function ExplainButton({ url, label, onAsk, tour }: { url: string; label: string; onAsk: (q: string) => void; tour?: boolean }) {
  const [data, setData] = useState<ExplainReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    if (data || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { cache: "no-store" });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? "Couldn't explain this line");
      setData(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't explain this line");
    } finally {
      setLoading(false);
    }
  };
  return (
    <Popover onOpenChange={(o) => o && load()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="text-tone-ai hover:text-tone-ai" aria-label={`Explain ${label}`} data-tour={tour ? "explain-line" : undefined}>
          <Sparkles /><span className="max-sm:sr-only">Explain</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,400px)] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2.5">
          <p className="text-[12.5px] font-semibold">{label}</p>
          {data && <AIBadge source={data.source} model={data.model} size="xs" />}
        </div>
        <div className="space-y-3 px-3.5 py-3" aria-live="polite">
          {loading && <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Looking up the transfers behind this line…</p>}
          {error && <p className="text-[12.5px] text-tone-danger">{error}</p>}
          {data && (
            <>
              <p className="text-[13px] leading-relaxed text-pretty">{data.text}</p>
              <div>
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground"><Search className="size-3" />Looked up</p>
                <ol className="space-y-1 border-l pl-3">
                  {data.trace.map((t, i) => (
                    <li key={i} className="text-[11.5px]">
                      <span className="font-medium">{t.label}: </span>
                      {t.href ? <a href={t.href} className="text-muted-foreground hover:text-primary hover:underline">{t.detail}</a> : <span className="text-muted-foreground">{t.detail}</span>}
                    </li>
                  ))}
                </ol>
              </div>
              {(
                <Button variant="outline" size="sm" className="w-full" onClick={() => onAsk(`About my ${label.toLowerCase()} line: ${data.text.slice(0, 160)} What else should I know?`)}>
                  <Sparkles className="text-tone-ai" />Ask a follow-up
                </Button>
              )}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

async function runAction(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const out = res ? await res.json().catch(() => ({})) : {};
  if (!res || !res.ok) throw new Error(out.error ?? "Nothing was changed. Try again.");
  return out as { message?: string };
}

function DistributeButton({ entityId, entityName, amount }: { entityId: string; entityName: string; amount: number }) {
  const router = useRouter();
  // One key per statement view: a double click or a retry after a timeout pays once.
  const [key] = useState(() => crypto.randomUUID().replace(/-/g, ""));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const out = await runAction(`/api/e/owner_entities/${entityId}/actions/owner_entities.distribute`, { idempotencyKey: key });
      toast.success(out.message ?? "Distribution sent");
      setConfirm(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nothing was sent");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" data-tour="distribute" disabled={amount <= 0} onClick={() => setConfirm(true)}>Send {usd(amount)} distribution</Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send {usd(amount)} to {entityName}?</DialogTitle>
            <DialogDescription>The money moves by ACH from the operating trust and arrives in 1–2 business days. This statement closes and a new one opens. If anything posted since you opened this page, the send is refused and nothing moves.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button disabled={busy} onClick={go}>{busy ? "Sending…" : "Send distribution"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FixGap({ distributionId, amount }: { distributionId: string; amount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID().replace(/-/g, ""));
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md border border-tone-ai/25 bg-tone-ai/[0.05] px-2 py-1.5 text-[12px] font-normal print:hidden">
      <Sparkles className="size-3.5 text-tone-ai" />
      <span>AI fix: pay the owner the missing {usd(amount)} and close the issue. Needs your approval.</span>
      <Button size="xs" variant="outline" disabled={busy} onClick={async () => {
        setBusy(true);
        try {
          const out = await runAction(`/api/e/owner_distributions/${distributionId}/actions/owner_distributions.pay_rounding_cent`, { idempotencyKey: key });
          toast.success(out.message ?? "Paid");
          router.refresh();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Nothing was paid");
        } finally {
          setBusy(false);
        }
      }}>{busy ? "Paying…" : `Approve and pay ${usd(amount)}`}</Button>
    </div>
  );
}
