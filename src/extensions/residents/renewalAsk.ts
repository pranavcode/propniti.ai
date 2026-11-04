import { MessageSquare } from "lucide-react";
import type { ActionContext, ActionResult, Row } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { notifyManager } from "@/extensions/owners/actions";
import { AS_OF } from "@/seed/constants";
import { effective } from "@/server/effective";
import { nowIso } from "@/server/workspace";
import { registerAction } from "../actions";
import { formatDate } from "@/lib/format";

// "Ask about renewing" from the resident portal: a message in the resident's renewal conversation
// with the office, at most once per lease per week. The message id carries the lease and the week,
// so the unique (workspace_id, id) index turns a second ask that week into a no-op.

export const weekOf = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const threadId = (leaseId: string) => `thr-renewal-${leaseId}`;
const messageId = (leaseId: string, day: string) => `msg-renewal-${leaseId}-${weekOf(day)}`;

export async function askedThisWeek(db: Db, ws: string | null, leaseId: string) {
  if (!ws) return false;
  return !!(await db.prepare("SELECT 1 FROM messages WHERE workspace_id = ? AND id = ?").bind(ws, messageId(leaseId, AS_OF)).first());
}

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

async function askRenewal(ctx: ActionContext, resident: Row): Promise<ActionResult> {
  const lease = await ctx.db
    .prepare(`SELECT l.id, l.property_id, l.end_on, p.name AS property, u.number AS unit,
        EXISTS (SELECT 1 FROM ${effective("renewal_offers")} AS o WHERE o.lease_id = l.id AND o.status = 'Sent') AS offered
      FROM ${effective("leases")} AS l JOIN ${effective("residents")} AS r ON r.household_id = l.household_id
        JOIN ${effective("properties")} AS p ON p.id = l.property_id LEFT JOIN ${effective("units")} AS u ON u.id = l.unit_id
      WHERE r.id = ?2 AND l.status IN ('Active', 'Notice', 'Month-to-month') ORDER BY l.start_on DESC LIMIT 1`)
    .bind(ctx.ws, String(resident.id))
    .first<{ id: string; property_id: string; end_on: string | null; property: string; unit: string | null; offered: number }>();
  if (!lease) return { status: 404, error: "We couldn't find a current lease to renew." };
  if (lease.offered) return { status: 409, error: "Your renewal offer is ready on your lease page. Accept or decline it there." };
  const at = nowIso(ctx.nowMs);
  const thread = threadId(lease.id);
  const msg = messageId(lease.id, at.slice(0, 10));
  const name = `${String(resident.first_name ?? "")} ${String(resident.last_name ?? "")}`.trim();
  const body = `Hi, I'd like to talk about renewing my lease at ${lease.property}${lease.unit ? ` #${lease.unit}` : ""}${lease.end_on ? `, which ends ${fmt(lease.end_on)}` : ""}. Could you send me the renewal options?${name ? `\n\n${name}` : ""}`;
  const [sent] = await ctx.db.batch([
    ctx.db.prepare("INSERT INTO messages (workspace_id, id, thread_id, channel, direction, sender_kind, sender_id, body, sent_at) VALUES (?1, ?2, ?3, 'Portal', 'in', 'resident', ?4, ?5, ?6) ON CONFLICT DO NOTHING")
      .bind(ctx.ws, msg, thread, String(resident.id), body, at),
    // The conversation opens (or reopens) only alongside this week's message.
    ctx.db.prepare(`INSERT INTO message_threads (workspace_id, id, property_id, party_kind, party_id, subject, entity_type, entity_id, status, last_message_at, unread)
      SELECT ?1, ?2, ?3, 'resident', ?4, 'Renewing my lease', 'leases', ?5, 'Open', ?6, 1 WHERE EXISTS (SELECT 1 FROM messages WHERE workspace_id = ?1 AND id = ?7)
      ON CONFLICT (workspace_id, id) DO UPDATE SET status = 'Open', last_message_at = excluded.last_message_at, unread = 1`)
      .bind(ctx.ws, thread, lease.property_id, String(resident.id), lease.id, at, msg),
  ]);
  if (!sent.meta.changes) return { status: 409, error: "You already asked this week. The office replies in Messages." };
  await notifyManager(ctx, lease.property_id, "Resident asking about renewal", `${name || "A resident"} asked about renewing lease ${lease.id}${lease.end_on ? ` (ends ${formatDate(lease.end_on, "always")})` : ""}.`, `/app/leases/${lease.id}`, ["leases", lease.id]).run();
  return { status: 200, message: "Sent to the office. They'll reply in Messages.", href: `/portal/resident/messages?thread=${thread}` };
}

registerAction({
  key: "residents.ask_renewal",
  label: "Ask about renewing",
  entity: "residents",
  roles: ["resident"],
  icon: MessageSquare,
  handler: (ctx, row) => askRenewal(ctx, row),
  help: { summary: "Sends the office a message asking about renewal options, at most once a week per lease.", article: "renewal-offers" },
});
