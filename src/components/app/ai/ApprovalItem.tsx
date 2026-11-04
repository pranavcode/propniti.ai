"use client";

import Link from "@/components/Link";
import { useState } from "react";
import { Check, ChevronDown, CornerDownRight, ExternalLink, Lock, Pencil, ShieldAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Money, RelativeDate } from "../display";
import { AIBadge, Confidence, type AISource } from "./AIBadge";
import type { Evidence } from "./AISuggestion";

export type Risk = "Low" | "Medium" | "High";

export type ApprovalItemProps = {
  agent: string;                         // "Payables agent"
  title: string;                         // "Approve bill from ABC HVAC"
  amount?: number | null;                // dollars
  risk: Risk;
  why: string[];
  evidence?: Evidence[];
  confidence?: number;
  policy?: string;                       // "Over the $500 owner limit · needs a principal"; shown when this person can't approve
  runHref?: string;                      // the agent run that proposed it
  recordHref?: string;
  createdAt?: string;
  source?: AISource;
  model?: string;
  canApprove?: boolean;                  // false: the current role can't approve (policy lock)
  onApprove?: () => void | Promise<unknown>;
  onEdit?: () => void;
  onReject?: () => void | Promise<unknown>;
  variant?: "card" | "row";
  defaultOpen?: boolean;
  className?: string;
  id?: string;
};

const RISK: Record<Risk, string> = {
  Low: "bg-tone-neutral/10 text-tone-neutral ring-tone-neutral/15",
  Medium: "bg-tone-warning/12 text-tone-warning ring-tone-warning/20",
  High: "bg-tone-danger/10 text-tone-danger ring-tone-danger/15",
};

export function RiskBadge({ risk }: { risk: Risk }) {
  return <span className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] whitespace-nowrap font-medium ring-1 ring-inset", RISK[risk])}>{risk === "High" && <ShieldAlert className="size-3" />}{risk} risk</span>;
}

// One proposed action in the approvals queue. People approve; agents only propose.
export function ApprovalItem(p: ApprovalItemProps) {
  const { agent, title, amount, risk, why, evidence = [], confidence, policy, runHref, recordHref, createdAt, source = "precomputed", model, canApprove = true, onApprove, onEdit, onReject, variant = "card", defaultOpen, className, id } = p;
  const [open, setOpen] = useState(defaultOpen ?? variant === "card");
  const [state, setState] = useState<"open" | "approved" | "rejected">("open");
  const [busy, setBusy] = useState(false);
  const act = async (kind: "approved" | "rejected") => {
    setBusy(true);
    try { await (kind === "approved" ? onApprove : onReject)?.(); setState(kind); }
    finally { setBusy(false); }
  };

  // The policy explains why Approve is locked; for someone who may approve it would only mislead.
  const shownPolicy = onApprove && canApprove ? undefined : policy;
  const actions = state === "open" ? (
    <div className="flex shrink-0 items-center gap-1">
      {onReject && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act("rejected")} aria-label={`Reject: ${title}`}><X /><span className={cn(variant === "row" && "sr-only")}>Reject</span></Button>}
      {onEdit && variant === "card" && <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}><Pencil /> Edit</Button>}
      {onApprove && (canApprove
        ? <Button size="sm" disabled={busy} onClick={() => void act("approved")}><Check /> Approve</Button>
        : <Button size="sm" variant="outline" disabled title={policy}><Lock /> Needs approver</Button>)}
    </div>
  ) : (
    <span className={cn("inline-flex items-center gap-1 text-[12px] font-medium", state === "approved" ? "text-tone-success" : "text-muted-foreground")}>
      {state === "approved" ? <><Check className="size-3.5" /> Approved · logged to audit</> : <><X className="size-3.5" /> Rejected</>}
    </span>
  );

  const meta = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
      <span className="font-medium text-foreground/80">{agent}</span>
      {createdAt && <><span>·</span><RelativeDate value={createdAt} /></>}
      <RiskBadge risk={risk} />
      <AIBadge source={source} model={model} size="xs" />
    </div>
  );

  if (variant === "row") {
    return (
      <div id={id} className={cn("border-b last:border-0", state !== "open" && "opacity-70", className)}>
        <div className="flex items-center gap-3 px-3 py-2">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{title}</span>
              {meta}
            </span>
          </button>
          {amount != null && <Money value={amount} className="w-24 text-right font-medium" />}
          {actions}
        </div>
        {open && <Details why={why} evidence={evidence} confidence={confidence} policy={shownPolicy} runHref={runHref} recordHref={recordHref} className="px-3 pb-3 pl-9" />}
      </div>
    );
  }

  return (
    <article id={id} className={cn("rounded-lg border bg-card", state !== "open" && "opacity-75", className)}>
      <div className="flex items-start gap-3 p-3.5 pb-2">
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <h3 className="font-semibold leading-snug">{title}</h3>
          {meta}
        </div>
        {amount != null && <div className="text-right"><Money value={amount} className="text-[15px] font-semibold" /><div className="text-[11px] text-muted-foreground">amount</div></div>}
      </div>
      {open && <Details why={why} evidence={evidence} confidence={confidence} policy={shownPolicy} runHref={runHref} recordHref={recordHref} className="px-3.5 pb-3" />}
      <div className="flex items-center gap-2 border-t px-3.5 py-2">
        <button onClick={() => setOpen((o) => !o)} className="text-[12px] text-muted-foreground hover:text-foreground">{open ? "Hide details" : "Why?"}</button>
        <div className="ml-auto">{actions}</div>
      </div>
    </article>
  );
}

function Details({ why, evidence, confidence, policy, runHref, recordHref, className }: Pick<ApprovalItemProps, "why" | "evidence" | "confidence" | "policy" | "runHref" | "recordHref" | "className">) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ul className="flex flex-col gap-1 text-[12.5px] text-muted-foreground">
        {why.map((w) => <li key={w} className="flex gap-1.5"><CornerDownRight className="mt-0.5 size-3 shrink-0 opacity-60" />{w}</li>)}
      </ul>
      {policy && <div className="flex items-center gap-1.5 rounded-md bg-tone-warning/[0.08] px-2 py-1 text-[12px] text-tone-warning"><Lock className="size-3" />{policy}</div>}
      <div className="flex flex-wrap items-center gap-1.5">
        {confidence != null && <Confidence value={confidence} className="mr-1" />}
        {evidence?.map((e) => e.href
          ? <Link key={e.label} href={e.href} className="rounded border bg-background px-1.5 py-px text-[11.5px] hover:border-primary/40 hover:text-primary">{e.label}</Link>
          : <span key={e.label} className="rounded border bg-background px-1.5 py-px text-[11.5px]">{e.label}</span>)}
        <span className="ml-auto flex items-center gap-3 text-[12px]">
          {recordHref && <Link href={recordHref} className="text-muted-foreground hover:text-foreground">Open record</Link>}
          {runHref && <Link href={runHref} className="inline-flex items-center gap-1 text-primary hover:underline">View run <ExternalLink className="size-3" /></Link>}
        </span>
      </div>
    </div>
  );
}
