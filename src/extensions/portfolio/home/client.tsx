"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatPct } from "@/lib/format";
import { ApprovalItem, AskBox } from "@/components/app/ai";
import { Thumb } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { useShellMaybe } from "@/components/app/shell/context";
import { AGENT_LABEL, sourceOf, type ProposalJson } from "@/ai/ui/client";
import { ExplainButton } from "../ui/Explain";
import type { CompareRow } from "./data";

export function HomeAsk({ suggestions }: { suggestions: string[] }) {
  const shell = useShellMaybe();
  return <AskBox suggestions={suggestions} onAsk={(q) => shell?.assistant.ask(q, { path: "/app" })} placeholder="Ask or tell Propniti about your portfolio…" />;
}

export function ApprovalQueue({ rows, total }: { rows: ProposalJson[]; total: number }) {
  const router = useRouter();
  const decide = async (p: ProposalJson, decision: "approve" | "reject") => {
    const res = await fetch(`/api/ai/proposals/${encodeURIComponent(p.id)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(body.error ?? "That didn't go through");
      throw new Error(body.error);
    }
    toast.success(body.message ?? (decision === "approve" ? "Approved" : "Rejected"), body.href ? { action: { label: "View", onClick: () => router.push(body.href) } } : undefined);
    router.refresh();
  };
  if (!rows.length) return <EmptyState compact kind="inbox" title="Nothing waiting on you" description="Agent proposals that need a decision appear here." action={{ label: "Open approvals", href: "/app/ai/approvals" }} />;
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {rows.map((p) => (
        <ApprovalItem key={p.id} variant="row" agent={AGENT_LABEL[p.agent] ?? p.agent} title={p.title} amount={p.amount_cents == null ? null : p.amount_cents / 100} risk={p.risk}
          why={p.why} evidence={p.evidence.map((e) => ({ label: e.label, href: e.href }))} confidence={p.confidence} runHref={p.run_id ? `/app/ai/runs/${p.run_id}` : undefined}
          recordHref={p.href} createdAt={p.created_at} source={sourceOf(p)} model={p.model ?? undefined}
          onApprove={() => decide(p, "approve")} onReject={() => decide(p, "reject")} />
      ))}
      {total > rows.length && (
        <Link href="/app/ai/approvals" className="flex items-center gap-1.5 border-t px-3 py-2 text-[12.5px] text-primary hover:bg-muted/40"><Inbox className="size-3.5" />{total - rows.length} more in the approvals inbox</Link>
      )}
    </div>
  );
}

type SortKey = "name" | "units" | "occupancy" | "economic" | "noi" | "vsBudget" | "noiChange" | "collections" | "delinquent" | "sla";
const COLS: { key: SortKey; label: string; title?: string }[] = [
  { key: "units", label: "Units" },
  { key: "occupancy", label: "Occupancy", title: "Physical occupancy, last closed month" },
  { key: "economic", label: "Econ. occ.", title: "Economic occupancy: rent collected over gross potential rent" },
  { key: "noi", label: "NOI" },
  { key: "vsBudget", label: "vs budget" },
  { key: "noiChange", label: "NOI MoM" },
  { key: "collections", label: "Collected" },
  { key: "delinquent", label: "Delinquent" },
  { key: "sla", label: "WO SLA", title: "Work orders due last month that were completed inside SLA" },
];

const val = (r: CompareRow, k: SortKey): number | string | null =>
  k === "name" ? r.name : k === "noiChange" ? (r.noi != null && r.noiPrev ? (r.noi - r.noiPrev) / Math.abs(r.noiPrev) : null) : (r[k] as number | null);

// Regional comparison: one row per property, sortable, every number drills, and any property's
// NOI variance can be explained in place.
export function CompareTable({ rows }: { rows: CompareRow[] }) {
  const [sort, setSort] = useState<[SortKey, "asc" | "desc"]>(["vsBudget", "asc"]);
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const x = val(a, sort[0]), y = val(b, sort[0]);
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "string" ? x.localeCompare(String(y)) : x - Number(y);
    return sort[1] === "asc" ? c : -c;
  }), [rows, sort]);
  const totals = useMemo(() => {
    const units = rows.reduce((s, r) => s + r.units, 0);
    const noi = rows.reduce((s, r) => s + (r.noi ?? 0), 0);
    const budget = rows.reduce((s, r) => s + (r.budget ?? 0), 0);
    const prev = rows.reduce((s, r) => s + (r.noiPrev ?? 0), 0);
    const occ = units ? rows.reduce((s, r) => s + (r.occupancy ?? 0) * r.units, 0) / units : null;
    return { units, noi, vsBudget: budget ? (noi - budget) / budget : null, noiChange: prev ? (noi - prev) / prev : null, occ, delinquent: rows.reduce((s, r) => s + (r.delinquent ?? 0), 0) };
  }, [rows]);
  const head = (k: SortKey, label: string, title?: string, left?: boolean) => {
    const on = sort[0] === k;
    return (
      <th scope="col" title={title} aria-sort={on ? (sort[1] === "asc" ? "ascending" : "descending") : "none"} className={cn("sticky top-0 z-10 bg-muted/60 px-2.5 py-2 font-medium whitespace-nowrap backdrop-blur", left ? "text-left" : "text-right")}>
        <button type="button" onClick={() => setSort([k, on && sort[1] === "desc" ? "asc" : "desc"])} className={cn("inline-flex items-center gap-1 hover:text-foreground", on && "text-foreground")}>
          {label}{on && (sort[1] === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
        </button>
      </th>
    );
  };
  const pct = (v: number | null, digits = 1) => (v == null ? "—" : formatPct(v, digits));
  const signed = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}%`);
  if (!rows.length) return <EmptyState compact kind="table" title="No properties in your scope" description="Switch role to see a portfolio with properties." />;
  return (
    <div className="max-h-[560px] overflow-auto rounded-lg border bg-card">
      <table className="w-full min-w-[980px] text-[12.5px] tabular-nums">
        <thead className="text-[11.5px] text-muted-foreground">
          <tr>
            {head("name", "Property", undefined, true)}
            {COLS.map((c) => <Fragment key={c.key}>{head(c.key, c.label, c.title)}</Fragment>)}
            <th scope="col" className="sticky top-0 z-10 bg-muted/60 px-2.5 py-2 backdrop-blur"><span className="sr-only">Explain</span></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const change = val(r, "noiChange") as number | null;
            return (
              <tr key={r.id} className="group border-t hover:bg-muted/40">
                <td className="px-2.5 py-1.5">
                  <Link href={`/app/properties/${r.id}`} className="flex min-w-0 items-center gap-2.5">
                    <Thumb src={r.photo} size={30} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium group-hover:text-primary">{r.name}</span>
                      <span className="block text-[11.5px] text-muted-foreground">{r.metro}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-2.5 text-right">{r.units}</td>
                <td className="px-2.5 text-right">
                  <Link href={`/app/units?f.property_id=${r.id}&f.status=Vacant`} className="inline-flex items-center gap-2 hover:underline">
                    <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-muted lg:block"><span className={cn("block h-full rounded-full", (r.occupancy ?? 0) < 0.9 ? "bg-tone-warning" : "bg-tone-success/70")} style={{ width: `${Math.round((r.occupancy ?? 0) * 100)}%` }} /></span>
                    {pct(r.occupancy)}
                  </Link>
                </td>
                <td className="px-2.5 text-right">{pct(r.economic)}</td>
                <td className="px-2.5 text-right font-medium"><Link href={`/app/properties/${r.id}?tab=financials`} className="hover:underline">{r.noi == null ? "—" : formatMoney(r.noi, "whole")}</Link></td>
                <td className={cn("px-2.5 text-right", r.vsBudget != null && (r.vsBudget < -0.05 ? "font-medium text-tone-danger" : r.vsBudget >= 0 ? "text-tone-success" : "text-tone-warning"))}>{signed(r.vsBudget)}</td>
                <td className={cn("px-2.5 text-right", change != null && (change < 0 ? "text-tone-danger" : "text-tone-success"))}>{signed(change)}</td>
                <td className="px-2.5 text-right">{pct(r.collections)}</td>
                <td className="px-2.5 text-right"><Link href={`/app/receivables/charges?f.property_id=${r.id}&f.status=Overdue`} className="hover:underline">{r.delinquent == null ? "—" : formatMoney(r.delinquent, "whole")}</Link></td>
                <td className={cn("px-2.5 text-right", r.sla != null && r.sla < 0.9 && "text-tone-danger")}>
                  <Link href={`/app/maintenance/work-orders?f.property_id=${r.id}`} className="hover:underline" title={`${r.woDue} due, ${r.breached} missed SLA`}>{pct(r.sla, 0)}</Link>
                </td>
                <td className="px-1.5 text-right"><ExplainButton metric="portfolio.noi" property={r.id} label={`${r.name} NOI`} className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100">Variance</ExplainButton></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="sticky bottom-0 bg-muted/70 text-[12px] font-medium backdrop-blur">
          <tr className="border-t">
            <td className="px-2.5 py-2">{rows.length} properties</td>
            <td className="px-2.5 text-right">{totals.units.toLocaleString("en-US")}</td>
            <td className="px-2.5 text-right">{pct(totals.occ)}</td>
            <td />
            <td className="px-2.5 text-right">{formatMoney(totals.noi, "whole")}</td>
            <td className="px-2.5 text-right">{signed(totals.vsBudget)}</td>
            <td className="px-2.5 text-right">{signed(totals.noiChange)}</td>
            <td />
            <td className="px-2.5 text-right">{formatMoney(totals.delinquent, "whole")}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
