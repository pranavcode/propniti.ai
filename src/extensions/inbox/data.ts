import "server-only";
import { PERMISSIONS } from "@/auth/personas";
import { can, getEntity } from "@/entities";
import { decidableSql } from "@/ai/decide";
import type { Row } from "@/entities/types";
import { proposalSource, type AiSource } from "@/ai/rules";
import { recipientIds } from "@/app/api/notifications/shared";
import { expand, readWs, type QueryCtx, type Ws } from "@/server/query";

// The staff inbox: what needs this persona now. Three sources, each scoped like its own page:
// open conversations assigned to them (or to nobody) in their properties, agent proposals that wait
// on a person and that their role may decide, and their notifications. A conversation needs a reply
// only when the other party wrote last.
// One UNION ALL (3 terms) picks the page of keys; the page's rows are then read by id.

export type InboxFilter = "all" | "messages" | "approvals" | "alerts";
export type InboxKind = "message" | "approval" | "alert";
export type InboxItem = {
  kind: InboxKind; id: string; at: string; unread: boolean; needsReply?: boolean; party?: string;
  title: string; who: string | null; detail: string | null; property: string | null;
  ai: { label: "Suggested reply" | "Why"; text: string; source: AiSource; model?: string; confidence?: number } | null;
  agent?: string; risk?: string; amountCents?: number | null;
  action: { label: "Reply" | "Review" | "Open"; href: string } | null;
  peek: { entity: string; id: string; href: string } | null;
};
export type InboxCounts = { messages: number; needsReply: number; approvals: number; alerts: number; unreadAlerts: number; needsYou: number };

const KIND_OF: Record<Exclude<InboxFilter, "all">, InboxKind> = { messages: "message", approvals: "approval", alerts: "alert" };
const json = (v: unknown) => JSON.stringify(v);
// Same-site paths only: "//host" and "/\host" are both read by browsers as another site.
export const inApp = (href: unknown) => (typeof href === "string" && /^\/(?![/\\])/.test(href) ? href : null);
const parse = <T,>(v: unknown, fallback: T): T => {
  try {
    return typeof v === "string" ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};

// The UNION ALL branches this persona can see, each selecting (kind, id, at, unread).
function branches(ctx: QueryCtx, only?: InboxKind): { sql: string; params: unknown[] }[] {
  const { actor } = ctx;
  const scoped = actor.propertyIds !== "all";
  const scope = (col: string) => (scoped ? ` AND ${col} IN (SELECT value FROM json_each(?))` : "");
  const scopeParams = scoped ? [json(actor.propertyIds)] : [];
  const out: { sql: string; params: unknown[] }[] = [];
  // Conversations are listed for roles that can answer them (admins can read but not reply).
  if ((!only || only === "message") && can(actor.role, "read", "message_threads") && can(actor.role, "message_threads.reply", "message_threads")) {
    out.push({
      sql: `SELECT 'message' AS kind, t.id, t.last_message_at AS at, t.unread AS unread, coalesce((SELECT m.direction = 'in' FROM {messages} m WHERE m.thread_id = t.id ORDER BY m.sent_at DESC LIMIT 1), 0) AS needs FROM {message_threads} t WHERE t.status = 'Open' AND (t.assigned_to = ? OR t.assigned_to IS NULL)${scope("t.property_id")}`,
      params: [actor.personaId, ...scopeParams],
    });
  }
  if ((!only || only === "approval") && (PERMISSIONS[actor.role].intelligence ?? "none") !== "none") {
    const d = decidableSql(actor.role);
    // Reply drafts show on their conversation instead.
    out.push({
      sql: `SELECT 'approval' AS kind, p.id, p.created_at AS at, 1 AS unread, 1 AS needs FROM {ai_proposals} p WHERE p.queue_state = 'needs_you' AND p.action <> 'message_threads.reply'
        AND NOT EXISTS (SELECT 1 FROM {ai_decisions} d WHERE d.proposal_id = p.id)
        AND ${d.sql}${scope("p.property_id")}`,
      params: [...d.params, ...scopeParams],
    });
  }
  if (!only || only === "alert") {
    out.push({ sql: "SELECT 'alert' AS kind, n.id, n.at, n.read_at IS NULL AS unread, n.read_at IS NULL AS needs FROM {notifications} n WHERE n.user_id IN (SELECT value FROM json_each(?))", params: [json(recipientIds(actor))] });
  }
  return out;
}

const union = (bs: { sql: string; params: unknown[] }[]) => ({ sql: bs.map((b) => b.sql).join(" UNION ALL "), params: bs.flatMap((b) => b.params) });

async function all<T = Row>(ctx: QueryCtx, ws: Ws, sql: string, params: unknown[]): Promise<T[]> {
  return (await ctx.db.prepare(expand(sql, ws)).bind(...params).all<T>()).results;
}

export async function inboxCounts(ctx: QueryCtx, ws?: Ws): Promise<InboxCounts> {
  const bs = branches(ctx);
  const c = { messages: 0, needsReply: 0, approvals: 0, alerts: 0, unreadAlerts: 0 };
  if (bs.length) {
    const u = union(bs);
    const rows = await all<{ kind: InboxKind; n: number; needs: number }>(ctx, ws ?? (await readWs(ctx)), `SELECT kind, count(*) AS n, sum(needs) AS needs FROM (${u.sql}) GROUP BY kind`, u.params);
    for (const r of rows) {
      if (r.kind === "message") { c.messages = r.n; c.needsReply = Number(r.needs ?? 0); }
      if (r.kind === "approval") c.approvals = r.n;
      if (r.kind === "alert") { c.alerts = r.n; c.unreadAlerts = Number(r.needs ?? 0); }
    }
  }
  return { ...c, needsYou: c.needsReply + c.approvals + c.unreadAlerts };
}

export async function inboxPage(ctx: QueryCtx, f: { filter?: InboxFilter; page?: number; size?: number }, known?: InboxCounts) {
  const ws = await readWs(ctx);
  const size = Math.min(100, Math.max(1, f.size ?? 25));
  const page = Math.max(1, f.page ?? 1);
  const only = f.filter && f.filter !== "all" ? KIND_OF[f.filter] : undefined;
  const bs = branches(ctx, only);
  const counts = known ?? (await inboxCounts(ctx, ws));
  const total = only ? { message: counts.messages, approval: counts.approvals, alert: counts.alerts }[only] : counts.messages + counts.approvals + counts.alerts;
  if (!bs.length || !total) return { items: [] as InboxItem[], total, page, size, counts };

  const u = union(bs);
  const keys = await all<{ kind: InboxKind; id: string; at: string; unread: number; needs: number }>(ctx, ws, `SELECT kind, id, at, unread, needs FROM (${u.sql}) ORDER BY at DESC, kind, id LIMIT ${size} OFFSET ${(page - 1) * size}`, u.params);
  const idsOf = (k: InboxKind) => json(keys.filter((r) => r.kind === k).map((r) => r.id));

  const thread = getEntity("message_threads")!.fields;
  const [threads, drafts, proposals, alerts] = await Promise.all([
    keys.some((r) => r.kind === "message")
      ? all(ctx, ws, `SELECT message_threads.id, message_threads.subject, message_threads.property_id, message_threads.party_kind, ${thread.party.sql} AS party, ${thread.preview.sql} AS preview FROM {message_threads} message_threads WHERE message_threads.id IN (SELECT value FROM json_each(?))`, [idsOf("message")])
      : [],
    keys.some((r) => r.kind === "message")
      ? all(ctx, ws, "SELECT p.entity_id, p.payload, p.model, p.run_id FROM {ai_proposals} p WHERE p.entity_type = 'message_threads' AND p.action = 'message_threads.reply' AND p.entity_id IN (SELECT value FROM json_each(?)) AND NOT EXISTS (SELECT 1 FROM {ai_decisions} d WHERE d.proposal_id = p.id) ORDER BY p.created_at DESC", [idsOf("message")])
      : [],
    keys.some((r) => r.kind === "approval") ? all(ctx, ws, "SELECT * FROM {ai_proposals} p WHERE p.id IN (SELECT value FROM json_each(?))", [idsOf("approval")]) : [],
    keys.some((r) => r.kind === "alert") ? all(ctx, ws, "SELECT id, title, body, href, entity_type, entity_id FROM {notifications} n WHERE n.id IN (SELECT value FROM json_each(?)) AND n.user_id IN (SELECT value FROM json_each(?))", [idsOf("alert"), json(recipientIds(ctx.actor))]) : [],
  ]);
  const propIds = [...new Set([...threads, ...proposals].map((r) => r.property_id).filter(Boolean))];
  const props = propIds.length ? await all<{ id: string; name: string }>(ctx, ws, "SELECT id, name FROM {properties} WHERE id IN (SELECT value FROM json_each(?))", [json(propIds)]) : [];
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const byId = (rows: Row[]) => new Map(rows.map((r) => [String(r.id), r]));
  const tMap = byId(threads), pMap = byId(proposals), nMap = byId(alerts);
  const draftOf = new Map<string, Row>();
  for (const d of drafts) if (!draftOf.has(String(d.entity_id))) draftOf.set(String(d.entity_id), d);
  const peekOf = (entity: unknown, id: unknown) => {
    const def = typeof entity === "string" && id != null ? getEntity(entity) : undefined;
    return def ? { entity: def.key as string, id: String(id), href: `${def.route}/${encodeURIComponent(String(id))}` } : null;
  };

  const items = keys.flatMap((k): InboxItem[] => {
    const base = { kind: k.kind, id: k.id, at: k.at, unread: k.kind !== "approval" && !!k.unread };
    if (k.kind === "message") {
      const t = tMap.get(k.id);
      if (!t) return [];
      const d = draftOf.get(k.id);
      const payload = d ? parse<{ input?: { body?: string }; source?: string }>(d.payload, {}) : null;
      // Same provenance rule as the conversation page (ThreadPane).
      const ai = d && payload?.input?.body ? { label: "Suggested reply" as const, text: payload.input.body, source: (payload.source === "live" ? "live" : d.run_id ? "rules" : "precomputed") as AiSource, ...(d.model ? { model: String(d.model) } : {}) } : null;
      const href = `/app/communications/inbox?t=${encodeURIComponent(k.id)}`;
      return [{ ...base, needsReply: !!k.needs, party: String(t.party_kind), title: String(t.subject), who: (t.party as string) ?? null, detail: (t.preview as string) ?? null, property: propName.get(String(t.property_id)) ?? null,
        ai, action: { label: "Reply", href }, peek: { entity: "message_threads", id: k.id, href } }];
    }
    if (k.kind === "approval") {
      const p = pMap.get(k.id);
      if (!p) return [];
      const why = parse<string[]>(p.why, []);
      return [{ ...base, title: String(p.title), who: null, detail: null, property: propName.get(String(p.property_id)) ?? null,
        ai: why[0] ? { label: "Why", text: why[0], source: proposalSource(p), confidence: Number(p.confidence), ...(p.model ? { model: String(p.model) } : {}) } : null,
        agent: String(p.agent), risk: String(p.risk), amountCents: p.amount_cents == null ? null : Number(p.amount_cents),
        action: { label: "Review", href: `/app/ai/approvals?proposal=${encodeURIComponent(k.id)}` }, peek: peekOf(p.entity_type, p.entity_id) }];
    }
    const n = nMap.get(k.id);
    if (!n) return [];
    const href = inApp(n.href);
    return [{ ...base, title: String(n.title), who: null, detail: (n.body as string) || null, property: null, ai: null, action: href ? { label: "Open", href } : null, peek: peekOf(n.entity_type, n.entity_id) }];
  });
  return { items, total, page, size, counts };
}
