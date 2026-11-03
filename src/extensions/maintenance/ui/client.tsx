"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Client glue for the maintenance module: runs a named action through the generic action route
// and reports the result. One request at a time per control, so a double click sends once.

export const FIELD = "h-8 w-full rounded-md border bg-background text-foreground px-2 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-60";

export type ActionOut = { ok?: boolean; message?: string; href?: string; error?: string };

export async function postAction(entity: string, id: string, action: string, body: unknown = {}): Promise<ActionOut & { status: number }> {
  const res = await fetch(`/api/e/${entity}/${encodeURIComponent(id)}/actions/${encodeURIComponent(action)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}),
  }).catch(() => null);
  if (!res) return { status: 0, error: "You're offline or the server didn't answer. Nothing was changed." };
  const out = (await res.json().catch(() => ({}))) as ActionOut;
  return { ...out, status: res.status };
}

export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (entity: string, id: string, action: string, body?: unknown, opts: { follow?: boolean; quiet?: boolean } = {}) => {
    if (busy) return null;
    setBusy(action);
    try {
      const out = await postAction(entity, id, action, body);
      if (out.status !== 200) {
        toast.error(out.error ?? "Nothing was changed. Try again.");
        return null;
      }
      if (!opts.quiet) toast.success(out.message ?? "Done");
      if (out.href && opts.follow) router.push(out.href);
      else router.refresh();
      return out;
    } finally {
      setBusy(null);
    }
  };
  return { run, busy };
}

export function ActionButton({ entity, id, action, body, label, icon: Icon, variant = "outline", size = "sm", follow, className, disabled }: {
  entity: string; id: string; action: string; body?: unknown; label: string; icon?: React.ComponentType<{ className?: string }>;
  variant?: "default" | "outline" | "ghost" | "secondary" | "destructive"; size?: "sm" | "xs" | "default"; follow?: boolean; className?: string; disabled?: boolean;
}) {
  const { run, busy } = useAction();
  return (
    <Button type="button" size={size} variant={variant} className={className} disabled={disabled || !!busy} aria-busy={!!busy} onClick={() => run(entity, id, action, body, { follow })}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : Icon ? <Icon className="size-3.5" /> : null}
      {label}
    </Button>
  );
}

export function Section({ title, aside, children, className }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border bg-card", className)}>
      <header className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}
