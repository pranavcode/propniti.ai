"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FixPreview } from "@/components/app/ai/FixPreview";
import { runAction, usd } from "./client";

export type WrongLeaseIssue = {
  id: string; status: string; paymentId: string; amount: number;
  from: { lease: string; label: string; charge: string | null };
  to: { lease: string; charge: string; description: string; household: string; due_on: string } | null;
  why: string[]; confidence: number; source: string; canApprove: boolean;
};

// "AI: fix this" for a payment posted to the neighbouring lease. Ledger changes always need a
// person with accounting approval; applying the fix is that approval, and it is audited.
export function WrongLeaseFix({ issue }: { issue: WrongLeaseIssue }) {
  const router = useRouter();
  if (issue.status !== "open") {
    return <p className="rounded-lg border bg-muted/40 px-3 py-2 text-[13px]">This payment was flagged as posted to the wrong lease and the issue is now <strong>{issue.status}</strong>. The change is in the audit log and the Data Health fix log.</p>;
  }
  if (!issue.to) {
    return <p className="rounded-lg border border-tone-warning/30 bg-tone-warning/[0.06] px-3 py-2 text-[13px]">Flagged as posted to the wrong lease, but no matching charge was found on a neighbouring lease. Check the payment’s reference with the resident before moving it.</p>;
  }
  const to = issue.to;
  return (
    <FixPreview
      title={`${usd(issue.amount)} payment looks posted to the wrong lease`}
      rule="payments.wrong_lease"
      changes={[
        { field: "lease_id", label: "Lease", before: issue.from.label, after: `${to.lease} (${to.household})` },
        { field: "charge_id", label: "Applied to", before: issue.from.charge ?? "unapplied", after: `${to.description}, due ${to.due_on}` },
      ]}
      why={issue.why}
      confidence={issue.confidence}
      source={issue.source}
      needsPerson={issue.canApprove ? "Moves a ledger entry: you approve it, and it's audited" : "Moves a ledger entry: needs an accountant or a manager with approval"}
      onApply={issue.canApprove ? async () => {
        const r = await runAction("payments", issue.paymentId, "move_to_lease", { to_charge_id: to.charge, issue_id: issue.id });
        if (!r.ok) {
          toast.error(r.error);
          throw new Error(r.error);
        }
        toast.success(r.message ?? "Payment moved");
        router.refresh();
      } : undefined}
    />
  );
}
