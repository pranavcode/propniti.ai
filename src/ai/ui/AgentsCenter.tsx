"use client";

import Link from "@/components/Link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Banknote, Bot, ClipboardCheck, FileSpreadsheet, HeartPulse, KeyRound, LineChart, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { AgentCard, AIBadge, RunTrace } from "@/components/app/ai";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ScrollX } from "@/components/app/ScrollX";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AgentCard as Card } from "@/ai/views";
import type { ApprovalPolicy, Autonomy } from "@/ai/types";
import { ProposalCard } from "./RunView";
import { AGENT_LABEL, api, toTrace, useRunStream } from "./client";
import { ORG_POLICY_TEXT, POLICY_EDITORS_TEXT } from "../policy-editors";

const ICONS: Record<string, React.ReactNode> = {
  collections: <Banknote />, leasing: <KeyRound />, renewals: <RefreshCw />, maintenance_triage: <Wrench />, ap: <FileSpreadsheet />,
  data_health: <HeartPulse />, owner_reporting: <LineChart />, compliance: <ShieldCheck />,
};
// Two levels. "Suggest" and "act with approval" behaved the same (a proposal a person approves), so
// they are one level here; a saved "suggest" shows as "Approve first".
const AUTONOMY = [
  { value: "act_with_approval", label: "Approve first" },
  { value: "auto_within_policy", label: "Auto within policy" },
] as const;
const level = (a: string) => (a === "suggest" ? "act_with_approval" : a) as Autonomy;

type Status = { provider: string; model: string; label: string; live: boolean; lastSweepAt: string | null; policies: (ApprovalPolicy & { id?: string })[] };

function LiveRun({ runId, agent, onClose }: { runId: string; agent: string; onClose: () => void }) {
  const { run, steps, proposals, refs, live } = useRunStream(runId);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-surface="app">
        <SheetHeader>
          <SheetTitle>{AGENT_LABEL[agent] ?? agent} · live run</SheetTitle>
          <SheetDescription>Each step appears here in plain words as it happens. <Link className="text-primary hover:underline" href={`/app/ai/runs/${runId}`}>Open the full run</Link></SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-4 pb-6">
          <RunTrace steps={steps.map(toTrace)} refs={refs} status={run?.status ?? "running"} model={run?.model ?? undefined} tokensIn={run?.tokens_in} tokensOut={run?.tokens_out} costCents={run?.cost_cents} live={live || !run} />
          {run?.summary && !live && <p className="rounded-md bg-muted/50 p-3 whitespace-pre-line">{run.summary}</p>}
          {proposals.map((p) => <ProposalCard key={p.id} p={p} variant="row" />)}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function AgentsCenter({ agents, status, sweep, canManage, canRun, canEditPolicies, canEditOrgPolicies }: { agents: (Card & { runsText: string })[]; status: Status; sweep: { lastAgoMin: number | null; nextInMin: number }; canManage: boolean; canRun: boolean; canEditPolicies: boolean; canEditOrgPolicies: boolean }) {
  const router = useRouter();
  const [live, setLive] = useState<{ runId: string; agent: string } | null>(null);
  const [cards, setCards] = useState(agents);

  const patch = async (key: string, body: Record<string, unknown>) => {
    try {
      await api(`/api/ai/agents/${key}`, "PATCH", body);
      setCards((cs) => cs.map((c) => (c.key === key ? { ...c, ...body } : c)));
      toast.success("Saved and logged to the audit trail");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const runNow = async (key: string) => {
    try {
      const r = await api<{ runId: string }>(`/api/ai/agents/${key}/run`, "POST");
      setLive({ runId: r.runId, agent: key });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-6 px-4 pb-10 md:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-3 text-[12.5px]">
        <span className="flex items-center gap-2"><Bot className="size-4 text-tone-ai" /> Model: <AIBadge source={status.live ? "live" : "rules"} model={status.label} /></span>
        <span className="text-muted-foreground">Schedules are checked every 15 minutes, and again on the first visit after a missed check. {sweep.lastAgoMin == null ? "None has run yet" : `Last check ${sweep.lastAgoMin} min ago`}; next in {sweep.nextInMin} min.</span>
        {!status.live && <span className="text-muted-foreground">No model key is set, so agents use their rules: same tools, same proposals, no drafted wording.</span>}
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((a) => (
          <AgentCard
            key={a.key}
            name={a.name}
            goal={a.goal}
            icon={ICONS[a.key]}
            status={a.lastRun?.status === "failed" ? "failed" : a.pending ? "waiting_approval" : "idle"}
            lastRun={a.lastRun?.started_at}
            nextRun={a.nextRunAt}
            successRate={a.successRate != null ? a.successRate / 100 : undefined}
            proposed={a.proposed}
            approved={a.approved}
            autoApplied={a.auto}
            autonomy={level(a.autonomy)}
            autonomyControl={canManage ? (
              <Select value={level(a.autonomy)} onValueChange={(v) => void patch(a.key, { autonomy: v })}>
                <SelectTrigger size="sm" className="h-7 min-w-0 flex-1 px-2 text-[12px]" aria-label={`Autonomy for ${a.name}`}><SelectValue /></SelectTrigger>
                <SelectContent>{AUTONOMY.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            ) : undefined}
            runs={a.runsText}
            enabled={a.enabled}
            href={`/app/ai/activity?agent=${a.key}`}
            model={a.lastRun?.model && a.lastRun.model !== status.model ? a.lastRun.model : undefined}
            onToggle={canManage ? (v) => void patch(a.key, { enabled: v }) : undefined}
            onRunNow={canRun ? () => runNow(a.key) : undefined}
          />
        ))}
      </section>

      <PolicyEditor policies={status.policies} canEdit={canEditOrgPolicies} note={canEditPolicies ? ORG_POLICY_TEXT : POLICY_EDITORS_TEXT} onSaved={() => router.refresh()} />
      {live && <LiveRun runId={live.runId} agent={live.agent} onClose={() => { setLive(null); router.refresh(); }} />}
    </div>
  );
}

// A dollar amount field: "$" in front, and "5,000" while not being edited. The value it holds and
// saves is the plain number as typed ("5000"), so saving is unchanged.
function DollarInput({ value, placeholder, onChange, label }: { value: string; placeholder: string; onChange: (v: string) => void; label: string }) {
  const [editing, setEditing] = useState(false);
  const shown = !editing && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 }) : value;
  return (
    <span className="relative inline-flex">
      {value !== "" && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-muted-foreground">$</span>}
      <Input inputMode="decimal" className={cn("h-7 w-32 tabular-nums", value !== "" && "pl-5")} value={shown} placeholder={placeholder} aria-label={label}
        onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} onChange={(e) => onChange(e.target.value.replace(/[$,\s]/g, ""))} />
    </span>
  );
}

// These are the organization defaults (loadPolicies), so editing needs an org-wide editor.
function PolicyEditor({ policies, canEdit, note, onSaved }: { policies: (ApprovalPolicy & { id?: string })[]; canEdit: boolean; note: string; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, { limit: string; owner: string }>>({});
  if (!policies.length) return null;
  const save = async (p: ApprovalPolicy & { id?: string }) => {
    const d = draft[p.category];
    if (!p.id || !d) return;
    const cents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 100));
    try {
      await api(`/api/ai/policies/${p.id}`, "PATCH", { limit_cents: cents(d.limit), owner_approval_over_cents: cents(d.owner) });
      toast.success(`${p.category} policy saved`);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <ClipboardCheck className="size-4 text-muted-foreground" />
        <h2 className="font-semibold">Approval policies</h2>
        <span className="text-[12px] text-muted-foreground">What agents may apply on their own (autonomy “Auto within policy”), and when the owner decides. Legal and safety always need a person.</span>
      </div>
      {!canEdit && <p className="border-b px-4 py-2 text-[12px] text-muted-foreground">{note}</p>}
      <ScrollX>
      <table className="w-full text-[13px]">
        <thead className="text-left text-[11.5px] text-muted-foreground">
          <tr className="border-b"><th className="px-4 py-2 font-medium">Category</th><th className="px-4 py-2 font-medium">Auto-approve up to</th><th className="px-4 py-2 font-medium">Owner approves over</th><th className="px-4 py-2 font-medium">Approver</th><th /></tr>
        </thead>
        <tbody>
          {policies.map((p) => {
            const d = draft[p.category] ?? { limit: p.limitCents == null ? "" : String(p.limitCents / 100), owner: p.ownerApprovalOverCents == null ? "" : String(p.ownerApprovalOverCents / 100) };
            const set = (k: "limit" | "owner", v: string) => setDraft((x) => ({ ...x, [p.category]: { ...d, [k]: v } }));
            return (
              <tr key={p.category} className="border-b last:border-0">
                <td className="px-4 py-2 font-medium">{p.category}</td>
                <td className="px-4 py-2">{p.alwaysHuman ? <span className="text-muted-foreground">Always a person</span> : !canEdit ? <span className="tabular-nums">{d.limit ? `$${Number(d.limit).toLocaleString("en-US")}` : <span className="text-muted-foreground">Always a person</span>}</span> : <DollarInput value={d.limit} placeholder="Always a person" onChange={(v) => set("limit", v)} label={`${p.category} auto-approve limit in dollars`} />}</td>
                <td className="px-4 py-2">{!canEdit || p.alwaysHuman ? <span className="tabular-nums">{d.owner ? `$${Number(d.owner).toLocaleString("en-US")}` : <span className="text-muted-foreground">Never</span>}</span> : <DollarInput value={d.owner} placeholder="Never" onChange={(v) => set("owner", v)} label={`${p.category} owner approval threshold in dollars`} />}</td>
                <td className="px-4 py-2 capitalize text-muted-foreground">{p.approverRole.replace(/_/g, " ")}</td>
                <td className="px-4 py-2 text-right">{canEdit && draft[p.category] && <Button size="sm" variant="outline" onClick={() => void save(p)}>Save</Button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </ScrollX>
    </section>
  );
}
