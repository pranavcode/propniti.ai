"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, UserRoundCog } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bulkSummary, runBulk, type BulkResult } from "./client";

// Bulk lead actions for the leasing homes. Each record runs through the same action as its own
// button (scope, stage and once-a-day checks, audit row); this only batches the requests.

export function SendFollowUps({ ids, label, who, size = "sm" }: { ids: string[]; label: string; who: string; size?: "sm" | "xs" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [total, setTotal] = useState(0);
  const busy = done != null && !result;

  const send = async () => {
    setTotal(ids.length);
    setDone(0);
    const r = await runBulk("prospects", "prospects.follow_up", ids, { onProgress: setDone });
    setResult(r);
    if (r.ok) toast.success(bulkSummary(r, "Follow-ups sent:"));
    else toast.error(r.errors[0] ?? "No follow-ups were sent");
    router.refresh();
  };
  const close = (o: boolean) => {
    if (busy) return;
    setOpen(o);
    if (!o) { setDone(null); setResult(null); }
  };

  // Stay mounted while the dialog is open: the refresh after sending can empty the list.
  if (!ids.length && !open) return null;
  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)} aria-label={`${label}: ${who}`}><Send data-icon="inline-start" />{label}</Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{result ? "Follow-ups sent" : `Send ${ids.length} follow-up${ids.length === 1 ? "" : "s"}?`}</DialogTitle>
            <DialogDescription>Each of {who} gets the standard follow-up email from you, offering a tour. Leads already contacted today, or no longer open, are skipped. Every send is logged on the lead.</DialogDescription>
          </DialogHeader>
          {done != null && (
            <div className="flex flex-col gap-1.5" role="status">
              <Progress value={total ? (done / total) * 100 : 100} aria-label="Sending follow-ups" />
              <p className="text-[12.5px] text-muted-foreground tabular-nums">{result ? bulkSummary(result, "Sent") : `Sending ${done} of ${total}…`}</p>
            </div>
          )}
          <DialogFooter>
            {result ? <Button onClick={() => close(false)}>Done</Button> : (
              <>
                <Button variant="outline" disabled={busy} onClick={() => close(false)}>Cancel</Button>
                <Button disabled={busy} onClick={() => void send()}>{busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}Send {ids.length}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// The broker picks another leasing agent; each lead moves only if that agent covers its property.
export function ReassignLeads({ leads, from, fromName, agents, size = "sm" }: { leads: { id: string; property: string }[]; from: string; fromName: string; agents: { id: string; name: string; properties: string[] }[]; size?: "sm" | "xs" }) {
  const ids = leads.map((l) => l.id);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [done, setDone] = useState<number | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const busy = done != null && !result;
  const others = agents.filter((a) => a.id !== from).map((a) => ({ ...a, covers: leads.filter((l) => a.properties.includes(l.property)).length })).sort((a, b) => b.covers - a.covers);
  const anyCover = others.some((a) => a.covers > 0);

  const run = async () => {
    setDone(0);
    const r = await runBulk("prospects", "prospects.reassign", ids, { input: { to }, onProgress: setDone });
    setResult(r);
    if (r.ok) toast.success(bulkSummary(r, "Leads reassigned:"));
    else toast.error(r.errors[0] ?? "No leads were reassigned");
    router.refresh();
  };
  const close = (o: boolean) => {
    if (busy) return;
    setOpen(o);
    if (!o) { setDone(null); setResult(null); setTo(""); }
  };

  if (!ids.length) return null;
  return (
    <>
      <Button size={size === "xs" ? "icon-xs" : "sm"} variant="ghost" onClick={() => setOpen(true)} aria-label={`Reassign ${fromName}'s stale leads`} title="Reassign stale leads"><UserRoundCog data-icon={size === "xs" ? undefined : "inline-start"} />{size === "xs" ? null : "Reassign"}</Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign {fromName}&rsquo;s {ids.length} stale lead{ids.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>Choose the leasing agent who takes them. Leads at properties that agent doesn&rsquo;t cover stay where they are. Each move is logged on the lead.</DialogDescription>
          </DialogHeader>
          {!anyCover && <p role="status" className="rounded-md bg-tone-warning/10 px-3 py-2 text-[12.5px] text-tone-warning">No other leasing agent is assigned to these leads&rsquo; properties. Give an agent those properties in Settings → Users, then reassign.</p>}
          <Select value={to} onValueChange={setTo} disabled={busy || !!result || !anyCover}>
            <SelectTrigger aria-label="New agent" className="w-full"><SelectValue placeholder="Choose an agent" /></SelectTrigger>
            <SelectContent>{others.map((a) => <SelectItem key={a.id} value={a.id} disabled={!a.covers}>{a.name} · {a.covers ? `covers ${a.covers === ids.length ? "all" : `${a.covers} of ${ids.length}`}` : "doesn't cover these properties"}</SelectItem>)}</SelectContent>
          </Select>
          {done != null && (
            <div className="flex flex-col gap-1.5" role="status">
              <Progress value={(done / ids.length) * 100} aria-label="Reassigning leads" />
              <p className="text-[12.5px] text-muted-foreground tabular-nums">{result ? bulkSummary(result, "Reassigned") : `Reassigning ${done} of ${ids.length}…`}</p>
            </div>
          )}
          <DialogFooter>
            {result ? <Button onClick={() => close(false)}>Done</Button> : (
              <>
                <Button variant="outline" disabled={busy} onClick={() => close(false)}>Cancel</Button>
                <Button disabled={busy || !to} onClick={() => void run()}>{busy ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <UserRoundCog data-icon="inline-start" />}Reassign {ids.length}</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
