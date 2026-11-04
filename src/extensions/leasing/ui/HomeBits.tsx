"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, CalendarX, Clock3, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApprovalItem, AskBox, type AISource } from "@/components/app/ai";
import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { useShellMaybe } from "@/components/app/shell/context";
import { cn } from "@/lib/utils";
import { callAction, runHref } from "./client";

// Client pieces shared by the leasing persona homes.

export function AskPanel({ suggestions, placeholder }: { suggestions: string[]; placeholder: string }) {
  const shell = useShellMaybe();
  return <AskBox size="md" suggestions={suggestions} placeholder={placeholder} onAsk={(q) => shell?.assistant.ask(q, { path: "/app/leasing" })} footer={<span>The assistant answers from your records and shows what it looked up.</span>} />;
}

export type ProposalView = { id: string; agent: string; title: string; why: string[]; evidence: { label: string; href?: string }[]; risk: "Low" | "Medium" | "High"; confidence: number; runId: string | null; recordHref?: string; createdAt: string; source: AISource; model?: string; canApprove: boolean };

// The module's slice of the approvals inbox: approving runs the proposal's action once (audited).
export function ProposalQueue({ items, empty }: { items: ProposalView[]; empty: string }) {
  const router = useRouter();
  const [gone, setGone] = useState<string[]>([]);
  // A failed decision remounts its item (new key) so it shows as still open; throwing instead would
  // surface as an unhandled rejection, since the item calls this from a void click handler.
  const [tries, setTries] = useState<Record<string, number>>({});
  const decide = async (id: string, decision: "approve" | "reject") => {
    const res = await fetch(`/api/ai/proposals/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) }).catch(() => null);
    const out = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      toast.error(out.error ?? "Nothing was changed. Try again.");
      setTries((t) => ({ ...t, [id]: (t[id] ?? 0) + 1 }));
      return;
    }
    toast.success(decision === "approve" ? out.message ?? "Approved" : "Dismissed. Your decision is logged with your name.");
    setGone((g) => [...g, id]);
    router.refresh();
  };
  const shown = items.filter((p) => !gone.includes(p.id));
  if (!shown.length) return <EmptyState compact kind="inbox" title="Nothing waiting" description={empty} />;
  return (
    <div className="flex flex-col gap-2">
      {shown.map((p) => (
        <ApprovalItem key={`${p.id}-${tries[p.id] ?? 0}`} variant="row" agent={p.agent} title={p.title} risk={p.risk} why={p.why} evidence={p.evidence} confidence={p.confidence} runHref={runHref(p.runId)} recordHref={p.recordHref}
          createdAt={p.createdAt} source={p.source} model={p.model} canApprove={p.canApprove} policy={p.canApprove ? undefined : "Needs the broker"}
          onApprove={() => decide(p.id, "approve")} onReject={() => decide(p.id, "reject")} />
      ))}
    </div>
  );
}

export type TourView = { id: string; at: string; time: string; status: string; kind: string; prospect: string; prospectId: string; unit: string | null; property: string; beds: number | null; budget: number | null; agent: string | null; feedback: string };

export function TourList({ tours, canAct }: { tours: TourView[]; canAct: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, action: "complete" | "no_show") => {
    setBusy(id);
    try {
      const r = await callAction("showings", id, action, action === "complete" ? { feedback } : {});
      toast.success(r.message);
      setOpen(null);
      setFeedback("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  if (!tours.length) return <EmptyState compact kind="tasks" title="No tours today" description="Tours you book show up here with the lead's budget and what they're looking for." action={{ label: "See upcoming tours", href: "/app/leasing/showings?view=upcoming" }} />;
  return (
    <ol className="divide-y">
      {tours.map((t) => (
        <li key={t.id} className="px-3 py-2.5">
          <div className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-[12.5px] font-medium tabular-nums">{t.time}</span>
            <div className="min-w-0 flex-1">
              <Link href={`/app/leasing/prospects/${t.prospectId}`} className="font-medium hover:text-primary hover:underline">{t.prospect}</Link>
              <p className="truncate text-[12px] text-muted-foreground">{t.property}{t.unit ? ` · #${t.unit}` : ""} · {t.kind}{t.beds != null ? ` · ${t.beds === 0 ? "studio" : `${t.beds} bed`}` : ""}{t.budget ? <> · up to <Money value={t.budget} style="whole" /></> : null}</p>
            </div>
            {t.status !== "Scheduled" ? <StatusBadge value={t.status} /> : canAct && (
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="outline" disabled={busy === t.id} aria-expanded={open === t.id} aria-controls={`fb-${t.id}`} onClick={() => setOpen(open === t.id ? null : t.id)}><CalendarCheck data-icon="inline-start" />Toured</Button>
                <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => void act(t.id, "no_show")} aria-label={`Mark ${t.prospect} as a no-show`}><CalendarX data-icon="inline-start" /><span className="sr-only sm:not-sr-only">No-show</span></Button>
              </div>
            )}
          </div>
          {open === t.id && (
            <form id={`fb-${t.id}`} className="mt-2 flex gap-2 pl-19" onSubmit={(e) => { e.preventDefault(); void act(t.id, "complete"); }}>
              <Input autoFocus name="feedback" autoComplete="off" value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="How did it go? e.g. liked the layout, wants a higher floor…" aria-label="Tour feedback" maxLength={1000} className="h-8 text-[13px]" />
              <Button size="sm" type="submit" disabled={busy === t.id}>{busy === t.id ? "Saving…" : "Save feedback"}</Button>
            </form>
          )}
        </li>
      ))}
    </ol>
  );
}

export type FollowUpView = { id: string; name: string; stage: string; property: string; days: number; beds: number | null; budget: number | null; source: string };

export function FollowUpList({ rows }: { rows: FollowUpView[] }) {
  const shell = useShellMaybe();
  if (!rows.length) return <EmptyState compact kind="inbox" title="Everyone has heard from you" description="Leads with no contact in 3 days appear here." />;
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-3 px-3 py-2">
          <span className={cn("flex w-12 shrink-0 items-center gap-1 text-[12px] tabular-nums", r.days >= 7 ? "text-tone-danger" : "text-tone-warning")}><Clock3 className="size-3.5" />{r.days}d</span>
          <div className="min-w-0 flex-1">
            <Link href={`/app/leasing/prospects/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.name}</Link>
            <p className="truncate text-[12px] text-muted-foreground">{r.stage} · {r.property} · {r.source}{r.beds != null ? ` · ${r.beds === 0 ? "studio" : `${r.beds} bed`}` : ""}</p>
          </div>
          {shell && <Button size="sm" variant="ghost" aria-label={`Draft a follow-up to ${r.name}`} onClick={() => shell.assistant.ask(`Draft a short follow-up message to ${r.name}, a ${r.stage.toLowerCase()} lead at ${r.property}`, { entity: "prospects", id: r.id, title: r.name })}><MessageSquareText className="text-tone-ai" data-icon="inline-start" />Draft</Button>}
        </li>
      ))}
    </ul>
  );
}
