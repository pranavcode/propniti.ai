"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/forms/ConfirmDialog";

// Triage queue buttons on the maintenance home: dispatch one AI suggestion, or accept every
// high-confidence one at once. Both run work_orders.dispatch_suggested, which applies the approvals
// rule, the confidence threshold, insurance, scope and double-click checks on the server.

type Result = { id: string; status: number; error?: string; message?: string };
const MAX_BULK = 25;

async function dispatchSuggested(ids: string[], highOnly = false): Promise<Result[]> {
  if (ids.length === 1) {
    const res = await fetch(`/api/e/work_orders/${encodeURIComponent(ids[0])}/actions/dispatch_suggested`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const out = await res.json().catch(() => ({}));
    return [{ id: ids[0], status: res.status, error: out.error, message: out.message }];
  }
  const results: Result[] = [];
  for (let i = 0; i < ids.length; i += MAX_BULK) {
    const res = await fetch("/api/e/work_orders/actions/dispatch_suggested", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: ids.slice(i, i + MAX_BULK), input: { high_confidence_only: highOnly } }) });
    const out = await res.json().catch(() => ({}));
    results.push(...(out.results ?? [{ id: ids[i], status: res.status, error: out.error ?? "Nothing was changed" }]));
  }
  return results;
}

function report(results: Result[]) {
  const done = results.filter((r) => r.status === 200);
  const queued = results.filter((r) => r.status === 202);
  const failed = results.filter((r) => r.status !== 200 && r.status !== 202);
  if (results.length === 1) {
    const r = results[0];
    if (r.status === 200) toast.success(r.message ?? "Dispatched");
    else if (r.status === 202) toast.info(r.message ?? "Sent to Approvals");
    else toast.error(r.error ?? "Nothing was changed. Try again.");
    return;
  }
  const parts = [done.length && `${done.length} dispatched`, queued.length && `${queued.length} left in Approvals for an approver`, failed.length && `${failed.length} skipped`].filter(Boolean).join(", ");
  (done.length || queued.length ? toast.success : toast.error)(parts || "Nothing was changed", failed.length ? { description: failed.map((f) => f.error).filter(Boolean).slice(0, 2).join(" ") } : undefined);
}

export function DispatchSuggested({ id, note }: { id: string; note?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button type="button" size="xs" variant="outline" disabled={busy} aria-busy={busy} title={note}
      onClick={async () => { setBusy(true); try { report(await dispatchSuggested([id])); } finally { setBusy(false); router.refresh(); } }}>
      {busy ? <Loader2 className="size-3 animate-spin" /> : <Truck className="size-3" />}Dispatch as suggested
    </Button>
  );
}

export function AcceptSuggestions({ ids, toApprovals }: { ids: string[]; toApprovals: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ids.length) return null;
  const run = async () => {
    setBusy(true);
    try { report(await dispatchSuggested(ids, true)); } finally { setBusy(false); setOpen(false); router.refresh(); }
  };
  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setOpen(true)}>
        {busy ? <Loader2 className="animate-spin" /> : <CheckCheck />}Accept {ids.length} high-confidence suggestion{ids.length === 1 ? "" : "s"}
      </Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} title={`Dispatch ${ids.length} work order${ids.length === 1 ? "" : "s"} as the agent suggested?`}
        description={`Each goes to the vendor the Maintenance Triage agent picked.${toApprovals ? ` ${toApprovals} need${toApprovals === 1 ? "s" : ""} an approver your role isn't, and will stay in Approvals.` : ""} Vendors without a verified, current certificate are skipped.`}
        confirmLabel="Dispatch" tone="default" onConfirm={run} />
    </>
  );
}
