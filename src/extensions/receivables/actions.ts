import { Ban, Banknote, CreditCard, Gavel, MoveRight, Undo2 } from "lucide-react";
import { z } from "zod";
import type { ActionContext, Role, Row } from "@/entities/types";
import { registerAction } from "@/extensions/actions";
import { CURRENT_PERIOD } from "@/seed/constants";
import { effective } from "@/server/effective";
import { payRent, postLateFees, recordPayment } from "@/server/money";
import { householdOf } from "./queries";
import { disposeDeposit, markPaymentReturned, movePayment } from "@/server/money";

// Receivables actions. Every one that moves or re-points money goes through the guarded functions
// (src/server/money.ts, and ./money.ts until Lane A adopts it); the SQL guards decide.

const STAFF_AR: Role[] = ["principal", "regional_manager", "property_manager", "accountant"];
const ACCOUNTING: Role[] = ["principal", "regional_manager", "accountant"];
const cents = (dollars: number) => Math.round(dollars * 100);
const open = (r: Row) => Number(r.balance ?? 0) > 0;

export const RecordPaymentInput = z.strictObject({
  amount: z.number().positive().max(1_000_000),
  method: z.enum(["Check", "Money order", "Cash", "ACH", "Card"]),
  reference: z.string().trim().max(60).default(""),
  // One per dialog: a double click or a retry re-sends the same key and records nothing new.
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
});

registerAction({
  key: "charges.record_payment",
  label: "Record payment",
  entity: "charges",
  roles: STAFF_AR,
  icon: Banknote,
  money: true,
  input: RecordPaymentInput,
  when: open,
  handler: (ctx, row, i) => recordPayment(ctx, { chargeId: String(row.id), amountCents: cents(i.amount), method: i.method, reference: i.reference || `${i.method} received ${new Date(ctx.nowMs).toISOString().slice(0, 10)}`, idempotencyKey: i.idempotencyKey }),
  help: { summary: "Records a check, money order or other payment received in the office. The payment goes to the property's trust account today, the management fee is deducted, and the charge's balance goes down by the amount paid.", article: "record-a-payment" },
});

registerAction({
  key: "charges.pay_rent",
  label: "Pay now",
  entity: "charges",
  roles: ["resident"],
  icon: CreditCard,
  money: true,
  confirm: { title: "Pay this charge by ACH?", body: "The full open balance is drawn from your bank account on file. It shows as Processing until the transfer clears." },
  when: (r) => open(r) && r.status !== "Processing",
  async handler(ctx, row) {
    if ((await householdOf(ctx)) !== row.household_id) return { status: 403, error: "You can only pay charges on your own lease." };
    return payRent(ctx, String(row.id));
  },
  help: { summary: "Pays the charge's open balance by ACH from the resident portal.", article: "resident-pay-rent-portal" },
});

// Runs a late-fee policy for the month: org default covers every property in scope without a
// policy of its own. One fee per lease per month (charge id lf-<lease>-<yyyymm>), capped by state rules.
registerAction({
  key: "late_fee_policies.post_late_fees",
  label: "Post late fees",
  entity: "late_fee_policies",
  roles: STAFF_AR,
  icon: Gavel,
  money: true,
  input: z.strictObject({ period: z.string().regex(/^\d{4}-\d{2}$/).default(CURRENT_PERIOD) }),
  confirm: { title: "Post late fees for this month?", body: "Fees go on rent still unpaid after the grace period. Each lease gets at most one fee per month, capped by the state's limit." },
  bulk: true,
  async handler(ctx, row, i) {
    const ids = await policyProperties(ctx, row);
    if (!ids.length) return { status: 403, error: "That policy's property is outside your portfolio." };
    const r = await postLateFees(ctx, ids, i.period);
    if (r.status !== 200) return r;
    // Fees post in rounds (postLateFees caps a run); `remaining` rides on the link so the runner can
    // offer "Run again". The list page ignores the extra parameter.
    const remaining = r.remaining ?? 0;
    return { status: 200, message: r.message, href: `/app/receivables/charges?f.gl_account_id=gl-4100&f.period=${i.period}${remaining ? `&remaining=${remaining}` : ""}` };
  },
  help: { summary: "Adds a late fee to each lease whose rent is still unpaid after the grace period, once per month, never above the state cap.", article: "post-late-fees" },
});

// Policies are org-level records, so the actor's property scope is applied here: a property
// manager can't post fees on a property outside their portfolio by running its policy.
async function policyProperties(ctx: ActionContext, policy: Row): Promise<string[]> {
  const scope = ctx.actor.propertyIds;
  if (policy.property_id) return scope === "all" || scope.includes(String(policy.property_id)) ? [String(policy.property_id)] : [];
  const rows = (await ctx.db
    .prepare(`SELECT p.id FROM ${effective("properties")} AS p WHERE NOT EXISTS (SELECT 1 FROM ${effective("late_fee_policies")} AS l WHERE l.property_id = p.id) ORDER BY p.id`)
    .bind(ctx.ws)
    .all<{ id: string }>()).results.map((r) => r.id);
  return scope === "all" ? rows : rows.filter((id) => scope.includes(id));
}

export const DispositionInput = z.strictObject({
  lines: z.array(z.strictObject({
    label: z.string().trim().min(1).max(80),
    amount: z.number().positive().max(100_000),
    charge_id: z.string().max(80).optional(),
  })).max(20),
});

registerAction({
  key: "deposits.send_disposition",
  label: "Send disposition",
  entity: "deposits",
  roles: STAFF_AR,
  icon: Undo2,
  money: true,
  input: DispositionInput,
  when: (r) => r.status !== "Settled",
  handler: (ctx, row, i) => disposeDeposit(ctx, String(row.id), i.lines.map((l) => ({ label: l.label, amount_cents: cents(l.amount), charge_id: l.charge_id }))),
  help: { summary: "Itemises move-out deductions against the deposit, applies them to the lease's open charges, and refunds the rest to the resident.", article: "move-out-deposit-disposition" },
});

// Data Health fix for payments.wrong_lease. Money and ledger fixes always need a person with
// accounting approval; this action is that approval.
registerAction({
  key: "payments.move_to_lease",
  label: "Move to correct lease",
  entity: "payments",
  roles: ACCOUNTING,
  icon: MoveRight,
  money: true,
  input: z.strictObject({ to_charge_id: z.string().min(1).max(80), issue_id: z.string().max(80).optional() }),
  when: (r) => r.nsf !== true,
  handler: (ctx, row, i) => movePayment(ctx, String(row.id), i.to_charge_id, i.issue_id),
  help: { summary: "Moves a payment posted to the wrong lease onto the charge it was meant for. No money moves; both ledgers update.", article: "data-health-fix-issues" },
});

export const RETURN_REASONS = ["NSF", "Account closed", "Stop payment", "Other"] as const;

// The bank sent a payment back. markPaymentReturned reverses it out of trust, gives back the fee,
// re-opens the charges oldest first and adds the state-capped returned-payment fee; one return per payment.
registerAction({
  key: "payments.mark_returned",
  label: "Mark returned",
  entity: "payments",
  roles: ACCOUNTING,
  icon: Ban,
  money: true,
  input: z.strictObject({ reason: z.enum(RETURN_REASONS), note: z.string().trim().max(160).default("") }),
  when: (r) => r.nsf !== true,
  handler: (ctx, row, i) => markPaymentReturned(ctx, String(row.id), i.note ? `${i.reason}: ${i.note}` : i.reason),
  help: { summary: "Records that the bank returned a payment. The amount comes back out of trust, the charges it paid reopen, and the returned-payment fee is charged, capped by state rules.", article: "handle-nsf-returned-payment" },
});
