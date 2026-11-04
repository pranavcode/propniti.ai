"use client";

import Link from "@/components/Link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Money } from "@/components/app/display";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { bulkSummary, runBulk, runHref, type BulkResult } from "./client";

export type DraftView = { offerId: string; leaseId: string; resident: string; property: string; unit: string; endOn: string; rent: number; offerRent: number; proposal: { id: string; title: string; risk: string; why: string[]; subject: string; body: string; runId: string | null; canApprove: boolean } | null };

// Model calls take seconds each; small requests keep progress moving and stay inside the AI rate limit.
const PREPARE_CHUNK = 5;

// Every draft offer in the window at once: the Renewals agent prices each and drafts its message
// (one proposal per offer, nothing sent), then a person reviews and sends the ones they pick. Sending
// approves each proposal through the approvals API, so the approval policy decides who may send
// which rent; anything this person can't approve is listed for the approver.
export function PrepareDrafts({ drafts }: { drafts: DraftView[] }) {
  const router = useRouter();
  const todo = drafts.filter((d) => !d.proposal).map((d) => d.offerId);
  const ready = drafts.filter((d) => d.proposal);
  const mine = ready.filter((d) => d.proposal!.canApprove);
  // Everything this person may approve starts selected; they untick what they want to hold back.
  const [held, setHeld] = useState<string[]>([]);
  const selected = mine.map((d) => d.proposal!.id).filter((id) => !held.includes(id));
  const [progress, setProgress] = useState<{ what: "prepare" | "send"; done: number; total: number } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const busy = !!progress;

  const prepare = async () => {
    setSummary(null);
    setProgress({ what: "prepare", done: 0, total: todo.length });
    const r = await runBulk("renewal_offers", "renewal_offers.prepare", todo, { chunk: PREPARE_CHUNK, onProgress: (done) => setProgress({ what: "prepare", done, total: todo.length }) });
    setProgress(null);
    setSummary(`${bulkSummary(r, "Prepared")}. Review the rent and message below, then send.`);
    if (r.ok) toast.success(bulkSummary(r, "Prepared")); else toast.error(r.errors[0] ?? "Nothing was prepared");
    router.refresh();
  };

  const send = async () => {
    setConfirm(false);
    setSummary(null);
    const ids = selected;
    const out: BulkResult = { ok: 0, failed: 0, errors: [] };
    setProgress({ what: "send", done: 0, total: ids.length });
    for (const [i, id] of ids.entries()) {
      const res = await fetch(`/api/ai/proposals/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approve", note: "Sent from Prepare all drafts" }) }).catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok) out.ok++;
      else {
        out.failed++;
        out.errors.push(body.error ?? "Couldn't reach the server");
        // Rate limited or offline: stop; what was sent stays sent.
        if (!res || res.status === 429) { out.failed += ids.length - i - 1; break; }
      }
      setProgress({ what: "send", done: i + 1, total: ids.length });
    }
    setProgress(null);
    setSummary(bulkSummary(out, "Sent"));
    if (out.ok) toast.success(bulkSummary(out, "Offers sent:")); else toast.error(out.errors[0] ?? "Nothing was sent");
    router.refresh();
  };

  if (!drafts.length) return null;
  const toggle = (id: string, on: boolean) => setHeld((h) => (on ? h.filter((x) => x !== id) : [...h, id]));
  return (
    <section className="rounded-lg border bg-card" aria-labelledby="drafts-h" data-tour="renewals-prepare">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <Sparkles className="size-3.5 text-tone-ai" />
        <h2 id="drafts-h" className="text-[13px] font-semibold">Draft offers</h2>
        <span className="text-[12px] text-muted-foreground tabular-nums">{drafts.length} draft{drafts.length === 1 ? "" : "s"} · {ready.length} prepared</span>
        <div className="ml-auto flex gap-2">
          {todo.length > 0 && <Button size="sm" variant={ready.length ? "outline" : "default"} disabled={busy} onClick={() => void prepare()}>{progress?.what === "prepare" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}Prepare all drafts ({todo.length})</Button>}
          {ready.length > 0 && <Button size="sm" disabled={busy || !selected.length} onClick={() => setConfirm(true)}><Send data-icon="inline-start" />Send selected ({selected.length})</Button>}
        </div>
      </header>
      {(progress || summary) && (
        <div className="flex flex-col gap-1.5 border-b px-4 py-2.5" role="status">
          {progress && <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} aria-label={progress.what === "prepare" ? "Preparing drafts" : "Sending offers"} />}
          <p className="text-[12.5px] text-muted-foreground tabular-nums">{progress ? `${progress.what === "prepare" ? "Renewals agent is pricing and drafting" : "Sending"} ${progress.done} of ${progress.total}…` : summary}</p>
        </div>
      )}
      {ready.length === 0 ? (
        <p className="px-4 py-3 text-[12.5px] text-muted-foreground">The Renewals agent prices each draft from the unit type&rsquo;s market rent, tenure and payment history, and drafts its message. Each one waits here for you; nothing is sent until you send it.</p>
      ) : (
        <ul className="max-h-96 divide-y overflow-y-auto">
          {ready.map((d) => {
            const p = d.proposal!;
            const change = d.rent ? ((d.offerRent - d.rent) / d.rent) * 100 : 0;
            return (
              <li key={d.offerId} className="flex gap-3 px-4 py-2.5 text-[13px]">
                <Checkbox className="mt-0.5" checked={selected.includes(p.id)} disabled={!p.canApprove || busy} onCheckedChange={(v) => toggle(p.id, v === true)} aria-label={`Send ${d.resident}'s offer`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link href={`/app/leasing/renewals?lease=${d.leaseId}#renewal-panel`} className="font-medium hover:text-primary hover:underline">{d.resident}</Link>
                    <span className="text-[12px] text-muted-foreground">{d.property} #{d.unit}{d.endOn ? ` · ends ${formatDate(d.endOn)}` : ""}</span>
                    <span className="ml-auto tabular-nums"><Money value={d.rent} style="whole" /> → <span className="font-semibold"><Money value={d.offerRent} style="whole" /></span> <span className={cn("text-[12px]", change > 5 ? "text-tone-warning" : "text-muted-foreground")}>{change >= 0 ? "+" : ""}{change.toFixed(1)}%</span></span>
                  </div>
                  <details className="mt-1 text-[12.5px]">
                    <summary className="cursor-pointer text-muted-foreground">{p.why[0] ?? "Message"}{p.why.length > 1 ? ` · ${p.why.length - 1} more reason${p.why.length > 2 ? "s" : ""}` : ""} · message</summary>
                    <ul className="mt-1 list-disc pl-4 text-muted-foreground">{p.why.slice(1).map((w) => <li key={w}>{w}</li>)}</ul>
                    <p className="mt-1.5 font-medium">{p.subject}</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">{p.body}</p>
                  </details>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px]">
                    {!p.canApprove && <span className="rounded bg-tone-warning/10 px-1 text-tone-warning">{p.risk} risk · needs a broker or regional manager</span>}
                    {p.runId && <Link href={runHref(p.runId)!} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">View run<ArrowUpRight className="size-3" /></Link>}
                    <Link href={`/app/ai/approvals?proposal=${encodeURIComponent(p.id)}`} className="text-muted-foreground hover:underline">In approvals</Link>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send {selected.length} renewal offer{selected.length === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>Each resident gets the message shown, at the rent shown. Every send is approved in your name and logged with the Renewals agent&rsquo;s proposal and run.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button onClick={() => void send()}><Send data-icon="inline-start" />Send {selected.length}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
