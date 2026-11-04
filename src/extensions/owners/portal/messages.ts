import "server-only";
import { rows, type PortalCtx } from "./context";

export type ThreadRow = { id: string; subject: string; status: string; last_message_at: string; unread: number; property: string | null; preview: string | null; count: number };
export type MessageRow = { id: string; direction: "in" | "out"; sender_kind: string; body: string; sent_at: string; channel: string; drafted_by_agent: string | null };

// A thread is unread for the portal user when it is flagged unread and the team wrote last.
// Conversations between the portal user and the management team, newest first (max 50).
export async function threadsFor(c: PortalCtx, party: "owner" | "resident" | "vendor" | "applicant", partyId = c.me) {
  return rows<ThreadRow>(c, `SELECT t.id, t.subject, t.status, t.last_message_at, t.unread, p.name AS property,
      (SELECT m.body FROM {messages} m WHERE m.thread_id = t.id ORDER BY m.sent_at DESC LIMIT 1) AS preview,
      (SELECT count(*) FROM {messages} m WHERE m.thread_id = t.id) AS count
    FROM {message_threads} t LEFT JOIN {properties} p ON p.id = t.property_id
    WHERE t.party_kind = ? AND t.party_id = ? ORDER BY t.last_message_at DESC LIMIT 50`, party, partyId);
}

export async function messagesIn(c: PortalCtx, threadId: string, party: string, partyId = c.me) {
  return rows<MessageRow>(c, `SELECT m.id, m.direction, m.sender_kind, m.body, m.sent_at, m.channel, m.drafted_by_agent FROM {messages} m
    JOIN {message_threads} t ON t.id = m.thread_id WHERE m.thread_id = ? AND t.party_kind = ? AND t.party_id = ? ORDER BY m.sent_at LIMIT 200`, threadId, party, partyId);
}

export const unreadCount = async (c: PortalCtx, party: "owner" | "resident" | "vendor" | "applicant") =>
  (await rows<{ n: number }>(c, `SELECT count(*) AS n FROM {message_threads} t WHERE t.party_kind = ? AND t.party_id = ? AND t.unread = 1 AND t.status <> 'Closed'
    AND (SELECT m.direction FROM {messages} m WHERE m.thread_id = t.id ORDER BY m.sent_at DESC LIMIT 1) = 'out'`, party, c.me))[0]?.n ?? 0;
