"use client";
import { demoNowIso } from "@/lib/clock";

import Link from "@/components/Link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, CircleHelp, Gavel, Loader2, Minus, Plus, ShieldCheck, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AIBadge, Confidence, type AISource } from "@/components/app/ai";
import { Money, RelativeDate, StatusBadge } from "@/components/app/display";
import { cn } from "@/lib/utils";
import { useShellMaybe } from "@/components/app/shell/context";
import { callAction, callAi, runHref } from "./client";

export type Factor = { factor: string; direction: "+" | "-"; weight: number; detail: string };
export type ScoringData = {
  appId: string;
  stage: string;
  open: boolean;
  applicant: { name: string; href: string; employer: string; income: number | null; coApplicants: number };
  rent: number | null;
  ratio: number | null;
  screening: { decision: string; credit_band: string | null; eviction_found: boolean; income_verified: boolean; criminal_flag: boolean; completed_at: string | null } | null;
  score: number | null;
  recommendation: string | null;
  factors: Factor[];
  summary: string | null;
  confidence: number | null;
  source: AISource;
  model: string | null;
  runId: string | null;
  proposalId: string | null;            // the undecided Leasing agent proposal, for the approvals link
  scoredAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  canDecide: boolean;
  canScore: boolean;
  neverScored: string[];
  log: { id: string; at: string; summary: string; agent: boolean }[];
};

const REC_TONE: Record<string, string> = { Approve: "text-tone-success", Conditional: "text-tone-warning", Deny: "text-tone-danger" };

function ScoreDial({ score }: { score: number }) {
  const r = 34, c = 2 * Math.PI * r;
  const tone = score >= 75 ? "stroke-tone-success" : score >= 55 ? "stroke-tone-warning" : "stroke-tone-danger";
  return (
    <div className="relative size-[92px] shrink-0" role="img" aria-label={`Score ${score} out of 100`}>
      <svg viewBox="0 0 80 80" className="size-full -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" className="stroke-muted" />
        <circle cx="40" cy="40" r={r} fill="none" strokeWidth="6" strokeLinecap="round" className={cn("transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none", tone)} strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[26px] leading-none font-semibold tabular-nums">{score}</span>
        <span className="text-[10.5px] text-muted-foreground">of 100</span>
      </div>
    </div>
  );
}

function FactorList({ title, items, positive }: { title: string; items: Factor[]; positive: boolean }) {
  return (
    <div className="min-w-0 flex-1 rounded-md border bg-background/60 p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold">
        <span className={cn("flex size-4 items-center justify-center rounded-full", positive ? "bg-tone-success/12 text-tone-success" : "bg-tone-danger/10 text-tone-danger")}>{positive ? <Plus className="size-3" /> : <Minus className="size-3" />}</span>
        {title}
      </h4>
      {items.length ? (
        <ul className="flex flex-col gap-2">
          {items.map((f) => (
            <li key={f.factor + f.detail} className="text-[12.5px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{f.factor}</span>
                {f.weight > 0 && <span className="text-[11px] text-muted-foreground tabular-nums">{f.weight <= 1 ? `${Math.round(f.weight * 100)}% weight` : `${positive ? "+" : "−"}${f.weight} pts`}</span>}
              </div>
              <p className="text-muted-foreground">{f.detail}</p>
              <div className="mt-1 h-1 rounded-full bg-muted"><div className={cn("h-1 rounded-full", positive ? "bg-tone-success/70" : "bg-tone-danger/70")} style={{ width: `${Math.min(100, f.weight <= 1 ? f.weight * 100 : (f.weight / 30) * 100)}%` }} /></div>
            </li>
          ))}
        </ul>
      ) : <p className="text-[12.5px] text-muted-foreground">None</p>}
    </div>
  );
}

export function ScoringPanel({ data }: { data: ScoringData }) {
  const router = useRouter();
  const shell = useShellMaybe();
  const [busy, setBusy] = useState<"score" | "Approved" | "Conditional" | "Denied" | null>(null);
  const [fresh, setFresh] = useState<Partial<ScoringData> | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState(false);
  const [confirmDeny, setConfirmDeny] = useState(false);
  const d = { ...data, ...fresh };

  const score = async () => {
    setBusy("score");
    try {
      const r = await callAi<{ score: number; recommendation: string; factors: Factor[]; summary: string; confidence: number }>("applications", d.appId, "score");
      setFresh({ score: r.score, recommendation: r.recommendation, factors: r.factors, summary: r.summary, confidence: r.confidence, runId: r.runId, model: r.model, source: r.source, scoredAt: demoNowIso() });
      toast.success(`Scored ${r.score}: recommends ${r.recommendation.toLowerCase()}`, { action: { label: "View run", onClick: () => router.push(runHref(r.runId)!) } });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const decide = async (decision: "Approved" | "Conditional" | "Denied") => {
    if (decision !== "Approved" && note.trim().length < 3) {
      setNoteError(true);
      document.getElementById("decision-note")?.focus();
      return;
    }
    if (decision === "Denied" && !confirmDeny) return setConfirmDeny(true);
    setBusy(decision);
    try {
      const r = await callAction("applications", d.appId, "decide", { decision, note: note.trim() || undefined });
      toast.success(r.message);
      setNote("");
      setConfirmDeny(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pros = d.factors.filter((f) => f.direction === "+");
  const cons = d.factors.filter((f) => f.direction === "-");
  const s = d.screening;

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="relative overflow-hidden rounded-lg border border-tone-ai/25 bg-tone-ai/[0.03]" aria-labelledby="ai-score">
          <header className="flex flex-wrap items-center gap-2 border-b border-tone-ai/15 px-4 py-2.5">
            <Sparkles className="size-3.5 text-tone-ai" />
            <h3 id="ai-score" className="text-[13px] font-semibold">Leasing agent score</h3>
            {d.score != null && <AIBadge source={d.source} model={d.model ?? undefined} size="xs" />}
            <div className="ml-auto flex items-center gap-2 text-[11.5px] text-muted-foreground">
              {d.scoredAt && <span>Scored <RelativeDate value={d.scoredAt} /></span>}
              {d.proposalId && <Link href={`/app/ai/approvals?proposal=${encodeURIComponent(d.proposalId)}`} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">Open in approvals<ArrowUpRight className="size-3" /></Link>}
              {d.runId && <Link href={runHref(d.runId)!} className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline">View run<ArrowUpRight className="size-3" /></Link>}
              {d.canScore && d.open && (
                <Button size="sm" variant={d.score == null ? "default" : "outline"} disabled={!!busy} onClick={() => void score()}>
                  {busy === "score" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}{busy === "score" ? "Scoring…" : d.score == null ? "Score with AI" : "Re-score"}
                </Button>
              )}
            </div>
          </header>
          {d.score == null ? (
            <div className="flex flex-col items-start gap-1 px-4 py-6" role="status">
              <p className="font-medium">{busy === "score" ? "Reading the application and screening summary…" : "Not scored yet"}</p>
              <p className="max-w-xl text-[12.5px] text-muted-foreground">The Leasing agent scores from income to rent, credit band, rental history and income verification, then sends a recommendation to the broker. Every step is recorded in its run.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-wrap items-center gap-5">
                <ScoreDial score={d.score} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-muted-foreground">Recommendation</p>
                  <p className={cn("text-[18px] font-semibold", REC_TONE[d.recommendation ?? ""])}>{d.recommendation === "Approve" ? "Approve" : d.recommendation === "Deny" ? "Deny" : "Approve with conditions"}</p>
                  {d.confidence != null && <Confidence value={d.confidence} className="mt-1" />}
                  {d.summary && <p className="mt-2 max-w-2xl text-[13px] leading-relaxed">{d.summary}</p>}
                </div>
              </div>
              <div className="flex flex-col gap-3 md:flex-row">
                <FactorList title="Reasons for" items={pros} positive />
                <FactorList title="Reasons against" items={cons} positive={false} />
              </div>
              {s?.criminal_flag && (
                <p className="rounded-md border border-tone-warning/30 bg-tone-warning/[0.06] px-3 py-2 text-[12.5px]">The screening report lists a record. It was not scored: a person reviews it case by case (nature, severity and how long ago), as fair-housing guidance requires.</p>
              )}
              <div className="flex flex-wrap items-center gap-1 text-[11.5px]">
                <span className="text-muted-foreground">Evidence</span>
                <Link href={d.applicant.href} className="rounded border bg-background px-1.5 py-px hover:border-primary/40 hover:text-primary">{d.applicant.name}</Link>
                <Link href="?tab=screening" className="rounded border bg-background px-1.5 py-px hover:border-primary/40 hover:text-primary">Screening summary</Link>
                <Link href="?tab=overview" className="rounded border bg-background px-1.5 py-px hover:border-primary/40 hover:text-primary">Application details</Link>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-card" aria-labelledby="decision">
          <header className="flex items-center gap-2 border-b px-4 py-2.5">
            <Gavel className="size-4 text-muted-foreground" />
            <h3 id="decision" className="text-[13px] font-semibold">Broker decision</h3>
            <StatusBadge value={d.stage} className="ml-auto" />
          </header>
          <div className="p-4">
            {!d.open ? (
              <p className="text-[13px]">{d.stage} {d.decidedBy ? <>by <span className="font-medium">{d.decidedBy}</span></> : null} {d.decidedAt && <RelativeDate value={d.decidedAt} className="text-muted-foreground" />}</p>
            ) : d.canDecide ? (
              <div className="flex flex-col gap-3">
                <p className="text-[12.5px] text-muted-foreground">The AI recommendation is advice. Your decision, the reason and the recommendation are kept in the audit log.</p>
                <Textarea id="decision-note" name="decision-note" value={note} onChange={(e) => { setNote(e.target.value); setNoteError(false); }} placeholder="Reason or conditions, e.g. one extra month of deposit…" aria-label="Reason or conditions" aria-invalid={noteError || undefined} aria-describedby="decision-note-help" maxLength={500} className="min-h-16 text-[13px]" />
                <p id="decision-note-help" className={cn("-mt-1.5 text-[12px]", noteError ? "text-tone-danger" : "text-muted-foreground")}>{noteError ? "Add a reason first. It goes in the adverse-action record." : "Required for a conditional approval or a denial."}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!!busy} onClick={() => void decide("Approved")}>{busy === "Approved" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}Approve</Button>
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void decide("Conditional")}>{busy === "Conditional" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Check data-icon="inline-start" />}Approve with conditions</Button>
                  <Button size="sm" variant={confirmDeny ? "destructive" : "outline"} className={cn(!confirmDeny && "text-tone-danger hover:text-tone-danger")} disabled={!!busy} onClick={() => void decide("Denied")}>{busy === "Denied" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <X />}{confirmDeny ? "Confirm denial" : "Deny"}</Button>
                  {confirmDeny && <Button size="sm" variant="ghost" onClick={() => setConfirmDeny(false)}>Cancel</Button>}
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">Waiting on the broker. {d.score == null && d.canScore ? "Score it first so the broker sees the reasons." : "The recommendation is in the broker's approval queue."}</p>
            )}
          </div>
        </section>

        {d.log.length > 0 && (
          <section className="rounded-lg border bg-card">
            <h3 className="border-b px-4 py-2.5 text-[13px] font-semibold">Decision log</h3>
            <ol className="divide-y">
              {d.log.map((l) => (
                <li key={l.id} className="flex items-start gap-2.5 px-4 py-2 text-[12.5px]">
                  <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", l.agent ? "bg-tone-ai" : "bg-muted-foreground/50")} />
                  <span className="min-w-0 flex-1">{l.summary}</span>
                  <RelativeDate value={l.at} className="shrink-0 text-muted-foreground" />
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <section className="rounded-lg border bg-card p-4 text-[12.5px]">
          <h3 className="mb-2 text-[13px] font-semibold">Application</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <dt className="text-muted-foreground">Applicant</dt><dd className="truncate text-right"><Link href={d.applicant.href} className="font-medium hover:text-primary hover:underline">{d.applicant.name}</Link></dd>
            <dt className="text-muted-foreground">Employer</dt><dd className="truncate text-right">{d.applicant.employer || "—"}</dd>
            <dt className="text-muted-foreground">Household income</dt><dd className="text-right"><Money value={d.applicant.income} style="whole" /> /mo</dd>
            <dt className="text-muted-foreground">Rent</dt><dd className="text-right"><Money value={d.rent} style="whole" /></dd>
            <dt className="text-muted-foreground">Income ÷ rent</dt><dd className={cn("text-right tabular-nums", d.ratio != null && d.ratio < 3 && "text-tone-warning")}>{d.ratio != null ? `${d.ratio.toFixed(1)}×` : "—"}</dd>
            <dt className="text-muted-foreground">Co-applicants</dt><dd className="text-right tabular-nums">{d.applicant.coApplicants}</dd>
          </dl>
          <h3 className="mt-4 mb-2 text-[13px] font-semibold">Screening summary</h3>
          {s ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">Result</dt><dd className="text-right"><StatusBadge value={s.decision} /></dd>
              <dt className="text-muted-foreground">Credit</dt><dd className="text-right">{s.credit_band ?? "—"}</dd>
              <dt className="text-muted-foreground">Prior eviction</dt><dd className="text-right">{s.eviction_found ? "Found" : "None"}</dd>
              <dt className="text-muted-foreground">Income verified</dt><dd className="text-right">{s.income_verified ? "Yes" : "Not yet"}</dd>
            </dl>
          ) : <p className="text-muted-foreground">Screening is still running.</p>}
        </section>

        <section className="rounded-lg border border-tone-success/25 bg-tone-success/[0.04] p-4 text-[12.5px]" aria-labelledby="fair">
          <h3 id="fair" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold"><ShieldCheck className="size-4 text-tone-success" />Fair-housing safe scoring</h3>
          <p className="text-muted-foreground">The score uses only income to rent, credit band, rental history and income verification. It never uses, and never sees:</p>
          <ul className="mt-2 flex flex-wrap gap-1">
            {d.neverScored.map((x) => <li key={x} className="rounded border bg-background px-1.5 py-px text-[11.5px]">{x}</li>)}
          </ul>
          {shell && <button type="button" onClick={() => shell.assistant.ask("How does applicant scoring stay fair-housing safe?")} className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"><CircleHelp className="size-3.5" />How scoring stays fair</button>}
        </section>
      </aside>
    </div>
  );
}
