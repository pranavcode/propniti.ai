"use client";

import Link from "@/components/Link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, CalendarCheck, CalendarX, Clock3, Loader2, MessageSquareText, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AIBadge, ApprovalItem, AskBox, type AISource } from "@/components/app/ai";
import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { useShellMaybe } from "@/components/app/shell/context";
import { cn } from "@/lib/utils";
import { checkFairHousing } from "../fairHousing";
import { callAction, callAi, runHref } from "./client";

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

type FollowUpDraft = { subject: string; body: string; runId: string; source: AISource; model: string };

// Each due lead: Draft asks the Leasing agent for a note from the lead's facts, the person edits it
// here and sends it (prospects.send_follow_up, once a day per lead). Nothing goes out without Send.
export function FollowUpList({ rows }: { rows: FollowUpView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<FollowUpDraft | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const flags = checkFairHousing(body);
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : String(e));

  const startDraft = async (r: FollowUpView) => {
    setOpen(r.id);
    setDraft(null);
    setBusy("draft");
    try {
      const d = await callAi<{ subject: string; body: string }>("prospects", r.id, "draft_follow_up");
      setDraft({ subject: d.subject, body: d.body, runId: d.runId, source: d.source === "rules" ? "rules" : "live", model: d.model });
      setSubject(d.subject);
      setBody(d.body);
    } catch (e) { fail(e); setOpen(null); } finally { setBusy(null); }
  };
  const send = async (r: FollowUpView) => {
    setBusy("send");
    try {
      const out = await callAction("prospects", r.id, "send_follow_up", { subject, body });
      toast.success(out.message);
      setOpen(null);
      router.refresh();
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  if (!rows.length) return <EmptyState compact kind="inbox" title="Everyone has heard from you" description="Leads with no contact in 3 days appear here." />;
  return (
    <ul className="divide-y">
      {rows.map((r) => (
        <li key={r.id} className="px-3 py-2">
          <div className="flex items-center gap-3">
            <span className={cn("flex w-12 shrink-0 items-center gap-1 text-[12px] tabular-nums", r.days >= 7 ? "text-tone-danger" : "text-tone-warning")}><Clock3 className="size-3.5" />{r.days}d</span>
            <div className="min-w-0 flex-1">
              <Link href={`/app/leasing/prospects/${r.id}`} className="font-medium hover:text-primary hover:underline">{r.name}</Link>
              <p className="truncate text-[12px] text-muted-foreground">{r.stage} · {r.property} · {r.source}{r.beds != null ? ` · ${r.beds === 0 ? "studio" : `${r.beds} bed`}` : ""}</p>
            </div>
            <Button size="sm" variant="ghost" disabled={!!busy} aria-expanded={open === r.id} aria-controls={`fu-${r.id}`} aria-label={`Draft a follow-up to ${r.name}`} onClick={() => (open === r.id ? setOpen(null) : void startDraft(r))}>
              {busy === "draft" && open === r.id ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <MessageSquareText className="text-tone-ai" data-icon="inline-start" />}Draft
            </Button>
          </div>
          {open === r.id && (
            <div id={`fu-${r.id}`} className="mt-2 flex flex-col gap-2 rounded-md border border-tone-ai/25 bg-tone-ai/[0.03] p-2.5 sm:ml-15">
              {!draft ? <p role="status" className="text-[12.5px] text-muted-foreground">Leasing agent is drafting from {r.name.split(" ")[0]}&rsquo;s stage, budget and beds wanted…</p> : (
                <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void send(r); }}>
                  <div className="flex flex-wrap items-center gap-2 text-[12px]">
                    <Sparkles className="size-3.5 text-tone-ai" /><span className="font-semibold">AI draft</span>
                    <AIBadge source={draft.source} model={draft.source === "live" ? draft.model : undefined} size="xs" />
                    <Link href={runHref(draft.runId)!} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">View run<ArrowUpRight className="size-3" /></Link>
                  </div>
                  <Input name="subject" autoComplete="off" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" maxLength={200} className="h-8 text-[13px]" />
                  <Textarea name="message" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Message" maxLength={2000} className="min-h-28 text-[13px] leading-relaxed" />
                  {flags.length > 0 && <p role="status" className="text-[12px] text-tone-danger">Fair-housing: &ldquo;{flags[0].phrase}&rdquo; ({flags[0].category}). {flags[0].suggestion}.</p>}
                  <div className="flex items-center gap-2">
                    <Button size="sm" type="submit" disabled={!!busy || subject.trim().length < 3 || body.trim().length < 10 || flags.length > 0}>{busy === "send" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}Send</Button>
                    <Button size="sm" type="button" variant="ghost" disabled={!!busy} onClick={() => setOpen(null)}>Cancel</Button>
                    <span className="text-[11.5px] text-muted-foreground">Sent as email from you; logged on the lead.</span>
                  </div>
                </form>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
