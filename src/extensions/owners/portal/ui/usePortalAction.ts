"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

// Runs a named action on the portal user's own record through the generic action route, with a
// toast and a refresh of the server-rendered page. Returns the result so forms can react to it.
export function usePortalAction(entity: string, id: string) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (action: string, body: unknown, opts: { quiet?: boolean } = {}): Promise<{ ok: boolean; message?: string; href?: string }> => {
    setBusy(action);
    try {
      const res = await fetch(`/api/e/${entity}/${encodeURIComponent(id)}/actions/${entity}.${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(out.error ?? "That didn't go through. Try again.");
        return { ok: false, message: out.error };
      }
      if (!opts.quiet) toast.success(out.message ?? "Done");
      router.refresh();
      return { ok: true, message: out.message, href: out.href };
    } catch {
      toast.error("You seem to be offline. Nothing was changed.");
      return { ok: false };
    } finally {
      setBusy(null);
    }
  };
  return { run, busy };
}
