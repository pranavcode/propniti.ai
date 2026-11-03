"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BadgeCheck, Check, ShieldAlert, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AIBadge, Confidence } from "@/components/app/ai";
import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

// The reconciliation workspace (tab accounting.reconcile): statement lines on the left, the ledger
// transfer each one matches on the right. AI suggestions carry their reasons and confidence and are
// accepted one by one or in bulk; unexplained deposits are flagged as data-health issues.

export type ReconLineJson = {
  id: string; posted_on: string; description: string; amount: number; status: "Matched" | "Suggested" | "Unmatched";
  confidence: number; why: string[]; unexplained: boolean; issueId: string | null;
  transfer: { id: string; on: string; amount: number; kind: string; party: string; ref: string } | null;
};
export type ReconJson = {
  id: string; account: string; accountId: string; period: string; status: string; statement: number; book: number;
  counts: { Matched: number; Suggested: number; Unmatched: number; unexplained: number };
  lines: ReconLineJson[];
  ledgerOnly: { id: string; on: string; amount: number; kind: string; party: string; ref: string }[];
  source: "items" | "live" | "mixed";
  canAct: boolean;
};

type Filter = "attention" | "Suggested" | "Unmatched" | "Matched" | "all";

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const out = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) throw new Error(out.error ?? "Nothing was changed. Try again.");
  return out as { message?: string };
}

export function ReconcileView({ r }: { r: ReconJson }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>(r.counts.Suggested + r.counts.Unmatched ? "attention" : "all");
  const [done, setDone] = useState<Record<string, "accepted" | "dismissed">>({});
  const [busy, setBusy] = useState<string | null>(null);

  const lines = useMemo(() => r.lines.filter((l) => {
    if (filter === "all") return true;
    if (filter === "attention") return l.status !== "Matched";
    return l.status === filter;
  }), [r.lines, filter]);
  const sure = r.lines.filter((l) => l.status === "Suggested" && l.confidence >= 0.9 && !done[l.id]);
  const diff = Math.round((r.statement - r.book) * 100) / 100;
  const open = r.status !== "Approved";
  const readyToApprove = open && diff === 0 && r.counts.Unmatched === 0 && r.counts.Suggested === 0;

  const accept = async (l: ReconLineJson, quiet = false) => {
    if (!l.transfer) return;
    await post(`/api/e/bank_transactions/${encodeURIComponent(l.id)}/actions/bank_transactions.match`, { transfer_id: l.transfer.id, confidence: l.confidence, reconciliation_id: r.id });
    setDone((d) => ({ ...d, [l.id]: "accepted" }));
    if (!quiet) toast.success(`Matched ${l.description} to ${l.transfer.id}`);
  };
  const acceptOne = async (l: ReconLineJson) => {
    setBusy(l.id);
    try { await accept(l); router.refresh(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const acceptAll = async () => {
    setBusy("all");
    let ok = 0;
    for (const l of sure) {
      try { await accept(l, true); ok++; } catch (e) { toast.error(`${l.description}: ${(e as Error).message}`); }
    }
    setBusy(null);
    if (ok) toast.success(`Accepted ${ok} AI match${ok === 1 ? "" : "es"}`);
    router.refresh();
  };
  const approve = async () => {
    setBusy("approve");
    try {
      const out = await post(`/api/e/bank_reconciliations/${encodeURIComponent(r.id)}/actions/bank_reconciliations.approve`, {});
      toast.success(out.message ?? "Reconciliation approved");
      router.refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  if (!r.lines.length) {
    return (
      <div className="space-y-3">
        <Summary r={r} diff={diff} />
        <EmptyState kind="table" title={`No bank statement lines for ${monthLabel(r.period)} yet`}
          description="The bank feed for this account hasn't loaded lines for this period, so there is nothing to match. Ledger transfers for the month are listed below; they'll be matched as soon as the statement arrives." />
        {r.ledgerOnly.length > 0 && <LedgerOnly items={r.ledgerOnly} />}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Summary r={r} diff={diff} />

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Filter statement lines" className="flex rounded-md border p-0.5 text-[12.5px]">
          {([["attention", "Needs review", r.counts.Suggested + r.counts.Unmatched], ["Suggested", "AI suggested", r.counts.Suggested], ["Unmatched", "Unmatched", r.counts.Unmatched], ["Matched", "Matched", r.counts.Matched], ["all", "All", r.lines.length]] as const).map(([k, label, n]) => (
            <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
              className={cn("rounded px-2.5 py-1 transition-colors", filter === k ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {label} <span className="tabular-nums text-muted-foreground">{n}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <AIBadge source={r.source === "live" ? "rules" : "precomputed"} model={r.source === "live" ? undefined : "reconciliation agent"} />
          {open && r.canAct && sure.length > 0 && (
            <Button size="sm" variant="outline" onClick={acceptAll} disabled={busy !== null}>
              <Sparkles className="size-3.5 text-tone-ai" /> Accept {sure.length} match{sure.length === 1 ? "" : "es"} at 90%+
            </Button>
          )}
          {open && r.canAct && (
            <Button size="sm" onClick={approve} disabled={!readyToApprove || busy !== null} title={readyToApprove ? undefined : "Match every line and clear the difference first"}>
              <BadgeCheck className="size-3.5" /> Approve reconciliation
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] border-b bg-muted/40 px-3 py-1.5 text-[11.5px] font-medium text-muted-foreground">
          <span>Bank statement</span><span />
          <span>Ledger</span>
        </div>
        {lines.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Nothing in this view. Every line here is matched.</p>}
        <ul className="divide-y">
          {lines.map((l) => {
            const state = done[l.id];
            return (
              <li key={l.id} className={cn("grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-start gap-y-1 px-3 py-2", l.status === "Suggested" && !state && "bg-tone-ai/[0.03]", l.unexplained && "bg-tone-warning/[0.04]")}>
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/app/banking/transactions/${encodeURIComponent(l.id)}`} className="truncate text-[13px] font-medium hover:text-primary hover:underline">{l.description}</Link>
                    <Money value={l.amount} className="text-[13px] font-medium" />
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                    {formatDate(l.posted_on)}
                    {l.unexplained && (
                      <Link href={`/app/data-health?f.entity_id=${encodeURIComponent(l.id)}`} className="inline-flex items-center gap-1 rounded bg-tone-warning/10 px-1.5 py-px font-medium text-tone-warning ring-1 ring-tone-warning/25 ring-inset hover:underline">
                        <ShieldAlert className="size-3" /> Unexplained deposit{l.issueId ? " · data issue" : ""}
                      </Link>
                    )}
                  </div>
                </div>
                <span className="flex justify-center pt-1 text-muted-foreground" aria-hidden>
                  {l.status === "Matched" || state === "accepted" ? <Check className="size-3.5 text-tone-success" /> : l.status === "Suggested" ? <Sparkles className="size-3.5 text-tone-ai" /> : <ArrowRight className="size-3.5 opacity-30" />}
                </span>
                <div className="min-w-0">
                  {l.transfer ? (
                    <>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-[13px]">{l.transfer.party}<span className="text-muted-foreground"> · {l.transfer.kind}</span></span>
                        <Money value={l.transfer.amount} className="text-[13px]" />
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-muted-foreground">{formatDate(l.transfer.on)} · {l.transfer.ref || l.transfer.id}</div>
                    </>
                  ) : (
                    <p className="pt-0.5 text-[12.5px] text-muted-foreground">{l.unexplained ? "No ledger transfer within $25 and 3 days. Find the source (a missed batch, a direct deposit) before approving." : "No ledger entry. Bank fees and interest need a journal entry."}</p>
                  )}
                </div>
                {l.status === "Suggested" && l.transfer && (
                  <div className="col-span-3 flex flex-wrap items-center gap-x-3 gap-y-1 pl-0.5">
                    {state ? (
                      <span className="text-[12px] text-muted-foreground">{state === "accepted" ? "Accepted" : "Dismissed for now"}</span>
                    ) : (
                      <>
                        <Confidence value={l.confidence} />
                        <span className="text-[12px] text-muted-foreground">{l.why.join(" · ")}</span>
                        {open && r.canAct && (
                          <span className="ml-auto flex gap-1.5">
                            <Button size="xs" variant="ghost" onClick={() => setDone((d) => ({ ...d, [l.id]: "dismissed" }))} disabled={busy !== null}><X className="size-3" /> Reject</Button>
                            <Button size="xs" variant="outline" onClick={() => acceptOne(l)} disabled={busy !== null}><Check className="size-3" /> Accept match</Button>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {r.ledgerOnly.length > 0 && <LedgerOnly items={r.ledgerOnly} />}
    </div>
  );
}

function Summary({ r, diff }: { r: ReconJson; diff: number }) {
  const cells: [string, React.ReactNode][] = [
    ["Statement balance", <Money key="s" value={r.statement} />],
    ["Book balance", <Money key="b" value={r.book} />],
    ["Difference", <Money key="d" value={diff} className={diff === 0 ? "text-tone-success" : "text-tone-danger"} />],
    ["Matched", <span key="m" className="tabular-nums">{r.counts.Matched}</span>],
    ["AI suggested", <span key="a" className="tabular-nums text-tone-ai">{r.counts.Suggested}</span>],
    ["Unmatched", <span key="u" className={cn("tabular-nums", r.counts.Unmatched && "text-tone-warning")}>{r.counts.Unmatched}{r.counts.unexplained ? <span className="ml-1 text-[11.5px] font-normal text-muted-foreground">({r.counts.unexplained} unexplained deposit{r.counts.unexplained === 1 ? "" : "s"})</span> : null}</span>],
  ];
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
        {r.account} · {monthLabel(r.period)} <StatusBadge value={r.status} enumDef={[{ value: "Open", tone: "warning" }, { value: "Balanced", tone: "info" }, { value: "Approved", tone: "success" }]} />
      </p>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 xl:grid-cols-6">
        {cells.map(([k, v]) => (
          <div key={k} className="bg-card px-3 py-2">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="mt-0.5 text-[14px] font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function LedgerOnly({ items }: { items: ReconJson["ledgerOnly"] }) {
  return (
    <section className="rounded-lg border">
      <h3 className="border-b px-3 py-2 text-[12.5px] font-semibold">In the ledger, not on the statement <span className="font-normal text-muted-foreground tabular-nums">{items.length}</span></h3>
      <p className="px-3 pt-2 text-[12px] text-muted-foreground">Usually timing: payments sent at month end that clear next month. Older items need a look.</p>
      <ul className="divide-y">
        {items.slice(0, 50).map((t) => (
          <li key={t.id} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-[12.5px]">
            <span className="min-w-0 truncate">{formatDate(t.on)} · {t.party} <span className="text-muted-foreground">· {t.kind} · {t.ref || t.id}</span></span>
            <Money value={t.amount} />
          </li>
        ))}
      </ul>
      {items.length > 50 && <p className="border-t px-3 py-1.5 text-[11.5px] text-muted-foreground">Showing 50 of {items.length}.</p>}
    </section>
  );
}

function monthLabel(ym: string) {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
