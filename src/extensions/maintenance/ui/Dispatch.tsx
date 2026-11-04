"use client";

import { useState } from "react";
import Link from "@/components/Link";
import { usePathname, useRouter } from "next/navigation";
import { ExternalLink, Loader2, ShieldAlert, ShieldCheck, Star, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AISuggestion } from "@/components/app/ai";
import { RelativeDate, StatusBadge } from "@/components/app/display";
import { formatMoney, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { policyCheck, type Policy } from "../rules";
import { FIELD, useAction } from "./client";

export type DispatchVendor = { id: string; company: string; rating: number | null; open_jobs: number; on_time: number | null; median_cents: number | null; coi_expires: string | null; coi_ok: boolean; score: number; status: string };
export type DispatchSuggestion = { id: string; title: string; why: string[]; confidence: number; model: string | null; run_id: string | null; created_at: string; decision: string | null; queue_state: string; changes: Record<string, unknown> };

const TRADES = ["Plumbing", "HVAC", "Electrical", "Appliance", "Pest control", "Roofing", "Locksmith", "General", "Flooring", "Pool", "Landscaping", "Turn"];
const PRIORITY_TONE = { Emergency: "danger", Urgent: "warning", Normal: "neutral", Low: "neutral" } as const;

export function DispatchPanel({ wo, trade, suggestion, vendors, techs, policy }: {
  wo: { id: string; priority: string; category: string; estimate: number | null };
  trade: string;
  suggestion: DispatchSuggestion | null;
  vendors: DispatchVendor[];
  techs: { id: string; name: string; open: number }[];
  policy: Policy | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const { run, busy } = useAction();
  const s = suggestion?.changes ?? {};
  const agentVendor = (s.vendor_id as string | null | undefined) ?? null;
  const [priority, setPriority] = useState(String(s.priority ?? wo.priority));
  const [estimate, setEstimate] = useState(String(s.estimate_cents ? Number(s.estimate_cents) / 100 : wo.estimate ?? ""));
  const [mode, setMode] = useState<"vendor" | "tech">(agentVendor || vendors.some((v) => v.coi_ok) ? "vendor" : "tech");
  const [vendor, setVendor] = useState<string | null>(agentVendor ?? vendors.find((v) => v.coi_ok)?.id ?? null);
  const [tech, setTech] = useState(techs[0]?.id ?? "");
  const cents = Math.round((Number(estimate) || 0) * 100);
  const pol = policyCheck(cents, policy);
  const open = !suggestion?.decision && suggestion?.queue_state !== "auto_handled";

  const dispatch = (fromSuggestion = false) =>
    run("work_orders", wo.id, "work_orders.dispatch", {
      vendor_id: fromSuggestion ? agentVendor : mode === "vendor" ? vendor : null,
      assignee_id: (fromSuggestion ? !agentVendor : mode === "tech") ? tech || null : null,
      priority: fromSuggestion ? String(s.priority ?? priority) : priority,
      category: fromSuggestion ? String(s.category ?? trade) : trade,
      ...(fromSuggestion ? (s.estimate_cents ? { estimate: Number(s.estimate_cents) / 100 } : {}) : cents ? { estimate: cents / 100 } : {}),
      ...(suggestion && open ? { proposal_id: suggestion.id } : {}),
    }, { follow: false }).then((out) => { if (out) router.push(`/app/maintenance/work-orders/${encodeURIComponent(wo.id)}?tab=wo_timeline`); });

  const reject = async () => {
    if (!suggestion) return;
    const res = await fetch(`/api/ai/proposals/${encodeURIComponent(suggestion.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "reject", note: "Dispatcher chose differently" }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(body.error ?? "Couldn't record that");
    toast.success("Suggestion dismissed. Pick the vendor yourself below.");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      {suggestion ? (
        <AISuggestion
          title={`${open ? "Suggested" : suggestion.queue_state === "auto_handled" ? "Applied within policy" : "Decided"}: ${suggestion.title.replace(/^[\w-]+: /, "")}`}
          why={suggestion.why}
          confidence={suggestion.confidence}
          source={!suggestion.model || suggestion.model === "rules" ? "rules" : "live"}
          model={suggestion.model ?? undefined}
          generatedAt={suggestion.created_at}
          evidence={suggestion.run_id ? [{ label: "Agent run and trace", href: `/app/ai/runs/${suggestion.run_id}` }] : []}
          acceptLabel={pol.level === "owner" ? "Accept and ask owner" : "Accept and dispatch"}
          state={suggestion.decision === "Rejected" ? "rejected" : "open"}
          onAccept={open ? () => dispatch(true) : undefined}
          onReject={open ? reject : undefined}
        />
      ) : null}

      <section className="rounded-lg border bg-card">
        <header className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5">
          <h2 className="text-[13px] font-semibold">Dispatch</h2>
          <span className="text-[12px] text-muted-foreground">Change anything the agent suggested. Vendors without current insurance can&apos;t be picked.</span>
        </header>
        <div className="grid gap-3 border-b p-3 sm:grid-cols-3">
          <label className="grid gap-1 text-[12px] text-muted-foreground">Trade
            <select className={FIELD} value={trade} onChange={(e) => router.replace(`${path}?trade=${encodeURIComponent(e.target.value)}`, { scroll: false })} disabled={!!busy}>
              {[...new Set([trade, ...TRADES])].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] text-muted-foreground">Priority
            <select className={FIELD} value={priority} onChange={(e) => setPriority(e.target.value)} disabled={!!busy}>
              {["Emergency", "Urgent", "Normal", "Low"].map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] text-muted-foreground">Estimate ($)
            <input autoComplete="off" className={cn(FIELD, "tabular-nums")} inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value.replace(/[^\d.]/g, ""))} disabled={!!busy} />
          </label>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "vendor" | "tech")} className="border-b px-3 pt-2">
          <TabsList variant="line" aria-label="Who does the work">
            <TabsTrigger value="vendor">Vendors · {vendors.length}</TabsTrigger>
            <TabsTrigger value="tech">In-house · {techs.length}</TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "vendor" ? (
          vendors.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead><tr className="border-b text-left text-[11.5px] text-muted-foreground">
                  <th className="w-8 px-3 py-1.5" /><th className="px-2 py-1.5 font-normal">Vendor</th><th className="px-2 py-1.5 text-right font-normal">Rating</th><th className="px-2 py-1.5 text-right font-normal">On time</th>
                  <th className="px-2 py-1.5 text-right font-normal">Typical cost</th><th className="px-2 py-1.5 text-right font-normal">Open jobs</th><th className="px-3 py-1.5 font-normal">Insurance</th>
                </tr></thead>
                <tbody>
                  {vendors.map((v, i) => (
                    <tr key={v.id} className={cn("border-b last:border-0", v.coi_ok ? "cursor-pointer hover:bg-muted/40" : "opacity-60", vendor === v.id && "bg-primary/[0.05]")} onClick={() => v.coi_ok && setVendor(v.id)}>
                      <td className="px-3 py-2"><input type="radio" name="vendor" aria-label={v.company} className="size-4 accent-[var(--primary)]" checked={vendor === v.id} disabled={!v.coi_ok} onChange={() => setVendor(v.id)} /></td>
                      <td className="px-2 py-2">
                        <span className="flex items-center gap-1.5 font-medium">{i === 0 && v.coi_ok && <span className="rounded bg-muted px-1 text-[10.5px] font-medium text-muted-foreground">#1</span>}{v.company}{v.id === agentVendor && <StatusBadge value="Agent's pick" tone="ai" />}</span>
                        <Link href={`/app/maintenance/vendors/${v.id}`} onClick={(e) => e.stopPropagation()} className="text-[11.5px] text-muted-foreground hover:underline">Score {v.score} <ExternalLink className="inline size-3" /></Link>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{v.rating != null ? <><Star className="mr-0.5 inline size-3 fill-current text-tone-warning" />{v.rating.toFixed(1)}</> : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{v.on_time != null ? formatPct(v.on_time, 0) : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{v.median_cents != null ? formatMoney(v.median_cents / 100, "whole") : "—"}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{v.open_jobs}</td>
                      <td className="px-3 py-2">{v.coi_ok
                        ? <span className="inline-flex items-center gap-1 text-[12px] text-tone-success"><ShieldCheck className="size-3.5" />To <RelativeDate value={v.coi_expires} mode="date" /></span>
                        : <span className="inline-flex items-center gap-1 text-[12px] text-tone-danger"><ShieldAlert className="size-3.5" />{v.status !== "Active" ? v.status : v.coi_expires ? <>Expired <RelativeDate value={v.coi_expires} mode="date" /></> : "No COI"}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="px-3 py-4 text-[12.5px] text-muted-foreground">No {trade.toLowerCase()} vendors cover this property&apos;s metro. Change the trade or send an in-house technician.</p>
        ) : (
          <div className="p-3">
            {techs.length ? (
              <label className="grid max-w-sm gap-1 text-[12px] text-muted-foreground">Technician
                <select className={FIELD} value={tech} onChange={(e) => setTech(e.target.value)}>{techs.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.open} open</option>)}</select>
              </label>
            ) : <p className="text-[12.5px] text-muted-foreground">No in-house technicians have jobs in your scope.</p>}
          </div>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-3">
          <p className={cn("flex max-w-xl items-start gap-1.5 text-[12.5px]", pol.level === "owner" ? "text-tone-warning" : "text-muted-foreground")}>
            <StatusBadge value={pol.level === "auto" ? "Within limit" : pol.level === "owner" ? "Owner approves" : "Needs approver"} tone={pol.level === "auto" ? "success" : "warning"} className="shrink-0" />{pol.text}
          </p>
          <div className="flex items-center gap-2">
            <StatusBadge value={priority} tone={PRIORITY_TONE[priority as keyof typeof PRIORITY_TONE] ?? "neutral"} />
            <Button disabled={!!busy || (mode === "vendor" ? !vendor : !tech)} onClick={() => dispatch(false)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}{pol.level === "owner" ? "Line up and ask owner" : "Dispatch"}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
