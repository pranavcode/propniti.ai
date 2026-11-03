"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck, CircleDollarSign, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AISuggestion, ApprovalItem, type AISource, type Evidence, type Risk } from "@/components/app/ai";
import { ConfirmDialog } from "@/components/app/forms";
import { post, runBillAction } from "./actions-client";

// Interactive parts of the bill's Review and Lines tabs. Everything goes through the named bill
// actions or the proposal decision API, so guards and the audit log apply.

type Act = { key: string; label: string; money: boolean; confirm?: { title: string; body?: string } };

export function BillActionBar({ billId, actions, hold }: { billId: string; actions: Act[]; hold: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState<Act | null>(null);
  const shown = actions.filter((a) => ["bills.approve", "bills.approve_and_pay", "bills.pay"].includes(a.key));
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown.map((a) => (
        <Button key={a.key} size="sm" variant={a.key === "bills.approve" ? "default" : "outline"} disabled={!!hold} title={hold ?? undefined} onClick={() => setPending(a)}>
          {a.money ? <CircleDollarSign /> : <BadgeCheck />}{a.label}
        </Button>
      ))}
      {hold && <span className="text-[12px] text-tone-danger">On hold until the bank change is verified.</span>}
      <ConfirmDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)} tone="default" title={pending?.confirm?.title ?? `${pending?.label}?`} description={pending?.confirm?.body} confirmLabel={pending?.label}
        onConfirm={async () => {
          const r = await runBillAction(billId, pending!.key);
          toast.success(r.message ?? `${pending!.label} done`);
          router.refresh();
        }} />
    </div>
  );
}

export function ConfirmBankForm({ billId, company }: { billId: string; company: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [called, setCalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await runBillAction(billId, "bills.confirm_vendor_bank", { spoke_with: name.trim(), phone_on_file: true });
      toast.success(r.message ?? "Verified");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Not verified");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="mt-2 flex flex-col gap-2 rounded-md border bg-background p-3">
      <div className="text-[12.5px] font-medium">Record the phone verification</div>
      <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">Who at {company} confirmed the new account?
        <Input value={name} onChange={(e) => setName(e.target.value)} name="spoke_with" autoComplete="off" placeholder="Name and title…" className="max-w-sm" />
      </label>
      <label className="flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" checked={called} onChange={(e) => setCalled(e.target.checked)} className="mt-0.5" />
        <span>I called the phone number already on file, not one from the invoice or the change request.</span>
      </label>
      <div><Button type="submit" size="sm" disabled={busy || name.trim().length < 2 || !called}>{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}Confirm bank change</Button></div>
    </form>
  );
}

export function ProposalCard(p: { id: string; agent: string; title: string; amount: number | null; risk: Risk; why: string[]; evidence: Evidence[]; confidence: number; runHref?: string; createdAt: string; source: AISource; model?: string; decided?: string | null; canApprove: boolean }) {
  const router = useRouter();
  const decide = async (decision: "approve" | "reject") => {
    try {
      const r = await post<{ message?: string }>(`/api/ai/proposals/${encodeURIComponent(p.id)}`, { decision, note: "" });
      toast.success(r.message ?? (decision === "approve" ? "Approved" : "Rejected"));
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nothing changed");
      throw e;
    }
  };
  if (p.decided) {
    return <ApprovalItem variant="row" agent={p.agent} title={`${p.title} — ${p.decided.toLowerCase()}`} amount={p.amount} risk={p.risk} why={p.why} evidence={p.evidence} confidence={p.confidence} runHref={p.runHref} createdAt={p.createdAt} source={p.source} model={p.model} />;
  }
  return <ApprovalItem agent={p.agent} title={p.title} amount={p.amount} risk={p.risk} why={p.why} evidence={p.evidence} confidence={p.confidence} runHref={p.runHref} createdAt={p.createdAt} source={p.source} model={p.model}
    canApprove={p.canApprove} policy={p.canApprove ? undefined : "Your role can't decide this proposal"} onApprove={() => decide("approve")} onReject={() => decide("reject")} />;
}

export function RecodeSuggestion({ billId, lineId, issueId, glId, glLabel, description, why, confidence, source, canAct }: { billId: string; lineId: string; issueId?: string; glId: string; glLabel: string; description: string; why: string[]; confidence: number; source: AISource; canAct: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <>
      <AISuggestion title={<>Recode “{description}” to {glLabel}</>} why={why} confidence={confidence} source={source} acceptLabel="Review and recode"
        state={done ? "accepted" : "open"} onAccept={canAct ? () => setConfirm(true) : undefined} />
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} tone="default" title={`Recode this line to ${glLabel}?`}
        description="A suggested recode only takes effect when a person approves it. The change, the reason and who approved it are written to the audit log and the data-health fix log."
        confirmLabel="Approve recode"
        onConfirm={async () => {
          const r = await runBillAction(billId, "bills.recode", { line_id: lineId, gl_account_id: glId, ...(issueId ? { issue_id: issueId } : {}), agent: "ap" });
          toast.success(r.message ?? "Recoded");
          setDone(true);
          router.refresh();
        }} />
    </>
  );
}

