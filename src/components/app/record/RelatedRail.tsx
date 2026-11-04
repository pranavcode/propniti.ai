"use client";

import Link from "@/components/Link";
import { ArrowRight } from "lucide-react";
import { formatNumber } from "@/lib/format";
import type { Tone } from "@/entities/types";
import { StatusBadge, Thumb } from "../display";
import { useCollab } from "./useCollab";
import { ActivityTimeline, type ActivityEvent } from "./ActivityTimeline";
import { ErrorBanner, EmptyState } from "../states";

// Related records in the record page's right rail (owner, property, lease, household…).

export type RelatedRow = { id: string; title: string; subtitle?: string; href?: string; status?: string; statusTone?: Tone; image?: string | null; meta?: React.ReactNode };
export type RelatedGroup = { key: string; label: string; total: number; href?: string; rows: RelatedRow[] };

export function RailCard({ title, action, children, className }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-lg border bg-card ${className ?? ""}`}>
      <div className="flex h-9 items-center gap-2 border-b px-3">
        <h3 className="flex-1 truncate text-[12.5px] font-semibold tracking-tight">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function RelatedRail({ groups }: { groups: RelatedGroup[] }) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <RailCard
          key={g.key}
          title={<>{g.label} <span className="font-normal text-muted-foreground tabular-nums">{formatNumber(g.total)}</span></>}
          action={g.href && g.total > g.rows.length ? <Link href={g.href} className="inline-flex items-center gap-0.5 text-[12px] text-muted-foreground hover:text-primary">View all <ArrowRight className="size-3" /></Link> : undefined}
        >
          {g.rows.length ? (
            <ul className="divide-y">
              {g.rows.map((r) => {
                const body = (
                  <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50">
                    {r.image !== undefined && <Thumb src={r.image} size={28} />}
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="truncate font-medium">{r.title}</div>
                      {r.subtitle && <div className="truncate text-[11.5px] text-muted-foreground">{r.subtitle}</div>}
                    </div>
                    {r.meta && <div className="shrink-0 text-[12px] text-muted-foreground">{r.meta}</div>}
                    {r.status && <StatusBadge value={r.status} tone={r.statusTone} />}
                  </div>
                );
                return <li key={r.id}>{r.href ? <Link href={r.href}>{body}</Link> : body}</li>;
              })}
            </ul>
          ) : <div className="px-3 py-3 text-[12.5px] text-muted-foreground">None yet</div>}
        </RailCard>
      ))}
    </div>
  );
}

// Activity tab body: fetches GET /api/e/{entity}/{id}/activity.
export function ActivityPanel({ entity, id, people, initial }: { entity: string; id: string; people?: Record<string, string>; initial?: ActivityEvent[] }) {
  const { rows, loading, error, reload } = useCollab<ActivityEvent>(entity, id, "activity", initial);
  if (error) return <ErrorBanner title="Couldn't load activity" message={error} onRetry={reload} />;
  if (!loading && !rows.length) return <EmptyState compact kind="activity" title="No activity yet" description="Changes, payments, messages and agent actions on this record show up here." />;
  return <ActivityTimeline events={rows} people={people} loading={loading} />;
}
