import Link from "@/components/Link";
import { Building2, HardHat, Inbox, Mail, Megaphone, MessageSquare, Phone, Search, Smartphone, UserRound } from "lucide-react";
import { can } from "@/entities";
import { list, QueryError } from "@/server/query";
import { Button } from "@/components/ui/button";
import { RelativeDate } from "@/components/app/display";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { cn } from "@/lib/utils";
import { pageCtx } from "../server";
import { ThreadPane } from "./ThreadPane";

// Unified inbox: one list for resident, vendor and owner conversations across channels, with the
// selected conversation beside it. Filters live in the URL so views can be shared and bookmarked.

const PAGE = 30;
const STATUSES = ["Open", "Waiting", "Closed"] as const;
const KINDS = [{ key: "resident", label: "Residents", icon: UserRound }, { key: "vendor", label: "Vendors", icon: HardHat }, { key: "owner", label: "Owners", icon: Building2 }] as const;
const CHANNEL_ICON = { Email: Mail, SMS: Smartphone, Phone, Portal: MessageSquare } as const;

type Params = { status?: string; kind?: string; unread: boolean; q?: string; page: number; selected?: string; property?: string };

export async function InboxPage(p: Params) {
  const ctx = await pageCtx();
  if (!can(ctx.actor.role, "read", "message_threads")) {
    return <div className="p-6"><EmptyState title="Messages aren't part of your role" description="Switch role from your avatar menu to see the inbox." action={{ label: "Go to your home", href: "/app" }} /></div>;
  }
  const status = STATUSES.includes(p.status as (typeof STATUSES)[number]) ? p.status : p.status === "all" ? undefined : "Open";
  const filters: Record<string, string> = {};
  if (status) filters.status = status;
  if (p.kind && KINDS.some((k) => k.key === p.kind)) filters.party_kind = p.kind;
  if (p.unread) filters.unread = "true";
  if (p.property) filters.property_id = p.property;
  let res: Awaited<ReturnType<typeof list>> | null = null;
  let error: string | null = null;
  try {
    res = await list(ctx, "message_threads", { filters, q: p.q, page: p.page, size: PAGE, sort: ["last_message_at", "desc"] });
  } catch (e) {
    error = e instanceof QueryError ? e.message : "The inbox couldn't load. Try again.";
  }
  const rows = res?.rows ?? [];
  const selected = p.selected ?? (rows[0]?.id as string | undefined);
  const href = (over: Partial<Params & { status: string | undefined }>) => {
    const s = new URLSearchParams();
    const v = { ...p, status: p.status, ...over };
    if (v.status) s.set("status", v.status);
    if (v.kind) s.set("kind", v.kind);
    if (v.unread) s.set("unread", "1");
    if (v.q) s.set("q", v.q);
    if (v.property) s.set("property", v.property);
    if (v.page && v.page > 1) s.set("page", String(v.page));
    if (v.selected) s.set("t", v.selected);
    const qs = s.toString();
    return `/app/communications/inbox${qs ? `?${qs}` : ""}`;
  };
  const counts = res?.counts ?? {};
  const pages = Math.max(1, Math.ceil((res?.total ?? 0) / PAGE));

  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-[520px] flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-[18px] font-semibold tracking-tight"><Inbox className="size-5 text-muted-foreground" />Messages</h1>
          <p className="text-[12.5px] text-muted-foreground">Residents, vendors and owners across email, SMS, portal and phone · {ctx.actor.scope.label}</p>
        </div>
        <Button asChild size="sm" variant="outline"><Link href="/app/communications/announcements"><Megaphone />Announcements</Link></Button>
        <Button asChild size="sm" variant="outline"><Link href="/app/communications/templates">Templates</Link></Button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r" aria-label="Conversations" data-tour="inbox">
          <div className="flex flex-col gap-2 border-b p-3">
            <form action="/app/communications/inbox" className="relative">
              {status && <input type="hidden" name="status" value={status} />}
              {p.kind && <input type="hidden" name="kind" value={p.kind} />}
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input type="search" name="q" defaultValue={p.q} placeholder="Search subject or name…" aria-label="Search conversations" autoComplete="off" spellCheck={false}
                className="h-8 w-full rounded-md border bg-background pr-2 pl-8 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50" />
            </form>
            <nav className="flex gap-1" aria-label="Status">
              {[...STATUSES, "all" as const].map((s) => {
                const on = s === "all" ? !status : status === s;
                return (
                  <Link key={s} href={href({ status: s === "Open" ? undefined : s, page: 1, selected: undefined })} aria-current={on ? "page" : undefined}
                    className={cn("rounded-md px-2 py-1 text-[12px] transition-colors", on ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {s === "all" ? "All" : s}{s !== "all" && counts[s] != null ? <span className="ml-1 tabular-nums text-muted-foreground">{counts[s]}</span> : null}
                  </Link>
                );
              })}
            </nav>
            <div className="flex flex-wrap gap-1">
              <Link href={href({ kind: undefined, page: 1, selected: undefined })} className={cn("rounded-full border px-2 py-0.5 text-[11.5px]", !p.kind ? "border-primary/40 bg-primary/[0.06] text-foreground" : "text-muted-foreground hover:text-foreground")}>Everyone</Link>
              {KINDS.map((k) => (
                <Link key={k.key} href={href({ kind: k.key, page: 1, selected: undefined })} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px]", p.kind === k.key ? "border-primary/40 bg-primary/[0.06] text-foreground" : "text-muted-foreground hover:text-foreground")}><k.icon className="size-3" />{k.label}</Link>
              ))}
              <Link href={href({ unread: !p.unread, page: 1, selected: undefined })} className={cn("rounded-full border px-2 py-0.5 text-[11.5px]", p.unread ? "border-primary/40 bg-primary/[0.06] text-foreground" : "text-muted-foreground hover:text-foreground")}>Unread</Link>
            </div>
          </div>

          {error ? <ErrorBanner className="m-3" message={error} /> : rows.length === 0 ? (
            <EmptyState compact kind={p.q || p.kind || p.unread ? "filtered" : "table"} title={p.q || p.kind || p.unread ? "No conversations match" : status === "Open" ? "Inbox zero" : "No conversations"}
              description={p.q || p.kind || p.unread ? "Try clearing a filter." : status === "Open" ? "Nothing is waiting on you. New messages from residents, vendors and owners land here." : undefined}
              action={p.q || p.kind || p.unread ? { label: "Clear filters", href: "/app/communications/inbox" } : undefined} />
          ) : (
            <ol className="min-h-0 flex-1 divide-y overflow-y-auto">
              {rows.map((r) => {
                const Icon = CHANNEL_ICON[String(r.channel) as keyof typeof CHANNEL_ICON] ?? MessageSquare;
                const on = r.id === selected;
                return (
                  <li key={String(r.id)}>
                    <Link href={href({ selected: String(r.id) })} aria-current={on ? "true" : undefined} scroll={false}
                      className={cn("block px-3 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50", on ? "bg-primary/[0.08]" : "hover:bg-muted/50")}>
                      <div className="flex items-center gap-1.5 text-[13px]">
                        {r.unread ? <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" /> : null}
                        <span className={cn("min-w-0 flex-1 truncate", r.unread ? "font-semibold" : "font-medium")}>{String(r.party ?? r.party_id)}</span>
                        <Icon className="size-3 shrink-0 text-muted-foreground" aria-label={String(r.channel ?? "")} />
                        <span className="shrink-0 text-[11px] text-muted-foreground"><RelativeDate value={String(r.last_message_at)} /></span>
                      </div>
                      <div className="mt-0.5 truncate text-[12.5px]">{String(r.subject)}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">{r.last_direction === "out" ? "You: " : ""}{String(r.preview ?? "")}</span>
                        <span className="shrink-0 capitalize">{String(r.party_kind)}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
          {res && res.total > PAGE && (
            <div className="flex items-center justify-between border-t px-3 py-2 text-[12px] text-muted-foreground">
              <span className="tabular-nums">{(p.page - 1) * PAGE + 1}–{Math.min(p.page * PAGE, res.total)} of {res.total}</span>
              <div className="flex gap-1">
                <Button asChild size="xs" variant="outline" className={cn(p.page <= 1 && "pointer-events-none opacity-50")}><Link href={href({ page: p.page - 1, selected: undefined })} aria-disabled={p.page <= 1}>Previous</Link></Button>
                <Button asChild size="xs" variant="outline" className={cn(p.page >= pages && "pointer-events-none opacity-50")}><Link href={href({ page: p.page + 1, selected: undefined })} aria-disabled={p.page >= pages}>Next</Link></Button>
              </div>
            </div>
          )}
        </aside>

        <section className="hidden min-h-0 md:block" aria-label="Conversation">
          {selected ? <ThreadPane id={selected} actor={ctx.actor} /> : <EmptyState title="Pick a conversation" description="Select a conversation on the left to read it and reply." />}
        </section>
      </div>
    </div>
  );
}
