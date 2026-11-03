"use client";
import { demoNowIso } from "@/lib/clock";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatFull, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

// Notification centre. Contract (lane C): GET /api/notifications → NotificationsResponse for the
// current persona, newest first, at most 30; POST /api/notifications/read { ids?: string[] }
// (no ids = all). Missing API → the empty state.

export type NotificationRow = { id: string; title: string; body?: string; href?: string | null; entity_type?: string | null; at: string; read_at?: string | null };
export type NotificationsResponse = { rows: NotificationRow[]; unread: number };

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      // 404 = the endpoint isn't deployed yet: treat as empty. Anything else is a real failure.
      setFailed(!r.ok && r.status !== 404);
      setData(r.ok ? await r.json() : { rows: [], unread: 0 });
    } catch {
      setFailed(true);
      setData({ rows: [], unread: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/notifications", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const markAll = async () => {
    setData((d) => d && { unread: 0, rows: d.rows.map((r) => ({ ...r, read_at: r.read_at ?? demoNowIso() })) });
    await fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
  };

  const unread = data?.unread ?? 0;
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) void load(); }}>
      <PopoverTrigger asChild>
        <Button data-tour="notifications" variant="ghost" size="icon-sm" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
          <Bell />
          {unread > 0 && <span className="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-tone-danger px-1 text-[9px] leading-none font-semibold text-white ring-2 ring-background tabular-nums">{unread > 9 ? "9+" : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] gap-0 p-0">
        <div className="flex h-10 items-center justify-between border-b px-3">
          <span className="font-medium">Notifications</span>
          {unread > 0 && <Button variant="ghost" size="xs" onClick={markAll}><CheckCheck /> Mark all read</Button>}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {loading && !data ? (
            <div className="flex flex-col gap-3 p-3">{[0, 1, 2].map((i) => <div key={i} className="flex gap-2"><Skeleton className="size-2 rounded-full" /><div className="flex-1 flex flex-col gap-1.5"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></div>)}</div>
          ) : failed ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <div className="font-medium">Couldn&apos;t load notifications</div>
              <p className="text-[12px] text-muted-foreground">Check your connection and try again.</p>
              <Button size="sm" variant="outline" onClick={() => void load()}>Try again</Button>
            </div>
          ) : !data?.rows.length ? (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground"><BellOff className="size-4" /></span>
              <div className="font-medium">You&apos;re all caught up</div>
              <p className="text-[12px] text-muted-foreground">Approvals, @mentions and agent results show up here.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {data.rows.map((n) => {
                const body = (
                  <div className={cn("flex gap-2.5 px-3 py-2.5 hover:bg-muted/60", !n.read_at && "bg-primary/[0.03]")}>
                    <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} />
                    <div className="min-w-0 flex-1">
                      <div className={cn("leading-snug", !n.read_at && "font-medium")}>{n.title}</div>
                      {n.body && <div className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{n.body}</div>}
                    </div>
                    <time title={formatFull(n.at)} className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{formatRelative(n.at)}</time>
                  </div>
                );
                return <li key={n.id}>{n.href ? <Link href={n.href} onClick={() => setOpen(false)}>{body}</Link> : body}</li>;
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
