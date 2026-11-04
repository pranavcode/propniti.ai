import "server-only";
import { PERMISSIONS } from "@/auth/personas";
import { planMessage, reminder } from "@/ai/rules";
import { delinquency, type Delinquent } from "@/ai/facts";
import type { Role } from "@/entities/types";
import { AS_OF } from "@/seed/constants";
import { effective, type QueryCtx } from "@/server/query";
import { isSelfScope } from "./queries";

// Collections workbench data: delinquent leases (the Collections agent's own facts, first-in
// first-out aging), a risk score with plain reasons, the next step the agent's rules would take, a
// drafted message, and the agent's open proposal for the lease when there is one.

export type NextStep = "reminder" | "plan" | "legal";
export type Draft = { subject: string; body: string };
export type WorkbenchRow = {
  lease_id: string; property_id: string; property: string; unit: string; resident: string; resident_id: string | null; language: string;
  balance: number; days_late: number; oldest_due_on: string; aging: Delinquent["aging"]; lease_status: string; rent: number; nsf12: number;
  score: number; band: "High" | "Medium" | "Low"; why: string[]; step: NextStep; safe: boolean; drafts: { en: Draft; es: Draft } | null;
  // Lease rent 10× the unit's market rent is a typo (Data Health rule leases.rent_outlier). Charges
  // bill the right amount, so the balance is real, but "months of rent owed" would read a tenth of
  // the truth; the score uses the market rent instead and the row links to the fix.
  dataError: { rent: number; market: number; flagged: boolean } | null;
  proposal: { id: string; title: string; risk: "Low" | "Medium" | "High"; confidence: number; run_id: string | null; model: string | null; created_at: string; message: Draft | null; canDecide: boolean } | null;
};

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;


// Rules, not a model: every point in the score has a reason a person can check on the ledger.
export function scoreRisk(d: Delinquent, rentCents: number, nsf12: number) {
  const why: string[] = [];
  let score = 0;
  const pts = d.days_late > 90 ? 40 : d.days_late > 60 ? 30 : d.days_late > 30 ? 20 : 8;
  score += pts;
  why.push(`${d.days_late} days late (oldest unpaid charge due ${d.oldest_due_on})`);
  const months = rentCents > 0 ? d.balance_cents / rentCents : 0;
  const add = (pts: number, reason: string) => {
    score += pts;
    why.push(reason);
  };
  if (months >= 2) add(20, `Owes ${months.toFixed(1)} months of rent (${usd(d.balance_cents)})`);
  else if (months >= 1) add(12, `Owes about a month of rent (${usd(d.balance_cents)})`);
  else add(4, `Owes ${usd(d.balance_cents)}, less than a month's rent`);
  if (nsf12) add(Math.min(16, nsf12 * 8), `${nsf12} returned payment${nsf12 === 1 ? "" : "s"} in the last 12 months`);
  if (["Notice", "Eviction"].includes(d.lease_status)) add(10, `Lease status: ${d.lease_status}`);
  if (d.open_plan) add(-10, "A payment plan is already open");
  if (d.risk_score != null) {
    score = Math.round(score * 0.7 + d.risk_score * 0.3);
    why.push(`Payment-history score ${d.risk_score}/100`);
  }
  score = Math.max(0, Math.min(100, score));
  const step: NextStep = d.days_late > 90 ? "legal" : d.days_late > 30 && !d.open_plan ? "plan" : "reminder";
  return { score, band: (score >= 60 ? "High" : score >= 35 ? "Medium" : "Low") as WorkbenchRow["band"], why, step };
}

// Mirrors canDecide in src/ai/http.ts: low-risk, no-money proposals need write access to the
// proposal's module; anything else needs approve.
const canDecideAs = (role: Role, risk: string, amount: unknown) => {
  const access = PERMISSIONS[role].residents ?? "none";
  return risk !== "Low" || amount != null ? access === "approve" : access === "write" || access === "approve";
};

export async function workbench(ctx: QueryCtx, f: { property?: string; band?: string; step?: string; page: number; size: number }) {
  if (isSelfScope(ctx.actor)) return { rows: [] as WorkbenchRow[], total: 0, balance: 0, counts: { all: 0, High: 0, Medium: 0, Low: 0, reminder: 0, plan: 0, legal: 0, proposed: 0 }, page: f.page, size: f.size };
  const ws = ctx.ws ?? "~";
  const props = f.property ? [f.property] : ctx.actor.propertyIds === "all" ? undefined : ctx.actor.propertyIds;
  const all = await delinquency({ db: ctx.db, ws, actor: ctx.actor }, AS_OF, { minDays: 1, propertyIds: props, limit: 2000 });
  const ids = all.rows.map((r) => r.lease_id);
  const idList = JSON.stringify(ids);
  const [extra, nsf, proposals] = ids.length
    ? await Promise.all([
        ctx.db
          .prepare(
            `SELECT l.id, l.rent_cents, u.market_rent_cents,
               EXISTS (SELECT 1 FROM ${effective("data_issues", ctx.ws)} AS i WHERE i.entity_type = 'leases' AND i.entity_id = l.id AND i.rule_id = 'leases.rent_outlier' AND i.status = 'open') AS outlier
             FROM ${effective("leases", ctx.ws)} AS l LEFT JOIN ${effective("units", ctx.ws)} AS u ON u.id = l.unit_id WHERE l.id IN (SELECT value FROM json_each(?))`,
          )
          .bind(idList)
          .all<{ id: string; rent_cents: number; market_rent_cents: number | null; outlier: number }>(),
        ctx.db
          .prepare(`SELECT p.lease_id, count(*) AS n FROM ${effective("payments", ctx.ws)} AS p WHERE p.nsf = 1 AND p.received_on >= date('${AS_OF}', '-12 months') AND p.lease_id IN (SELECT value FROM json_each(?)) GROUP BY p.lease_id`)
          .bind(idList)
          .all<{ lease_id: string; n: number }>(),
        ctx.db
          .prepare(
            `SELECT p.* FROM ${effective("ai_proposals", ctx.ws)} AS p WHERE p.agent = 'collections' AND p.entity_type IN ('leases', 'households') AND p.queue_state <> 'auto_handled'
               AND NOT EXISTS (SELECT 1 FROM ${effective("ai_decisions", ctx.ws)} AS d WHERE d.proposal_id = p.id) AND p.entity_id IN (SELECT value FROM json_each(?)) ORDER BY p.created_at DESC`,
          )
          .bind(JSON.stringify([...ids, ...all.rows.map((r) => r.household_id)]))
          .all<Record<string, unknown>>(),
      ])
    : [{ results: [] }, { results: [] }, { results: [] }];
  const ex = new Map(extra.results.map((e) => [e.id, e]));
  const nsfBy = new Map(nsf.results.map((n) => [n.lease_id, n.n]));
  const prop = new Map<string, Record<string, unknown>>();
  for (const p of proposals.results) if (!prop.has(String(p.entity_id))) prop.set(String(p.entity_id), p);

  let rows: WorkbenchRow[] = all.rows.map((d) => {
    const e = ex.get(d.lease_id);
    const nsf12 = nsfBy.get(d.lease_id) ?? 0;
    const market = e?.market_rent_cents ?? 0;
    const dataError = e && (e.outlier || (market > 0 && e.rent_cents >= market * 5)) ? { rent: e.rent_cents, market, flagged: !!e.outlier } : null;
    // Same rounding as the Collections agent, so the preview matches what it sends.
    const s = scoreRisk(d, dataError ? market || Math.round(dataError.rent / 10) : e?.rent_cents ?? 0, nsf12);
    // The agent proposes per lease; precomputed proposals in the seed are per household.
    const p = prop.get(d.lease_id) ?? prop.get(d.household_id);
    // An open proposal decides the next step shown: that is what approving it will do.
    const proposed = p ? stepOf(String(p.action)) : null;
    const step = proposed ?? s.step;
    const payload = p ? safeJson<{ effects?: { kind: string; subject?: string; body?: string }[] }>(p.payload) : null;
    const msg = payload?.effects?.find((x) => x.kind === "message");
    return {
      lease_id: d.lease_id, property_id: d.property_id, property: d.property, unit: d.unit, resident: d.resident, resident_id: d.resident_id, language: d.language,
      balance: d.balance_cents, days_late: d.days_late, oldest_due_on: d.oldest_due_on, aging: d.aging, lease_status: d.lease_status, rent: e?.rent_cents ?? 0, nsf12,
      ...s, step, safe: step === "reminder", dataError,
      drafts: step === "legal" ? null : step === "plan" ? { en: planMessage({ ...d, language: "en" }), es: planMessage({ ...d, language: "es" }) } : { en: reminder({ ...d, language: "en" }), es: reminder({ ...d, language: "es" }) },
      proposal: p ? {
        id: String(p.id), title: String(p.title), risk: p.risk as "Low" | "Medium" | "High", confidence: Number(p.confidence), run_id: (p.run_id as string) ?? null, model: (p.model as string) ?? null, created_at: String(p.created_at),
        message: msg?.subject && msg.body ? { subject: msg.subject, body: msg.body } : null, canDecide: canDecideAs(ctx.actor.role, String(p.risk), p.amount_cents),
      } : null,
    };
  });
  const counts = { all: rows.length, High: 0, Medium: 0, Low: 0, reminder: 0, plan: 0, legal: 0, proposed: 0 };
  for (const r of rows) {
    counts[r.band]++;
    counts[r.step]++;
    if (r.proposal) counts.proposed++;
  }
  if (f.band) rows = rows.filter((r) => r.band === f.band);
  if (f.step) rows = rows.filter((r) => r.step === f.step);
  rows.sort((a, b) => b.score - a.score || b.balance - a.balance);
  const total = rows.length;
  const balance = rows.reduce((s, r) => s + r.balance, 0);
  return { rows: rows.slice((f.page - 1) * f.size, f.page * f.size), total, balance, counts, page: f.page, size: f.size };
}

const stepOf = (action: string): NextStep | null => (/reminder/.test(action) ? "reminder" : /plan/.test(action) ? "plan" : /legal/.test(action) ? "legal" : null);

function safeJson<T>(v: unknown): T | null {
  try {
    return typeof v === "string" ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
