import { z } from "zod";
import { BadgeDollarSign, Coins } from "lucide-react";
import type { ActionContext } from "@/entities/types";
import type { DbStatement } from "@/lib/platform/types";
import { effective } from "@/server/effective";
import { distributeOwner, payOwnerAdjustment, uid } from "@/server/money";
import { nowIso } from "@/server/workspace";
import { registerAction } from "../actions";

// Staff actions for owner statements. Money goes through src/server/money.ts; the generic action
// route checks roles, scope and audits each successful run.

const IdemKey = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Bad idempotency key");
export const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

registerAction({
  key: "owner_entities.distribute",
  label: "Send distribution",
  entity: "owner_entities",
  roles: ["principal", "accountant"],
  icon: BadgeDollarSign,
  money: true,
  // The browser makes the key once per statement view, so a double click or retry pays once.
  input: z.object({ idempotencyKey: IdemKey }),
  confirm: { title: "Send this distribution?", body: "The open statement balance goes to the owner by ACH from the operating trust. The statement closes when it is sent.", tone: "warning" },
  handler: (ctx, row, input) => distributeOwner(ctx, String(row.id), input.idempotencyKey),
  help: { summary: "Pays the owner entity its open statement balance from the trust account and closes the statement.", article: "owner-statements" },
});

registerAction({
  key: "owner_distributions.pay_rounding_cent",
  label: "Pay the difference",
  entity: "owner_distributions",
  roles: ["principal", "accountant"],
  icon: Coins,
  money: true,
  // The amount the person saw; money.ts pays only if the statement still owes exactly that (key owner-adj:<id>).
  input: z.object({ amountCents: z.number().int().positive().max(100_000) }),
  when: (r) => Number(r.gap ?? 0) > 0,
  confirm: { title: "Pay the owner the difference?", body: "Sends the unreconciled amount to the owner from the trust account and marks the Data Health issue fixed.", tone: "warning" },
  handler: async (ctx, row, input) => {
    const id = String(row.id);
    const issue = await ctx.db.prepare(`SELECT id FROM ${effective("data_issues")} AS i WHERE i.rule_id = 'owner_distributions.rounding_cent' AND i.entity_id = ?2 AND i.status = 'open'`).bind(ctx.ws, id).first<{ id: string }>();
    return payOwnerAdjustment(ctx, id, input.amountCents, issue?.id);
  },
  help: { summary: "Fixes a statement whose payout is off by a rounding difference: pays the gap and closes the Data Health issue.", article: "owner-statements" },
});

// Approval limit for maintenance spend on an owner entity's properties: the entity's own policy,
// else the org default. null = the owner never needs to approve.
export async function ownerLimitCents(ctx: Pick<ActionContext, "db" | "ws">, ownerEntityId: string): Promise<number | null> {
  const p = await ctx.db
    .prepare(`SELECT owner_approval_over_cents AS c FROM ${effective("approval_policies")} AS a WHERE a.category = 'Maintenance spend' AND (a.owner_entity_id = ?2 OR a.owner_entity_id IS NULL) ORDER BY a.owner_entity_id IS NULL LIMIT 1`)
    .bind(ctx.ws, ownerEntityId)
    .first<{ c: number | null }>();
  // No policy seeded yet: the $1,000 default from the standard management agreement.
  return p ? p.c : 100_000;
}

// Statement-related notifications for staff (the property manager of the entity's first property).
export function notifyManager(ctx: ActionContext, propertyId: string, title: string, body: string, href: string, entity: [string, string]): DbStatement {
  const { db, ws, nowMs } = ctx;
  return db
    .prepare(`INSERT INTO notifications (workspace_id, id, user_id, channel, title, body, href, entity_type, entity_id, at)
      SELECT ?1, ?2, coalesce((SELECT manager_id FROM ${effective("properties")} AS p WHERE p.id = ?3), 'marcus'), 'In-app', ?4, ?5, ?6, ?7, ?8, ?9`)
    .bind(ws, uid("nt"), propertyId, title, body, href, entity[0], entity[1], nowIso(nowMs));
}
