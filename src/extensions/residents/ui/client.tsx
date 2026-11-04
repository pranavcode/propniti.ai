"use client";

import { useState } from "react";
import Link from "@/components/Link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ExternalLink, GitMerge, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AIBadge, Confidence, FixPreview, type FixChange } from "@/components/app/ai";
import { apiJson } from "@/components/app/forms/api";
import { cn } from "@/lib/utils";

// Client pieces for the residents lane: action buttons, the duplicate merge dialog and the
// data-health fix cards. All writes go through the named-action API (audited server-side).

export async function runAction(entity: string, id: string, action: string, body: unknown = {}) {
  return apiJson<{ ok: boolean; queued?: boolean; message?: string; href?: string }>("POST", `/api/e/${entity}/${encodeURIComponent(id)}/actions/${action}`, body);
}

export function ActionButton({ entity, id, action, body, label, icon, variant = "outline", size = "sm", className, refresh = true }: {
  entity: string; id: string; action: string; body?: unknown; label: string; icon?: "ai"; variant?: "default" | "outline" | "ghost" | "secondary"; size?: "sm" | "default" | "xs"; className?: string; refresh?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button size={size} variant={variant} className={className} disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const r = await runAction(entity, id, action, body);
        if (r.queued) toast.info(r.message ?? "Sent to the approvals inbox");
        else toast.success(r.message ?? "Done");
        if (r.href) router.push(r.href);
        else if (refresh) router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Nothing was changed. Try again.");
      } finally {
        setBusy(false);
      }
    }}>
      {busy ? <Loader2 className="animate-spin" /> : icon === "ai" ? <Sparkles /> : null}
      {label}
    </Button>
  );
}

// Applies or dismisses a data-health issue through the Data Health endpoint (runs as an agent run,
// logs before/after to data_fix_log and the audit trail).
export function IssueFix({ issueId, title, rule, changes, why, confidence, source, needsPerson, applyVia }: {
  issueId?: string; title: string; rule?: string; changes: FixChange[]; why: string[]; confidence: number; source: string; needsPerson?: string | null;
  applyVia?: { entity: string; id: string; action: string };
}) {
  const router = useRouter();
  const call = async (kind: "apply" | "dismiss") => {
    try {
      const r = kind === "apply" && applyVia
        ? await runAction(applyVia.entity, applyVia.id, applyVia.action)
        : await apiJson<{ message?: string; queued?: boolean }>("POST", `/api/ai/data-health/issues/${encodeURIComponent(issueId!)}`, { action: kind });
      if (r.queued) toast.info(r.message ?? "Sent to the approvals inbox");
      else toast.success(r.message ?? (kind === "apply" ? "Fix applied" : "Dismissed"));
      router.refresh();
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Nothing was changed.");
      throw e;
    }
  };
  return (
    <section aria-label={title}>
      <FixPreview title={title} rule={rule} changes={changes} why={why} confidence={confidence} source={source} needsPerson={needsPerson}
        onApply={() => call("apply")} onDismiss={issueId ? () => call("dismiss") : undefined} />
    </section>
  );
}

export type MergeSide = { id: string; label: string; values: Record<string, string> };

export function MergeDialog({ keep, dup, fields, suggestion, issueId }: {
  keep: MergeSide; dup: MergeSide; fields: { key: string; label: string }[];
  suggestion: { choice: Record<string, "keep" | "duplicate">; why: string[]; confidence: number }; issueId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(suggestion.choice);
  const [busy, setBusy] = useState(false);
  const changed = fields.filter((f) => choice[f.key] !== suggestion.choice[f.key]).length;
  const cell = (f: { key: string }, side: "keep" | "duplicate") => {
    const v = (side === "keep" ? keep : dup).values[f.key];
    const on = choice[f.key] === side;
    const same = keep.values[f.key] === dup.values[f.key];
    return (
      <td className="p-1">
        <button type="button" disabled={same} aria-pressed={on} onClick={() => setChoice((c) => ({ ...c, [f.key]: side }))}
          className={cn("flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[12.5px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            same ? "border-transparent text-muted-foreground" : on ? "border-primary bg-primary/[0.06] font-medium" : "border-dashed hover:border-primary/40")}>
          {!same && <span className={cn("grid size-3.5 shrink-0 place-items-center rounded-full border", on && "border-primary bg-primary text-primary-foreground")}>{on && <Check className="size-2.5" />}</span>}
          <span className="min-w-0 truncate">{v || <span className="italic text-muted-foreground">empty</span>}</span>
        </button>
      </td>
    );
  };
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><GitMerge /> Review merge</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Merge duplicate resident</DialogTitle>
            <DialogDescription>Pick the value to keep for each field. The duplicate record is removed; its conversations and requests move to the record you keep. Ledger history belongs to the household and doesn&apos;t change.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-tone-ai/25 bg-tone-ai/[0.04] px-3 py-2">
            <div className="flex items-center gap-2 text-[12.5px] font-medium"><Sparkles className="size-3.5 text-tone-ai" />Suggested field choices<AIBadge source="rules" size="xs" /><Confidence value={suggestion.confidence} className="ml-auto" /></div>
            <ul className="mt-1 list-disc pl-5 text-[12px] text-muted-foreground">{suggestion.why.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
          <table className="w-full table-fixed">
            <thead>
              <tr className="text-left text-[11.5px] text-muted-foreground">
                <th className="w-32 pb-1 font-medium">Field</th>
                <th className="pb-1 pl-1 font-medium"><Link href={`/app/residents/${encodeURIComponent(keep.id)}`} className="hover:underline">Keep · {keep.label}</Link></th>
                <th className="pb-1 pl-1 font-medium"><Link href={`/app/residents/${encodeURIComponent(dup.id)}`} className="inline-flex items-center gap-1 hover:underline">Duplicate · {dup.label}<ExternalLink className="size-3" /></Link></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.key} className="border-t">
                  <td className="py-1 pr-2 text-[12.5px] text-muted-foreground">{f.label}</td>
                  {cell(f, "keep")}
                  {cell(f, "duplicate")}
                </tr>
              ))}
            </tbody>
          </table>
          <DialogFooter className="items-center">
            <span className="mr-auto text-[12px] text-muted-foreground">{changed ? `${changed} choice${changed === 1 ? "" : "s"} changed from the suggestion` : "Using the suggested choices"} · logged with before and after values</span>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const r = await runAction("residents", keep.id, "residents.merge", { duplicate_id: dup.id, choice, issue_id: issueId });
                toast.success(r.message ?? "Merged");
                setOpen(false);
                router.refresh();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Nothing was merged.");
              } finally {
                setBusy(false);
              }
            }}>{busy ? <Loader2 className="animate-spin" /> : <GitMerge />} Merge into {keep.label}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
