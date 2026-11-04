import "server-only";
import type { Actor, Row } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { asOfMonth, effective, metrics, type QueryCtx } from "@/server/query";
import { proposalsPage } from "@/ai/views";
import { formatDate } from "@/lib/format";
import type { MetricCtx } from "../../metrics";
import { budgetVsActual, cashForecast, incomeExpense } from "../../accounting/metrics";
import { addMonths, apAging, scoped } from "../metrics";

// Facts for the accountant home: the briefing, approvals and dashboard. Every figure is computed
// here from the ledger; nothing on the page is written by a model.

export type BriefingItem = { tone: "danger" | "warning" | "info" | "success"; text: string; href: string; action?: { label: string; href: string } };

const safe = <T,>(p: Promise<T>, fallback: T) => p.catch((e) => {
  console.error("[finance home]", e instanceof Error ? e.message : e);
  return fallback;
});

const EMPTY_Q = { rows: [], total: 0, page: 1, size: 0, counts: { needs_you: 0, auto_handled: 0, waiting: 0, decided: 0 } };
const noRows = <T,>() => ({ results: [] as T[], meta: { changes: 0 } });

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const monthName = (ym: string) => new Date(`${ym}-15T00:00:00Z`).toLocaleString("en-US", { month: "long", timeZone: "UTC" });

export async function financeHome(db: Db, ws: string | null, actor: Actor) {
  const q: QueryCtx = { db, ws, actor };
  const asOf = await asOfMonth(db);
  const m: MetricCtx = { db, ws, actor, propertyIds: actor.propertyIds, asOf };
  const lastClosed = addMonths(asOf, -1);
  const sb = scoped(m, "b.property_id");
  const data = { db, ws: ws ?? "base", actor };
  const today = (await db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>())?.value ?? `${asOf}-04`;

  const [aging, trust, unrec, ie, bva, forecast, spend, paid, ap, recon, pending, holds, miscoded, dueSoon, runs, overrun] = await Promise.all([
    safe(apAging(m), []),
    safe(metrics(q, "accounting.trust_cash"), { points: [] }),
    safe(metrics(q, "accounting.unreconciled"), { points: [] }),
    safe(incomeExpense(m, 12), []),
    safe(budgetVsActual(m), []),
    safe(cashForecast(m), null),
    safe(metrics(q, "payables.spend_by_gl"), { points: [] }),
    safe(metrics(q, "payables.paid_month"), { points: [] }),
    safe(proposalsPage(data, { queue: "needs_you", agent: "ap", size: 6 }), EMPTY_Q),
    safe(proposalsPage(data, { queue: "needs_you", agent: "reconciliation", size: 3 }), EMPTY_Q),
    safe(db.prepare(`SELECT count(*) AS n, coalesce(sum(b.amount_cents), 0) AS c FROM ${effective("bills", ws)} b WHERE b.status = 'Pending approval'${sb.sql}`).bind(...sb.binds).first<{ n: number; c: number }>(), null),
    safe(db.prepare(`SELECT v.id, v.company, v.bank_changed_at FROM ${effective("vendors", ws)} v
        WHERE v.bank_changed_at IS NOT NULL AND julianday(?) - julianday(substr(v.bank_changed_at, 1, 10)) <= 60
          AND NOT EXISTS (SELECT 1 FROM ${effective("data_issues", ws)} di WHERE di.rule_id = 'vendors.unverified_bank_change' AND di.entity_id = v.id AND di.status = 'fixed' AND di.fixed_at >= v.bank_changed_at)
        ORDER BY v.bank_changed_at DESC LIMIT 5`).bind(today).all<{ id: string; company: string; bank_changed_at: string }>(), noRows<{ id: string; company: string; bank_changed_at: string }>()),
    safe(db.prepare(`SELECT count(*) AS n FROM ${effective("data_issues", ws)} di WHERE di.rule_id LIKE '%gl_miscoded' AND di.status = 'open'`).first<{ n: number }>(), null),
    safe(db.prepare(`SELECT count(*) AS n, coalesce(sum(b.amount_cents), 0) AS c FROM ${effective("bills", ws)} b WHERE b.status = 'Approved' AND b.due_on <= date(?, '+7 days')${sb.sql}`).bind(today, ...sb.binds).first<{ n: number; c: number }>(), null),
    safe(db.prepare(`SELECT agent_key, count(*) AS n, sum(status = 'done') AS ok FROM ${effective("agent_runs", ws)} WHERE agent_key IN ('ap', 'reconciliation', 'data_health') AND started_at >= datetime(?, '-2 days') GROUP BY agent_key`).bind(today).all<{ agent_key: string; n: number; ok: number }>(), noRows<{ agent_key: string; n: number; ok: number }>()),
    // Largest expense overrun against budget, by property, in the last closed month.
    safe(db.prepare(`SELECT x.property_id, p.name, sum(x.actual) AS actual, sum(x.budget) AS budget FROM (
        SELECT j.property_id, j.debit_cents - j.credit_cents AS actual, 0 AS budget FROM ${effective("journal_entries", ws)} j JOIN ${effective("gl_accounts", ws)} g ON g.id = j.gl_account_id WHERE g.type = 'Expense' AND j.period = ?1
        UNION ALL SELECT l.property_id, 0, l.amount_cents FROM ${effective("budget_lines", ws)} l JOIN ${effective("gl_accounts", ws)} g ON g.id = l.gl_account_id WHERE g.type = 'Expense' AND l.period = ?1
      ) x JOIN ${effective("properties", ws)} p ON p.id = x.property_id WHERE 1 = 1${scoped(m, "x.property_id").sql.replace("?", "?2")}
      GROUP BY x.property_id HAVING budget > 0 ORDER BY (actual - budget) * 1.0 / budget DESC LIMIT 1`).bind(lastClosed, ...scoped(m, "x.property_id").binds).first<{ property_id: string; name: string; actual: number; budget: number }>(), null),
  ]);

  const openAp = aging.reduce((s, b) => s + b.amount, 0);
  const pastDue = aging.filter((b) => b.bucket !== "Current").reduce((s, b) => s + b.amount, 0);
  const closedBva = bva.filter((p) => p.actual != null);
  const ytdBudget = closedBva.reduce((s, p) => s + p.budget, 0);
  const ytdActual = closedBva.reduce((s, p) => s + (p.actual ?? 0), 0);
  const unrecPoints = (unrec.points ?? []) as Row[];
  const unrecCount = unrecPoints.reduce((s, p) => s + Number(p.count ?? 0), 0);
  const unmatched = Number(unrecPoints.find((p) => p.status === "Unmatched")?.count ?? 0);

  const needs: BriefingItem[] = [];
  if (pending?.n) needs.push({ tone: "warning", text: `${pending.n} bills (${usd(pending.c / 100)}) wait for approval`, href: "/app/payables/bills?view=to-approve" });
  for (const h of holds.results.slice(0, 2)) needs.push({ tone: "danger", text: `${h.company} changed bank details on ${formatDate(h.bank_changed_at)}. Payments are on hold until someone verifies by phone`, href: `/app/payables/bills?f.vendor_id=${h.id}&f.status=Pending%20approval,Approved` });
  if (unmatched) needs.push({ tone: "warning", text: `${unmatched} bank deposits have no matching ledger entry`, href: "/app/banking/transactions?view=unexplained-deposits" });
  if (miscoded?.n) needs.push({ tone: "info", text: `${miscoded.n} bills look miscoded. The Payables Agent suggests a recode`, href: "/app/payables/bills?view=data-issues" });
  if (dueSoon?.n) needs.push({ tone: "info", text: `${dueSoon.n} approved bills (${usd(dueSoon.c / 100)}) are due within 7 days and not yet paid`, href: "/app/payables/bills?view=ready-to-pay" });

  const watch: BriefingItem[] = [];
  if (forecast?.low && forecast.low.balance < forecast.opening * 0.6) watch.push({ tone: "warning", text: `Trust cash dips to ${usd(forecast.low.balance)} in the week of ${forecast.low.week}`, href: "/app/reports?r=cash_forecast" });
  if (overrun && overrun.actual > overrun.budget * 1.05) watch.push({ tone: "warning", text: `${overrun.name} spent ${Math.round(((overrun.actual - overrun.budget) / overrun.budget) * 100)}% over its ${monthName(lastClosed)} expense budget`, href: `/app/finance/budget-vs-actual?property=${overrun.property_id}` });
  if (pastDue > 0) watch.push({ tone: "danger", text: `${usd(pastDue)} of payables are past due`, href: "/app/payables/bills?view=past-due", action: { label: "Build payment run", href: "/app/finance/payment-run" } });
  if (ytdBudget && ytdActual > ytdBudget) watch.push({ tone: "warning", text: `Operating expense is ${Math.round(((ytdActual - ytdBudget) / ytdBudget) * 100)}% over budget year to date`, href: "/app/finance/budget-vs-actual" });

  const queueRows = [...ap.rows, ...recon.rows];
  return {
    asOf, lastClosed, today,
    kpis: {
      openAp, pastDue,
      unreconciled: unrecCount,
      trust: (trust as { value?: number | null }).value ?? null,
      noi: ie.at(-1)?.noi ?? null, noiPrev: ie.at(-2)?.noi ?? null, noiSpark: ie.map((p) => p.noi),
      expenseVar: ytdBudget ? (ytdActual - ytdBudget) / ytdBudget : null,
      paidMonth: (paid as { value?: number | null }).value ?? null, paidPrev: (paid as { previous?: number | null }).previous ?? null, paidSpark: ((paid as { spark?: number[] }).spark ?? []),
    },
    aging,
    incomeExpense: ie,
    bva,
    forecast,
    spend: (spend.points ?? []) as Row[],
    queue: { rows: queueRows, total: ap.total + recon.total },
    briefing: { needs, watch, runs: runs.results, holds: holds.results.length },
  };
}

export type FinanceHome = Awaited<ReturnType<typeof financeHome>>;
