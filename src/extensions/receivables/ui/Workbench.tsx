"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, Play, Scale, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AIBadge, Confidence } from "@/components/app/ai/AIBadge";
import { EmptyState } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { Draft, WorkbenchRow } from "../collections";

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents % 100 ? 2 : 0 });
const STEP: Record<WorkbenchRow["step"], { label: string; icon: typeof Send }> = {
  reminder: { label: "Send reminder", icon: Send },
  plan: { label: "Offer payment plan", icon: Scale },
  legal: { label: "Legal review", icon: AlertTriangle },
};
const BAND = { High: "bg-tone-danger/10 text-tone-danger ring-tone-danger/20", Medium: "bg-tone-warning/12 text-tone-warning ring-tone-warning/25", Low: "bg-tone-neutral/10 text-tone-neutral ring-tone-neutral/15" };

async function post(url: string, body: unknown) {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    return { ok: res.ok, ...out } as { ok: boolean; error?: string; message?: string; approved?: number; results?: { id: string; ok: boolean; message: string }[]; runId?: string; href?: string };
  } catch {
    return { ok: false, error: "You're offline or the server didn't answer. Nothing was changed." };
  }
}

function AgingBar({ a }: { a: WorkbenchRow["aging"] }) {
  const total = a.d0_30 + a.d31_60 + a.d61_90 + a.d90p || 1;
  const seg = [
    { v: a.d0_30, c: "bg-tone-warning/45", l: "0–30" }, { v: a.d31_60, c: "bg-tone-warning", l: "31–60" },
    { v: a.d61_90, c: "bg-tone-danger/70", l: "61–90" }, { v: a.d90p, c: "bg-tone-danger", l: "90+" },
  ];
  return (
    <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-muted" role="img" aria-label={seg.filter((s) => s.v).map((s) => `${s.l} days ${usd(s.v)}`).join(", ")}>
      {seg.map((s) => s.v > 0 && <span key={s.l} className={s.c} style={{ width: `${(s.v / total) * 100}%` }} />)}
    </div>
  );
}

export function Workbench({ rows, canRun }: { rows: WorkbenchRow[]; canRun: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(rows[0]?.lease_id ?? null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [lang, setLang] = useState<Record<string, "en" | "es">>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const bulkable = rows.filter((r) => r.proposal && r.proposal.risk === "Low" && r.proposal.canDecide && r.safe);

  const toggle = (id: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const decide = async (r: WorkbenchRow, decision: "approve" | "reject") => {
    if (!r.proposal) return;
    setBusy(r.lease_id);
    const body = edits[r.lease_id] != null && decision === "approve" ? { decision, payload: { message: { body: edits[r.lease_id] } } } : { decision };
    const out = await post(`/api/ai/proposals/${encodeURIComponent(r.proposal.id)}`, body);
    setBusy(null);
    if (!out.ok) return toast.error(out.error ?? "That didn't go through");
    toast.success(decision === "approve" ? out.message ?? "Approved and sent" : "Rejected. The agent won't propose this again today.");
    router.refresh();
  };
  const bulk = async () => {
    const ids = bulkable.filter((r) => picked.has(r.lease_id)).map((r) => r.proposal!.id);
    if (!ids.length) return;
    setBusy("bulk");
    const out = await post("/api/ai/proposals/bulk", { ids });
    setBusy(null);
    if (!out.ok && !out.approved) return toast.error(out.error ?? "Nothing was approved");
    const skipped = (out.results ?? []).filter((x) => !x.ok);
    toast.success(`Approved ${out.approved ?? 0} reminder${out.approved === 1 ? "" : "s"}${skipped.length ? `; ${skipped.length} need an individual review` : ""}`);
    setPicked(new Set());
    router.refresh();
  };
  const run = async () => {
    setBusy("run");
    const out = await post("/api/ai/agents/collections/run", {});
    setBusy(null);
    if (!out.ok || !out.runId) return toast.error(out.error ?? "The agent didn't start");
    toast.success("Collections agent started", { action: { label: "Watch the run", onClick: () => router.push(out.href ?? `/app/ai/runs/${out.runId}`) } });
    setTimeout(() => router.refresh(), 4000);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
        <Checkbox
          aria-label="Select all safe reminders on this page"
          checked={bulkable.length > 0 && bulkable.every((r) => picked.has(r.lease_id))}
          disabled={!bulkable.length}
          onCheckedChange={(v) => setPicked(v ? new Set(bulkable.map((r) => r.lease_id)) : new Set())}
        />
        <span className="text-[12.5px] text-muted-foreground">{picked.size ? `${picked.size} selected` : `${bulkable.length} reminder${bulkable.length === 1 ? "" : "s"} on this page can be approved together`}</span>
        <Button size="sm" disabled={!picked.size || busy === "bulk"} onClick={bulk}>{busy === "bulk" ? <Loader2 className="animate-spin" /> : <Send />}Approve {picked.size || ""} safe reminder{picked.size === 1 ? "" : "s"}</Button>
        <span className="hidden text-[11.5px] text-muted-foreground lg:inline">Payment plans and legal referrals always need an individual decision.</span>
        <div className="ml-auto">{canRun && <Button size="sm" variant="outline" disabled={busy === "run"} onClick={run}>{busy === "run" ? <Loader2 className="animate-spin" /> : <Play />}Run Collections agent</Button>}</div>
      </div>

      {rows.length === 0 ? <EmptyState kind="table" title="No delinquent residents here" description="Everyone in this view is paid up. Change the filters to see more." /> : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Delinquent residents ranked by risk</caption>
            <thead className="bg-muted/60 text-[11.5px] text-muted-foreground">
              <tr>
                <th scope="col" className="w-9 px-3 py-2"><span className="sr-only">Select</span></th>
                <th scope="col" className="px-2 py-2 text-left font-medium">Resident</th>
                <th scope="col" className="px-2 py-2 text-left font-medium">Risk</th>
                <th scope="col" className="px-2 py-2 text-right font-medium">Balance</th>
                <th scope="col" className="hidden px-2 py-2 text-left font-medium md:table-cell">Aging</th>
                <th scope="col" className="px-2 py-2 text-left font-medium">Next step</th>
                <th scope="col" className="w-8 px-2 py-2"><span className="sr-only">Expand</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = open === r.lease_id;
                const step = STEP[r.step];
                const canPick = bulkable.includes(r);
                const l = lang[r.lease_id] ?? (r.language === "es" ? "es" : "en");
                const draft: Draft | null = r.proposal?.message ?? r.drafts?.[l] ?? null;
                return (
                  <Fragment key={r.lease_id}>
                    <tr className={cn("border-t", isOpen && "bg-muted/30")}>
                      <td className="px-3 py-2 align-top"><Checkbox aria-label={`Select ${r.resident}`} disabled={!canPick} checked={picked.has(r.lease_id)} onCheckedChange={(v) => toggle(r.lease_id, !!v)} /></td>
                      <td className="max-w-0 px-2 py-2">
                        <button type="button" onClick={() => setOpen(isOpen ? null : r.lease_id)} className="block max-w-full truncate text-left font-medium hover:text-primary">{r.resident}</button>
                        <span className="block truncate text-[11.5px] text-muted-foreground">{r.property} #{r.unit} · {r.lease_id}{r.language === "es" ? " · prefers Spanish" : ""}</span>
                      </td>
                      <td className="px-2 py-2"><span className={cn("inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11.5px] font-medium tabular-nums ring-1 ring-inset", BAND[r.band])}>{r.score} · {r.band}</span></td>
                      <td className="px-2 py-2 text-right tabular-nums"><span className="font-medium">{usd(r.balance)}</span><span className="block text-[11.5px] text-muted-foreground">{r.days_late} days late</span></td>
                      <td className="hidden px-2 py-2 md:table-cell"><AgingBar a={r.aging} /></td>
                      <td className="px-2 py-2">
                        {r.dataError ? (
                          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-tone-warning"><AlertTriangle className="size-3.5" />Check the rent first</span>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1.5 font-medium"><step.icon className="size-3.5 text-muted-foreground" />{step.label}</span>
                            <span className="block text-[11.5px] text-muted-foreground">{r.proposal ? `Proposed by the agent · ${r.proposal.risk} risk` : "Not proposed yet"}</span>
                          </>
                        )}
                      </td>
                      <td className="px-2 py-2"><button type="button" aria-expanded={isOpen} aria-label={isOpen ? "Hide details" : "Show details"} onClick={() => setOpen(isOpen ? null : r.lease_id)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button></td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/30">
                        <td />
                        <td colSpan={6} className="px-2 pb-4 pt-1">
                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                            <div className="flex flex-col gap-2">
                              <h4 className="flex items-center gap-2 text-[12px] font-semibold">Why this score <AIBadge source="rules" size="xs" /></h4>
                              <ul className="flex flex-col gap-1 text-[12.5px]">{r.why.map((w, i) => <li key={i} className="flex gap-1.5"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/60" />{w}</li>)}</ul>
                              {r.dataError && (
                                <div className="rounded-md border border-tone-warning/30 bg-tone-warning/[0.07] px-3 py-2 text-[12.5px]">
                                  <p className="font-medium">Rent is {usd(r.dataError.rent)} on a unit that rents for about {usd(r.dataError.market)}.</p>
                                  <p className="text-muted-foreground">That looks like a typo (10× off), so this balance is a data error, not delinquency. It’s held out of collections until the lease is fixed.</p>
                                  <Link href={`/app/leases/${r.lease_id}`} className="mt-1 inline-block font-medium text-primary hover:underline">Open the lease to fix it →</Link>
                                </div>
                              )}
                              <div className="flex flex-wrap gap-3 pt-1 text-[12.5px]">
                                <Link href={`/app/receivables/ledger/${r.lease_id}`} className="font-medium text-primary hover:underline">Open ledger →</Link>
                                <Link href={`/app/receivables/charges?f.lease_id=${r.lease_id}&f.status=Overdue`} className="text-muted-foreground hover:text-foreground hover:underline">Overdue charges</Link>
                                {r.proposal?.run_id && <Link href={`/app/ai/runs/${r.proposal.run_id}`} className="text-muted-foreground hover:text-foreground hover:underline">Agent run</Link>}
                              </div>
                            </div>
                            <div className="flex flex-col gap-2">
                              {r.step === "legal" && !r.dataError ? (
                                <div className="rounded-md border bg-card px-3 py-2 text-[12.5px]">
                                  <p className="font-medium">Over 90 days: a manager reviews this for legal action.</p>
                                  <p className="text-muted-foreground">No message is drafted. Check the state’s notice rules before any filing. {r.proposal ? "The agent has opened a legal-review proposal for a person to decide." : "Run the agent to open a legal-review proposal."}</p>
                                </div>
                              ) : draft && (
                                <>
                                  <div className="flex items-center gap-2">
                                    <h4 className="flex items-center gap-1.5 text-[12px] font-semibold"><Sparkles className="size-3.5 text-tone-ai" />Drafted message</h4>
                                    <AIBadge source={r.proposal ? (r.proposal.model && r.proposal.model !== "rules" ? "precomputed" : "rules") : "rules"} model={r.proposal?.model ?? undefined} size="xs" />
                                    {r.proposal && <Confidence value={r.proposal.confidence} />}
                                    {!r.proposal?.message && (
                                      <ToggleGroup type="single" size="sm" variant="outline" value={l} onValueChange={(v) => v && setLang((x) => ({ ...x, [r.lease_id]: v as "en" | "es" }))} className="ml-auto" aria-label="Message language">
                                        <ToggleGroupItem value="en" className="h-6 px-2 text-[11.5px]">English</ToggleGroupItem>
                                        <ToggleGroupItem value="es" className="h-6 px-2 text-[11.5px]">Español</ToggleGroupItem>
                                      </ToggleGroup>
                                    )}
                                  </div>
                                  <div className="rounded-md border bg-card">
                                    <p className="border-b px-3 py-1.5 text-[12.5px] font-medium">{draft.subject}</p>
                                    {r.proposal?.canDecide ? (
                                      <Textarea aria-label="Message body" className="min-h-24 resize-y border-0 text-[12.5px] shadow-none focus-visible:ring-0" value={edits[r.lease_id] ?? draft.body} onChange={(e) => setEdits((x) => ({ ...x, [r.lease_id]: e.target.value }))} maxLength={4000} />
                                    ) : <p className="whitespace-pre-wrap px-3 py-2 text-[12.5px]">{draft.body}</p>}
                                  </div>
                                  <p className="text-[11.5px] text-muted-foreground">Figures come from the ledger, not the model. The message never promises a waiver.</p>
                                </>
                              )}
                              {r.proposal ? (
                                r.proposal.canDecide ? (
                                  <div className="flex gap-2">
                                    <Button size="sm" disabled={busy === r.lease_id} onClick={() => decide(r, "approve")}>{busy === r.lease_id && <Loader2 className="animate-spin" />}{r.step === "legal" ? "Approve legal review" : edits[r.lease_id] != null ? "Approve edited message" : "Approve and send"}</Button>
                                    <Button size="sm" variant="outline" disabled={busy === r.lease_id} onClick={() => decide(r, "reject")}>Reject</Button>
                                  </div>
                                ) : <p className="text-[12px] text-muted-foreground">{r.proposal.risk === "Low" ? "Your role can view this proposal but not act on it." : `${r.proposal.risk}-risk proposals need a regional manager or principal.`}</p>
                              ) : !r.dataError && <p className="text-[12px] text-muted-foreground">The agent hasn’t proposed this yet. Run it to queue the message for approval.</p>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
