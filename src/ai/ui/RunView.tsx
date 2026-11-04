"use client";

import Link from "next/link";
import { toast } from "sonner";
import { ApprovalItem, RunTrace } from "@/components/app/ai";
import { RelativeDate } from "@/components/app/display";
import { AGENT_LABEL, api, sourceOf, toTrace, useRunStream, type ProposalJson, type RunJson, type StepJson } from "./client";

// One run, live while it runs: the step trace (tool calls, results, model turns, proposals) and
// the proposals it made, which can be approved or rejected right here.

export function ProposalCard({ p, variant = "card", canApprove = true }: { p: ProposalJson; variant?: "card" | "row"; canApprove?: boolean }) {
  const decide = async (decision: "approve" | "reject") => {
    try {
      const r = await api<{ message: string }>(`/api/ai/proposals/${p.id}`, "POST", { decision });
      toast.success(decision === "approve" ? r.message : "Rejected");
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };
  const decided = p.decision || p.queue_state === "auto_handled";
  return (
    <ApprovalItem
      variant={variant}
      agent={AGENT_LABEL[p.agent] ?? p.agent}
      title={p.title}
      amount={p.amount_cents != null ? p.amount_cents / 100 : null}
      risk={p.risk}
      why={p.why}
      evidence={p.evidence.map((e) => ({ label: e.label, href: e.href }))}
      confidence={p.confidence}
      policy={p.queue_state === "waiting" ? "Over the owner's limit: the owner approves in their portal" : p.assignee_role ? `Approver: ${p.assignee_role.replace(/_/g, " ")}` : undefined}
      runHref={p.run_id ? `/app/ai/runs/${p.run_id}` : undefined}
      recordHref={p.href}
      createdAt={p.created_at}
      source={sourceOf(p)}
      model={p.model ?? undefined}
      canApprove={canApprove}
      onApprove={decided ? undefined : () => decide("approve")}
      onReject={decided ? undefined : () => decide("reject")}
    />
  );
}

export function RunView({ runId, initial }: { runId: string; initial: { run: RunJson; steps: StepJson[]; proposals: ProposalJson[]; traceHidden?: boolean } }) {
  const { run, steps, proposals, live, mode } = useRunStream(runId, initial);
  if (!run) return null;
  return (
    <div className="grid gap-4 px-4 pb-8 md:px-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-3">
        {run.summary && !live && <div className="rounded-lg border bg-card p-3.5 text-[13px] whitespace-pre-line"><div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Summary</div>{run.summary}</div>}
        {run.error && <div className="rounded-lg border border-tone-danger/30 bg-tone-danger/5 p-3 text-tone-danger">{run.error}</div>}
        {initial.traceHidden ? <p className="rounded-lg border border-dashed p-4 text-muted-foreground">This run covered properties outside your scope, so its step trace is hidden. The proposals for your properties are on the right.</p> : <RunTrace steps={steps.map(toTrace)} agent={AGENT_LABEL[run.agent_key] ?? run.agent_key} status={run.status} model={run.model ?? (live ? "…" : "rules")} tokensIn={run.tokens_in} tokensOut={run.tokens_out} costCents={run.cost_cents} live={live} />}
        <p className="text-[12px] text-muted-foreground">
          {live ? (mode === "poll" ? "Live: checking for new steps every second." : "Live: steps stream in as the agent works.") : <>Started <RelativeDate value={run.started_at} /> by {run.trigger_kind === "manual" ? `a person (${run.started_by})` : run.trigger_kind === "schedule" ? "the 15-minute schedule" : run.trigger_kind === "event" ? "an event" : "the assistant"}{run.ended_at && <>; finished <RelativeDate value={run.ended_at} /></>}.</>}
        </p>
      </div>
      <aside className="space-y-2">
        <h2 className="text-[13px] font-semibold">Proposals {proposals.length ? `(${proposals.length})` : ""}</h2>
        {proposals.length ? proposals.map((p) => <ProposalCard key={p.id} p={p} />) : <p className="rounded-lg border border-dashed p-4 text-muted-foreground">{live ? "Proposals appear here as the agent makes them." : "This run made no new proposals."}</p>}
        <Link href="/app/ai/approvals" className="block text-[12px] text-primary hover:underline">Open the approvals inbox →</Link>
      </aside>
    </div>
  );
}
