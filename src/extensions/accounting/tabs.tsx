import Link from "next/link";
import { can } from "@/entities/registry";
import type { Row } from "@/entities/types";
import { currentSession } from "@/auth/session";
import { ChartCard } from "@/components/app/dashboard";
import { Money, StatusBadge } from "@/components/app/display";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { getPlatform } from "@/lib/platform";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AS_OF } from "@/seed/constants";
import { effective } from "@/server/query";
import { registerTab } from "../tabs";
import { Bva } from "./budget/Bva";
import { loadReconciliation } from "./recon/data";
import { ReconcileView, type ReconJson } from "./recon/ReconcileView";

// Custom record tabs for the accounting module (referenced from src/entities/defs/accounting.ts).

registerTab({
  key: "accounting.reconcile",
  label: "Reconcile",
  entity: "bank_reconciliations",
  component: async ({ id, actor }) => {
    const { ws } = await currentSession();
    const v = await loadReconciliation(getPlatform().db, ws, id).catch((e) => (console.error("[recon]", e), undefined));
    if (v === undefined) return <ErrorBanner title="The reconciliation couldn't load" message="Reload the page. If it keeps failing, open the bank transactions list for this account instead." />;
    if (!v) return <EmptyState title="Reconciliation not found" />;
    const party = (t: { kind: string; from_name: string; to_name: string; amount_cents: number }) => (t.amount_cents > 0 ? t.from_name : t.to_name);
    const r: ReconJson = {
      id: v.rec.id, account: v.rec.account, accountId: v.rec.bank_account_id, period: v.rec.period, status: v.rec.status,
      statement: v.rec.statement_cents / 100, book: v.rec.book_cents / 100, counts: v.counts, source: v.source,
      canAct: can(actor.role, "bank_transactions.match", "bank_transactions"),
      lines: v.matches.map((m) => ({
        id: m.line.id, posted_on: m.line.posted_on, description: m.line.description, amount: m.line.amount_cents / 100, status: m.status, confidence: m.confidence, why: m.why,
        unexplained: m.unexplained, issueId: v.issues[m.line.id]?.id ?? null,
        transfer: m.transfer && { id: m.transfer.id, on: m.transfer.on, amount: m.transfer.amount_cents / 100, kind: m.transfer.kind, party: party(m.transfer), ref: m.transfer.ref },
      })),
      ledgerOnly: v.unmatchedLedger.map((t) => ({ id: t.id, on: t.on, amount: t.amount_cents / 100, kind: t.kind, party: party(t), ref: t.ref })),
    };
    return <ReconcileView r={r} />;
  },
});

registerTab({
  key: "accounting.budget_grid",
  label: "Budget vs actual",
  entity: "budgets",
  component: async ({ row }) => {
    const session = await currentSession();
    const property = String(row.property_id);
    return <Bva session={session} year={Number(row.year)} type="Expense" property={property} explain={null} params={{ property, year: String(row.year) }} basePath="/app/finance/budget-vs-actual" />;
  },
});

type Milestone = { name?: string; due_on?: string | null; done_on?: string | null; pct?: number | null };

registerTab({
  key: "accounting.capex_milestones",
  label: "Progress",
  entity: "capex_projects",
  component: async ({ row }) => {
    const { ws } = await currentSession();
    const budget = Number(row.budget ?? 0);
    const spent = Number(row.spent ?? 0);
    const ratio = budget ? spent / budget : 0;
    const over = spent > budget;
    const ms = (Array.isArray(row.milestones) ? (row.milestones as Milestone[]) : []).slice().sort((a, b) => String(a.due_on ?? "").localeCompare(String(b.due_on ?? "")));
    const bills = await getPlatform().db
      .prepare(`SELECT b.id, b.bill_date, b.status, v.company, l.description, l.amount_cents FROM ${effective("bill_lines", ws)} l JOIN ${effective("bills", ws)} b ON b.id = l.bill_id
        LEFT JOIN ${effective("vendors", ws)} v ON v.id = b.vendor_id WHERE l.gl_account_id = 'gl-1500' AND b.property_id = ? AND b.status <> 'Void' ORDER BY b.bill_date DESC LIMIT 10`)
      .bind(String(row.property_id))
      .all<{ id: string; bill_date: string; status: string; company: string | null; description: string; amount_cents: number }>()
      .then((r) => r.results, () => []);
    return (
      <div className="space-y-4">
        <section className="rounded-lg border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
            <span><Money value={spent} style="whole" className="text-[16px] font-semibold" /> <span className="text-muted-foreground">spent of</span> <Money value={budget} style="whole" /></span>
            <span className={cn("font-medium tabular-nums", over ? "text-tone-danger" : "text-muted-foreground")}>
              {over ? <>Over budget by <Money value={spent - budget} style="whole" /> ({Math.round((ratio - 1) * 100)}%)</> : <>{Math.round(ratio * 100)}% used · <Money value={budget - spent} style="whole" /> left</>}
            </span>
          </div>
          <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label="Budget used">
            <span className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-tone-danger" : ratio > 0.9 ? "bg-tone-warning" : "bg-primary")} style={{ width: `${Math.min(1, over ? budget / spent : ratio) * 100}%` }} />
            {over && <span className="absolute inset-y-0 right-0 bg-tone-danger/40" style={{ width: `${(1 - budget / spent) * 100}%` }} />}
          </div>
          {over && <p className="mt-2 text-[12.5px] text-muted-foreground">Raise a change order or ask the regional manager to re-approve the budget before more spend is committed.</p>}
        </section>

        <section className="rounded-lg border">
          <h3 className="border-b px-3 py-2 text-[12.5px] font-semibold">Milestones</h3>
          {ms.length === 0 ? <p className="px-3 py-3 text-[12.5px] text-muted-foreground">No milestones recorded for this project.</p> : (
            <ol className="relative space-y-0 px-3 py-2">
              {ms.map((m, i) => {
                const late = !m.done_on && !!m.due_on && m.due_on < AS_OF;
                const state = m.done_on ? "Done" : late ? "Late" : "Upcoming";
                return (
                  <li key={i} className="relative flex gap-3 pb-3 last:pb-0">
                    <span className="flex flex-col items-center">
                      <span className={cn("mt-1 size-2.5 rounded-full ring-2 ring-card", state === "Done" ? "bg-tone-success" : state === "Late" ? "bg-tone-danger" : "bg-muted-foreground/40")} />
                      {i < ms.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
                    </span>
                    <div className="min-w-0 flex-1 text-[13px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{m.name ?? `Milestone ${i + 1}`}</span>
                        <StatusBadge value={state} tone={state === "Done" ? "success" : state === "Late" ? "danger" : "neutral"} />
                        {m.pct != null && <span className="text-[11.5px] text-muted-foreground tabular-nums">{Math.round(Number(m.pct) <= 1 ? Number(m.pct) * 100 : Number(m.pct))}% of scope</span>}
                      </div>
                      <p className="mt-0.5 text-[11.5px] text-muted-foreground">Due {m.due_on ? formatDate(m.due_on) : "—"}{m.done_on ? ` · done ${formatDate(m.done_on)}` : late ? ` · ${Math.round((Date.parse(AS_OF) - Date.parse(m.due_on!)) / 86_400_000)} days late` : ""}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="rounded-lg border">
          <h3 className="border-b px-3 py-2 text-[12.5px] font-semibold">Capital bills at this property <span className="font-normal text-muted-foreground">(GL 1500 Building improvements)</span></h3>
          {bills.length === 0 ? <p className="px-3 py-3 text-[12.5px] text-muted-foreground">No capital bills posted yet. Bills coded to 1500 at this property appear here.</p> : (
            <table className="w-full text-[12.5px]">
              <tbody className="divide-y">
                {bills.map((b) => (
                  <tr key={b.id + b.description} className="hover:bg-muted/40">
                    <td className="px-3 py-1.5"><Link href={`/app/payables/bills/${encodeURIComponent(b.id)}`} className="font-medium hover:text-primary hover:underline">{b.id}</Link></td>
                    <td className="max-w-0 truncate px-2 py-1.5">{b.company ?? "—"} · {b.description}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{formatDate(b.bill_date)}</td>
                    <td className="px-2 py-1.5"><StatusBadge value={b.status} /></td>
                    <td className="px-3 py-1.5 text-right"><Money value={b.amount_cents} cents /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    );
  },
});

registerTab({
  key: "accounting.readings",
  label: "Readings",
  entity: "utility_meters",
  component: async ({ id, row }: { id: string; row: Row }) => {
    const { ws } = await currentSession();
    const db = getPlatform().db;
    const [total, rows] = await Promise.all([
      db.prepare(`SELECT count(*) AS n FROM ${effective("meter_readings", ws)} WHERE meter_id = ?`).bind(id).first<{ n: number }>(),
      db.prepare(`SELECT r.id, r.read_on, r.reading, r.usage, (SELECT b.amount_cents FROM ${effective("utility_bills", ws)} b WHERE b.meter_id = r.meter_id AND b.period = substr(r.read_on, 1, 7)) AS cost_cents
        FROM ${effective("meter_readings", ws)} r WHERE r.meter_id = ? ORDER BY r.read_on DESC LIMIT 24`).bind(id).all<{ id: string; read_on: string; reading: number; usage: number | null; cost_cents: number | null }>(),
    ]);
    const list = rows.results;
    if (!list.length) return <EmptyState compact kind="chart" title="No readings yet" description="Monthly readings appear here once the meter is read or the utility's bill is imported." />;
    const unit = row.utility === "Electric" ? "kWh" : row.utility === "Gas" ? "therms" : "kgal";
    const chart = list.slice().reverse().map((r) => ({ month: r.read_on.slice(0, 7), label: new Date(`${r.read_on.slice(0, 7)}-15T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }), usage: r.usage, cost: r.cost_cents == null ? null : r.cost_cents / 100 }));
    const avg = list.filter((r) => r.usage != null).reduce((s, r, _, a) => s + Number(r.usage) / a.length, 0);
    return (
      <div className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard title={`Usage (${unit}) by month`} kind="bar" data={chart} x="label" series={[{ key: "usage", label: `Usage (${unit})`, format: "count" }]} height={200} />
          <ChartCard title="Cost by month" kind="line" data={chart} x="label" series={[{ key: "cost", label: "Cost", format: "money" }]} drill={`/app/accounting/utilities/bills?f.period={month}&f.property_id=${String(row.property_id)}`} height={200} />
        </div>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="bg-muted/40 text-[11.5px] text-muted-foreground">
              <tr><th scope="col" className="px-3 py-1.5 text-left font-medium">Read on</th><th scope="col" className="px-2 py-1.5 text-right font-medium">Reading</th><th scope="col" className="px-2 py-1.5 text-right font-medium">Usage ({unit})</th><th scope="col" className="px-2 py-1.5 text-right font-medium">vs average</th><th scope="col" className="px-3 py-1.5 text-right font-medium">Bill</th></tr>
            </thead>
            <tbody className="divide-y">
              {list.map((r) => {
                const d = r.usage != null && avg ? (Number(r.usage) - avg) / avg : null;
                return (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-3 py-1.5">{formatDate(r.read_on)}</td>
                    <td className="px-2 py-1.5 text-right">{formatNumber(r.reading, { decimals: true })}</td>
                    <td className="px-2 py-1.5 text-right">{formatNumber(r.usage, { decimals: true })}</td>
                    <td className={cn("px-2 py-1.5 text-right", d != null && Math.abs(d) >= 0.25 && "font-medium text-tone-warning")}>{d == null ? "—" : `${d >= 0 ? "+" : "−"}${Math.abs(Math.round(d * 100))}%`}</td>
                    <td className="px-3 py-1.5 text-right"><Money value={r.cost_cents} cents /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t px-3 py-1.5 text-[11.5px] text-muted-foreground">Latest {list.length} of {total?.n ?? list.length} readings. Usage 25% or more off the average is highlighted.</p>
        </div>
      </div>
    );
  },
});
