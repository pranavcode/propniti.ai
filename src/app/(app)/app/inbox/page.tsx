import Link from "@/components/Link";
import { Inbox } from "lucide-react";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { cn } from "@/lib/utils";
import { inboxPage, type InboxFilter } from "@/extensions/inbox/data";
import { sessionInboxCounts } from "@/extensions/inbox/server";
import { InboxList } from "@/extensions/inbox/InboxList";

export const metadata = { title: "Inbox · Propniti" };

const PAGE = 25;
const TABS: { key: InboxFilter; label: string; empty: string }[] = [
  { key: "all", label: "All", empty: "Nothing needs you right now. Conversations waiting on a reply, agent proposals for you to decide and alerts land here." },
  { key: "messages", label: "Messages", empty: "No open conversations assigned to you." },
  { key: "approvals", label: "Approvals", empty: "No agent proposals are waiting on you." },
  { key: "alerts", label: "Alerts", empty: "No alerts for you." },
];

// What needs this persona now, across conversations, agent proposals and notifications.
export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const s = await currentSession();
  let res: Awaited<ReturnType<typeof inboxPage>> | null = null;
  let page = 1;
  try {
    const counts = await sessionInboxCounts(true);
    const total = tab.key === "all" ? counts.messages + counts.approvals + counts.alerts : counts[tab.key];
    page = Math.min(Math.max(1, Math.floor(Number(sp.page)) || 1), Math.max(1, Math.ceil(total / PAGE)));
    res = await inboxPage({ db: getPlatform().db, ws: s.ws, actor: s.actor }, { filter: tab.key, page, size: PAGE }, counts);
  } catch (e) {
    console.error("[inbox] load failed:", e);
  }
  const counts = res?.counts;
  const count = (k: InboxFilter) => (!counts ? null : k === "all" ? counts.messages + counts.approvals + counts.alerts : k === "messages" ? counts.messages : k === "approvals" ? counts.approvals : counts.alerts);
  const href = (t: InboxFilter, p = 1) => {
    const q = new URLSearchParams();
    if (t !== "all") q.set("tab", t);
    if (p > 1) q.set("page", String(p));
    const qs = q.toString();
    return `/app/inbox${qs ? `?${qs}` : ""}`;
  };
  const pages = res ? Math.max(1, Math.ceil(res.total / PAGE)) : 1;

  return (
    <div>
      <PageHeader icon={<Inbox />} title="Inbox" description="What needs you now: conversations waiting on your reply, agent proposals waiting on your decision and alerts for you."
        meta={<><span>{s.actor.scope.label}</span>{counts && <span><span className="font-medium text-foreground tabular-nums">{counts.needsYou}</span> need you</span>}</>}>
        <nav aria-label="Inbox filter" className="flex flex-wrap items-center gap-1 border-b">
          {TABS.map((t) => (
            <Link key={t.key} href={href(t.key)} aria-current={t.key === tab.key ? "page" : undefined}
              className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors", t.key === tab.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t.label}{count(t.key) != null && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums">{count(t.key)}</span>}
            </Link>
          ))}
        </nav>
      </PageHeader>
      <div className="flex flex-col gap-3 px-4 pt-4 pb-10 md:px-6">
        {!res ? <ErrorBanner message="The inbox couldn't load. Reload the page to try again." /> : res.items.length === 0 ? (
          <div className="rounded-lg border bg-card">
            <EmptyState kind="inbox" title={tab.key === "all" ? "Nothing needs you right now" : `No ${tab.label.toLowerCase()}`} description={tab.empty} action={tab.key === "all" ? undefined : { label: "Show everything", href: href("all") }} />
          </div>
        ) : (
          <>
            <InboxList items={res.items} />
            {res.total > PAGE && (
              <div className="flex items-center justify-between text-[12px] text-muted-foreground">
                <span className="tabular-nums">{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, res.total)} of {res.total}</span>
                <div className="flex gap-1">
                  <Button asChild size="xs" variant="outline" className={cn(page <= 1 && "pointer-events-none opacity-50")}><Link href={href(tab.key, page - 1)} aria-disabled={page <= 1}>Previous</Link></Button>
                  <Button asChild size="xs" variant="outline" className={cn(page >= pages && "pointer-events-none opacity-50")}><Link href={href(tab.key, page + 1)} aria-disabled={page >= pages}>Next</Link></Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
