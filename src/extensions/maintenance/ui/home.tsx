"use client";

import Link from "@/components/Link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Inbox } from "lucide-react";
import { ApprovalItem, AskBox } from "@/components/app/ai";
import { EmptyState } from "@/components/app/states";
import { useShellMaybe } from "@/components/app/shell/context";
import { AGENT_LABEL, sourceOf, type ProposalJson } from "@/ai/ui/client";

export function MxAsk({ suggestions }: { suggestions: string[] }) {
  const shell = useShellMaybe();
  return <AskBox size="md" suggestions={suggestions} onAsk={(q) => shell?.assistant.ask(q, { path: "/app/maintenance" })} placeholder="Ask about work orders, vendors, SLAs or make-readies…" />;
}

// Maintenance proposals waiting on a person: approve runs the proposal once (the decision row is a
// guarded insert on the server), reject records why it didn't happen.
export function MxApprovals({ rows, more }: { rows: ProposalJson[]; more: number }) {
  const router = useRouter();
  const decide = async (p: ProposalJson, decision: "approve" | "reject") => {
    const res = await fetch(`/api/ai/proposals/${encodeURIComponent(p.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "That didn't go through. Nothing was changed.");
      throw new Error(body.error);
    }
    toast.success(body.message ?? (decision === "approve" ? "Approved" : "Rejected"));
    router.refresh();
  };
  if (!rows.length) return <EmptyState compact kind="inbox" title="Nothing waiting on you" description="Triage, insurance and photo-check proposals that need a decision show here." action={{ label: "Open approvals", href: "/app/ai/approvals" }} />;
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {rows.map((p) => (
        <ApprovalItem key={p.id} variant="row" agent={AGENT_LABEL[p.agent] ?? p.agent} title={p.title} amount={p.amount_cents == null ? null : p.amount_cents / 100} risk={p.risk}
          why={p.why} evidence={p.evidence.map((e) => ({ label: e.label, href: e.href }))} confidence={p.confidence} runHref={p.run_id ? `/app/ai/runs/${p.run_id}` : undefined}
          recordHref={p.agent === "maintenance_triage" ? `/app/maintenance/intake/${encodeURIComponent(p.entity_id)}` : p.href} createdAt={p.created_at}
          source={sourceOf(p)} model={p.model ?? undefined} policy={p.queue_state === "waiting" ? "Waiting on the owner's approval" : undefined}
          canApprove={p.queue_state !== "waiting"} onApprove={() => decide(p, "approve")} onReject={() => decide(p, "reject")} />
      ))}
      {more > 0 && <Link href="/app/ai/approvals" className="flex items-center gap-1.5 border-t px-3 py-2 text-[12.5px] text-primary hover:bg-muted/40"><Inbox className="size-3.5" />{more} more in the approvals inbox</Link>}
    </div>
  );
}
