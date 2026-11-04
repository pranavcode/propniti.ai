import { z } from "zod";
import { can } from "@/entities";
import type { ActionContext } from "@/entities/types";
import { AS_OF } from "@/seed/constants";
import { effective } from "@/server/effective";
import { payBill } from "@/server/money";
import { nowIso } from "@/server/workspace";
import { bankHold } from "./actions";

// Payment run: pay approved past-due bills in a batch. Each bill still goes through payBill
// (trust balance guard, one vendor:<bill> transfer per bill, fraud-hold guard in SQL), so a double
// submit or two people running the same selection pay each bill once. A vendor with an unverified
// bank change is skipped. A bill over the bill-payment approval limit isn't paid from the run; it
// goes to the approvals inbox for the policy's approver (or the owner, above the owner's threshold).

export const PaymentRunInput = z.strictObject({ ids: z.array(z.string().min(1).max(80)).min(1).max(25) });
export const RUN_CHUNK = 25;

export type OverLimit = { limit_cents: number | null; approver: string; owner: boolean };
export type RunBill = {
  id: string; vendor_id: string; vendor: string; property_id: string; property: string; owner_entity_id: string; invoice_number: string;
  due_on: string; days_past_due: number; amount_cents: number; hold: string | null; over_limit: OverLimit | null;
};
export type RunVendor = { vendor_id: string; vendor: string; total_cents: number; hold: string | null; bills: RunBill[] };
export type RunResult = { id: string; outcome: "paid" | "approval" | "held" | "failed" | "skipped"; message: string; amount_cents?: number };

type Ctx = Pick<ActionContext, "db" | "ws" | "actor">;
type Policy = { owner_entity_id: string | null; limit_cents: number | null; approver_role: string; owner_approval_over_cents: number | null };

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Approved bills not yet paid, in the actor's properties. `ids` narrows to a selection; `pastDue`
// keeps only bills due before today.
async function approvedBills(ctx: Ctx, f: { ids?: string[]; pastDue?: boolean }): Promise<Omit<RunBill, "hold" | "over_limit">[]> {
  const scope = ctx.actor.propertyIds === "all" ? null : JSON.stringify(ctx.actor.propertyIds);
  const { results } = await ctx.db
    .prepare(
      `SELECT b.id, b.vendor_id, v.company AS vendor, b.property_id, p.name AS property, b.owner_entity_id, b.invoice_number, b.due_on, b.amount_cents,
         CAST(julianday(?2) - julianday(b.due_on) AS INTEGER) AS days_past_due
       FROM ${effective("bills")} AS b JOIN ${effective("vendors")} AS v ON v.id = b.vendor_id JOIN ${effective("properties")} AS p ON p.id = b.property_id
       WHERE b.status = 'Approved'
         AND NOT EXISTS (SELECT 1 FROM transfers AS t WHERE t.workspace_id IN ('base', ?1) AND t.key = 'vendor:' || b.id AND t.status <> 'Returned')
         ${f.pastDue ? "AND b.due_on < ?2" : ""}
         ${scope ? "AND b.property_id IN (SELECT value FROM json_each(?3))" : "AND ?3 IS NULL"}
         ${f.ids ? "AND b.id IN (SELECT value FROM json_each(?4))" : "AND ?4 IS NULL"}
       ORDER BY v.company, b.due_on, b.id LIMIT 500`,
    )
    .bind(ctx.ws, AS_OF, scope, f.ids ? JSON.stringify(f.ids) : null)
    .all<Omit<RunBill, "hold" | "over_limit">>();
  return results.map((r) => ({ ...r }));
}

async function billPolicies(ctx: Ctx): Promise<Policy[]> {
  const { results } = await ctx.db.prepare(`SELECT owner_entity_id, limit_cents, approver_role, owner_approval_over_cents FROM ${effective("approval_policies")} AS a WHERE a.category = 'Bill payment'`).bind(ctx.ws).all<Policy>();
  return results;
}

// The owner entity's own bill-payment policy wins over the org default. No policy, or a policy with
// no limit, means a person approves every bill.
function overLimit(policies: Policy[], b: { owner_entity_id: string; amount_cents: number }): OverLimit | null {
  const p = policies.find((x) => x.owner_entity_id === b.owner_entity_id) ?? policies.find((x) => x.owner_entity_id == null);
  if (p && p.limit_cents != null && b.amount_cents <= p.limit_cents) return null;
  const owner = p?.owner_approval_over_cents != null && b.amount_cents > p.owner_approval_over_cents;
  return { limit_cents: p?.limit_cents ?? null, approver: owner ? "owner" : p?.approver_role ?? "accountant", owner };
}

async function classify(ctx: Ctx, rows: Omit<RunBill, "hold" | "over_limit">[]): Promise<RunBill[]> {
  const policies = await billPolicies(ctx);
  const vendors = [...new Set(rows.map((r) => r.vendor_id))];
  const holds = new Map(await Promise.all(vendors.map(async (v) => [v, await bankHold(ctx, v)] as const)));
  return rows.map((r) => ({ ...r, hold: holds.get(r.vendor_id) ?? null, over_limit: overLimit(policies, r) }));
}

export async function paymentRunCandidates(ctx: Ctx) {
  const scope = ctx.actor.propertyIds === "all" ? null : JSON.stringify(ctx.actor.propertyIds);
  const [rows, pending] = await Promise.all([
    approvedBills(ctx, { pastDue: true }),
    ctx.db
      .prepare(`SELECT count(*) AS n, coalesce(sum(b.amount_cents), 0) AS cents FROM ${effective("bills")} AS b WHERE b.status = 'Pending approval' AND b.due_on < ?2 ${scope ? "AND b.property_id IN (SELECT value FROM json_each(?3))" : "AND ?3 IS NULL"}`)
      .bind(ctx.ws, AS_OF, scope)
      .first<{ n: number; cents: number }>(),
  ]);
  const byVendor = new Map<string, RunVendor>();
  for (const b of await classify(ctx, rows)) {
    const v = byVendor.get(b.vendor_id) ?? byVendor.set(b.vendor_id, { vendor_id: b.vendor_id, vendor: b.vendor, total_cents: 0, hold: b.hold, bills: [] }).get(b.vendor_id)!;
    v.bills.push(b);
    v.total_cents += b.amount_cents;
  }
  return { vendors: [...byVendor.values()], pendingApproval: { n: Number(pending?.n ?? 0), cents: Number(pending?.cents ?? 0) } };
}

// One open bills.pay proposal per bill: the deterministic id and the NOT EXISTS guard make a second
// run (or a double submit) add nothing.
async function sendToApprovals(ctx: ActionContext, b: RunBill): Promise<RunResult> {
  const o = b.over_limit!;
  const limit = o.limit_cents == null ? "Every bill payment needs a person's approval" : `${usd(b.amount_cents)} is over the ${usd(o.limit_cents)} bill-payment limit`;
  const why = [limit, o.owner ? "Above the owner's approval threshold: the owner approves it in their portal" : `Sent from a payment run by ${ctx.actor.name}`];
  const r = await ctx.db
    .prepare(
      `INSERT INTO ai_proposals (workspace_id, id, agent, entity_type, entity_id, property_id, action, title, payload, why, evidence, confidence, risk, amount_cents, queue_state, assignee_role, model, created_at)
       SELECT ?1, ?2, 'ap', 'bills', ?3, ?4, 'bills.pay', ?5, '{}', ?6, ?7, 1, 'Medium', ?8, ?9, ?10, 'rules', ?11
       WHERE NOT EXISTS (SELECT 1 FROM ${effective("ai_proposals")} AS p WHERE p.entity_id = ?3 AND p.action = 'bills.pay'
         AND NOT EXISTS (SELECT 1 FROM ${effective("ai_decisions")} AS d WHERE d.proposal_id = p.id))
       ON CONFLICT DO NOTHING`,
    )
    .bind(ctx.ws, `prop-payrun-${b.id}`, b.id, b.property_id, `Pay ${b.vendor} ${usd(b.amount_cents)} (${b.invoice_number})`, JSON.stringify(why),
      JSON.stringify([{ entity_type: "bills", entity_id: b.id, label: `${b.invoice_number} · ${b.property}` }]), b.amount_cents, o.owner ? "waiting" : "needs_you", o.approver, nowIso(ctx.nowMs))
    .run();
  const to = o.owner ? "the owner" : `the ${o.approver.replace(/_/g, " ")}`;
  return r.meta.changes
    ? { id: b.id, outcome: "approval", message: `Sent to ${to} for approval: ${limit.toLowerCase()}.`, amount_cents: b.amount_cents }
    : { id: b.id, outcome: "approval", message: `Already waiting in the approvals inbox for ${to}.`, amount_cents: b.amount_cents };
}

// Pays a selection (at most RUN_CHUNK bills per call; the page sends bigger runs in chunks). Status
// is 200 when anything was paid or newly sent for approval, 409 when nothing changed.
export async function payRun(ctx: ActionContext, ids: string[]): Promise<{ status: 200 | 403 | 409; results: RunResult[]; error?: string }> {
  if (!can(ctx.actor.role, "bills.pay", "bills")) return { status: 403, results: [], error: "Your role can't pay bills" };
  const unique = [...new Set(ids)].slice(0, RUN_CHUNK);
  const found = new Map((await classify(ctx, await approvedBills(ctx, { ids: unique }))).map((b) => [b.id, b]));
  const results: RunResult[] = [];
  let changed = false;
  for (const id of unique) {
    const b = found.get(id);
    if (!b) results.push({ id, outcome: "skipped", message: `${id} isn't an approved, unpaid bill in your properties.` });
    else if (b.hold) results.push({ id, outcome: "held", message: b.hold, amount_cents: b.amount_cents });
    else if (b.over_limit) {
      const r = await sendToApprovals(ctx, b);
      if (!r.message.startsWith("Already")) changed = true;
      results.push(r);
    } else {
      const r = await payBill(ctx, id);
      if (r.status === 200) changed = true;
      results.push(r.status === 200 ? { id, outcome: "paid", message: r.message ?? "Paid", amount_cents: b.amount_cents } : { id, outcome: "failed", message: r.error, amount_cents: b.amount_cents });
    }
  }
  return { status: changed ? 200 : 409, results };
}
