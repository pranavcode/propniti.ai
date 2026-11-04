import { demoNowIso } from "@/lib/clock";
import Link from "@/components/Link";
import { Bot, Mail, MessageSquare, Phone, Smartphone } from "lucide-react";
import type { Actor } from "@/entities/types";
import { can } from "@/entities";
import { StatusBadge } from "@/components/app/display";
import { EmptyState } from "@/components/app/states";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { threadContext } from "../ai";
import { pageCtx, sql } from "../server";
import { nextNeedingReply } from "@/extensions/inbox/data";
import { Composer, ThreadActions, type Suggestion } from "./Composer";

// One conversation: header, messages oldest to newest, the open AI suggestion and the composer.

const CHANNEL_ICON = { Email: Mail, SMS: Smartphone, Phone, Portal: MessageSquare, Letter: Mail } as const;
const PARTY_HREF: Record<string, string> = { resident: "/app/residents/", vendor: "/app/maintenance/vendors/", owner: "/app/owners/" };
const ABOUT_HREF: Record<string, string> = { leases: "/app/leases/", work_orders: "/app/maintenance/work-orders/", properties: "/app/properties/", bills: "/app/payables/bills/" };
const money = (c: unknown) => (c == null ? null : `$${(Number(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const date = (d: unknown) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null);

export async function ThreadPane({ id, actor }: { id: string; actor: Actor }) {
  const ctx = await pageCtx();
  const c = await threadContext(ctx, id);
  // threadContext reads without scope; the thread's property must be in the persona's scope.
  // A thread with no property is org-level: only org-wide personas see it.
  if (!c || (actor.propertyIds !== "all" && (c.thread.property_id == null || !actor.propertyIds.includes(String(c.thread.property_id))))) {
    return <EmptyState compact title="Conversation not found" description="It may have been closed or moved, or it belongs to a property outside your scope." />;
  }
  const t = c.thread;
  const [messages, suggestionRow, templates] = await Promise.all([
    sql(ctx, "SELECT * FROM (SELECT id, direction, channel, body, sent_at, sender_kind, sender_id, drafted_by_agent FROM {messages} WHERE thread_id = ? ORDER BY sent_at DESC LIMIT 50) ORDER BY sent_at", [id]),
    sql(ctx, "SELECT p.*, r.status AS run_status FROM {ai_proposals} p LEFT JOIN {agent_runs} r ON r.id = p.run_id WHERE p.entity_type = 'message_threads' AND p.entity_id = ? AND p.action = 'message_threads.reply' AND NOT EXISTS (SELECT 1 FROM {ai_decisions} d WHERE d.proposal_id = p.id) ORDER BY p.created_at DESC LIMIT 1", [id]),
    sql(ctx, "SELECT id, name, category, channel, language, subject, body FROM {templates} ORDER BY category, name LIMIT 100"),
  ]);
  const canReply = can(actor.role, "message_threads.reply", "message_threads");
  const next = canReply ? await nextNeedingReply({ db: ctx.db, ws: ctx.ws, actor }, id).catch(() => null) : null;
  const p = suggestionRow[0];
  const payload = p ? JSON.parse(String(p.payload ?? "{}")) : null;
  const suggestion: Suggestion | null = p ? {
    id: String(p.id), body: String(payload?.input?.body ?? ""), why: JSON.parse(String(p.why ?? "[]")), confidence: Number(p.confidence), model: String(p.model ?? "rules"),
    source: payload?.source === "live" ? "live" : p.run_id ? "rules" : "precomputed", runId: (p.run_id as string) ?? null, createdAt: String(p.created_at), agent: String(p.agent),
  } : null;
  const f = c.facts;
  const vars = {
    first_name: (f.first_name as string) ?? null, unit: (f.unit as string) ?? null, property: (f.property as string) ?? null, balance: money(f.balance_cents),
    lease_end: date(f.lease_end), rent: money(f.rent_cents), due_date: date(demoNowIso()),
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-start gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold">{String(t.subject)}</h2>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
            {PARTY_HREF[String(t.party_kind)] ? <Link href={`${PARTY_HREF[String(t.party_kind)]}${encodeURIComponent(String(t.party_id))}`} className="font-medium text-foreground hover:text-primary hover:underline">{String(f.name ?? t.party_id)}</Link> : <span>{String(f.name ?? t.party_id)}</span>}
            <span className="capitalize">{String(t.party_kind)}</span>
            {f.property ? <span>· {String(f.property)}{f.unit ? ` #${f.unit}` : ""}</span> : null}
            {t.entity_type && t.entity_id && ABOUT_HREF[String(t.entity_type)] ? <span>· About <Link href={`${ABOUT_HREF[String(t.entity_type)]}${encodeURIComponent(String(t.entity_id))}`} className="text-primary hover:underline">{String(t.entity_id)}</Link></span> : null}
            {f.balance_cents != null && Number(f.balance_cents) > 0 ? <span>· Balance <span className="font-medium text-tone-danger">{money(f.balance_cents)}</span></span> : null}
          </p>
        </div>
        <StatusBadge value={t.status} />
        {canReply && <ThreadActions id={id} status={String(t.status)} unread={!!t.unread} />}
      </header>

      <ol className="flex flex-1 flex-col gap-3 overflow-y-auto bg-muted/20 px-4 py-4" aria-label="Messages">
        {messages.length === 0 && <li className="text-center text-[12.5px] text-muted-foreground">No messages in this conversation yet.</li>}
        {messages.map((m) => {
          const out = m.direction === "out";
          const Icon = CHANNEL_ICON[String(m.channel) as keyof typeof CHANNEL_ICON] ?? MessageSquare;
          return (
            <li key={String(m.id)} className={cn("flex", out ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[78%] rounded-lg border px-3 py-2 text-[13px] leading-relaxed shadow-xs", out ? "border-primary/20 bg-primary/[0.07]" : "bg-card")}>
                <p className="whitespace-pre-wrap">{String(m.body)}</p>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Icon className="size-3" />{String(m.channel)} · <time dateTime={String(m.sent_at)}>{formatDateTime(String(m.sent_at))}</time>
                  {out && m.sender_id ? <>· {m.sender_id === actor.personaId ? "You" : String(m.sender_id)}</> : null}
                  {m.drafted_by_agent ? <span className="inline-flex items-center gap-0.5 text-tone-ai"><Bot className="size-3" />AI-drafted</span> : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {canReply ? (
        <Composer threadId={id} channel={c.channel} closed={t.status === "Closed"} suggestion={suggestion} templates={templates.map((x) => ({ id: String(x.id), name: String(x.name), category: String(x.category), channel: String(x.channel), language: String(x.language), body: String(x.body) }))} vars={vars} language={c.language} next={next} />
      ) : <p className="border-t px-4 py-3 text-[12.5px] text-muted-foreground">Your role can read this conversation but not reply.</p>}
    </div>
  );
}
