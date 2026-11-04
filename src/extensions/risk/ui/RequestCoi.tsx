"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// "Request certificate" for one lapsed vendor certificate, or "Request all" for a list. Runs
// vendor_cois.request_certificate through the actions API (the bulk route for more than one), so
// each vendor is asked at most once a week however often the button is pressed.

const MAX_BULK = 25;
type Result = { id: string; status: number; error?: string };

async function request(ids: string[]): Promise<Result[]> {
  if (ids.length === 1) {
    const res = await fetch(`/api/e/vendor_cois/${encodeURIComponent(ids[0])}/actions/request_certificate`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const out = await res.json().catch(() => ({}));
    return [{ id: ids[0], status: res.status, error: out.error }];
  }
  const results: Result[] = [];
  for (let i = 0; i < ids.length; i += MAX_BULK) {
    const res = await fetch("/api/e/vendor_cois/actions/request_certificate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: ids.slice(i, i + MAX_BULK) }) });
    const out = await res.json().catch(() => ({}));
    results.push(...(out.results ?? [{ id: ids[i], status: res.status, error: out.error ?? "Nothing was changed" }]));
  }
  return results;
}

export function RequestCoiButton({ ids, label, className }: { ids: string[]; label?: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!ids.length) return null;
  const all = ids.length > 1;
  const go = async () => {
    setBusy(true);
    try {
      const results = await request(ids);
      const ok = results.filter((r) => r.status === 200).length;
      const skipped = results.filter((r) => r.status !== 200);
      if (!all) {
        if (ok) toast.success("Asked the vendor for a current certificate");
        else toast.error(skipped[0]?.error ?? "Nothing was changed. Try again.");
      } else if (ok) {
        toast.success(`Asked ${ok} vendor${ok === 1 ? "" : "s"} for a current certificate`, skipped.length ? { description: `${skipped.length} skipped: ${skipped[0].error ?? "not available"}` } : undefined);
      } else {
        toast.error(`No requests sent: ${skipped[0]?.error ?? "nothing was changed"}`);
      }
      router.refresh();
    } catch {
      toast.error("You're offline or the server didn't answer. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" size="xs" variant="outline" disabled={busy} aria-busy={busy} onClick={go} className={cn("shrink-0", className)}>
      {busy ? <Loader2 className="size-3 animate-spin" /> : <BellRing className="size-3" />}
      {label ?? (all ? `Request all ${ids.length}` : "Request certificate")}
    </Button>
  );
}
