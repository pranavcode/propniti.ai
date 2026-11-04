import "server-only";
import { delinquency } from "@/ai/facts";
import { reminder } from "@/ai/rules";
import type { ActionContext, ActionResult } from "@/entities/types";
import { AS_OF } from "@/seed/constants";
import type { QueryCtx } from "@/server/query";
import { nowIso } from "@/server/workspace";

// One past-due reminder per lease per day, sent from a delinquency row. The text is the Collections
// agent's reminder; the thread and message ids are derived from the lease and the day, so the unique
// (workspace_id, id) index makes a double click or a second tab send nothing new.

const threadId = (leaseId: string, day: string) => `thr-remind-${leaseId}-${day}`;

export const recordPaymentHref = (leaseId: string) => `/app/receivables/record-payment?q=${encodeURIComponent(leaseId)}`;

export async function remindLease(ctx: ActionContext, leaseId: string): Promise<ActionResult> {
  const { db, ws, actor } = ctx;
  const at = nowIso(ctx.nowMs);
  const day = AS_OF;
  // delinquency() reads through the actor's property scope, so a lease outside it is "not past due".
  const d = (await delinquency({ db, ws, actor }, AS_OF, { minDays: 1, leaseIds: [leaseId], limit: 1 })).rows[0];
  if (!d) return { status: 409, error: "Nothing on this lease is past due, so there's nothing to remind about." };
  if (!d.resident_id) return { status: 409, error: "This lease has no primary resident to remind." };
  const m = reminder(d);
  const thread = threadId(leaseId, day);
  const [created] = await db.batch([
    db.prepare(`INSERT INTO message_threads (workspace_id, id, property_id, party_kind, party_id, subject, entity_type, entity_id, status, last_message_at, unread)
      VALUES (?1, ?2, ?3, 'resident', ?4, ?5, 'leases', ?6, 'Waiting', ?7, 0) ON CONFLICT DO NOTHING`).bind(ws, thread, d.property_id, d.resident_id, m.subject, leaseId, at),
    db.prepare(`INSERT INTO messages (workspace_id, id, thread_id, channel, direction, sender_kind, sender_id, body, sent_at)
      VALUES (?1, ?2, ?3, 'Email', 'out', 'staff', ?4, ?5, ?6) ON CONFLICT DO NOTHING`).bind(ws, `msg-remind-${leaseId}-${day}`, thread, actor.personaId, m.body, at),
  ]);
  if (!created.meta.changes) return { status: 409, error: `A reminder already went to ${d.resident} today.` };
  return { status: 200, message: `Reminder emailed to ${d.resident}: ${m.subject}.` };
}

// Which of these leases already got today's reminder (for the row's "Reminded" state).
export async function remindedToday(ctx: QueryCtx, leaseIds: string[]): Promise<Set<string>> {
  if (!leaseIds.length || !ctx.ws) return new Set();
  const { results } = await ctx.db
    .prepare("SELECT entity_id FROM message_threads WHERE workspace_id = ? AND id IN (SELECT 'thr-remind-' || value || '-' || ? FROM json_each(?))")
    .bind(ctx.ws, AS_OF, JSON.stringify(leaseIds))
    .all<{ entity_id: string }>();
  return new Set(results.map((r) => r.entity_id));
}
