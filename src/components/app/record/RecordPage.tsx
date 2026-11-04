"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import type { Capabilities, Row, Tone } from "@/entities/types";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useUrlState } from "@/hooks/use-url-state";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataHealthBadge, type HealthIssue } from "../ai/DataHealthBadge";
import { Kbd, PersonAvatar, StatusBadge } from "../display";
import { InlineField, type SaveField } from "../forms/InlineField";
import type { FieldSpec } from "../forms/types";
import { useTrackRecent } from "../recent";
import { useBreadcrumbTitle } from "../shell/context";
import type { ActivityEvent } from "./ActivityTimeline";
import { DocumentsPanel, type DocumentRow } from "./DocumentsPanel";
import { NotesPanel, type NoteRow, type Person } from "./NotesPanel";
import { ActivityPanel, RailCard, RelatedRail, type RelatedGroup } from "./RelatedRail";
import { TasksPanel, type TaskRow } from "./TasksPanel";

export type RecordFact = { label: string; value: React.ReactNode; href?: string; hint?: string };
export type RecordAction = { key: string; label: string; icon?: React.ReactNode; href?: string; onSelect?: () => void; tone?: "danger" };
export type RecordTab = { key: string; label: string; count?: number };

export type RecordPageProps = {
  entity: string;
  id: string;
  label?: { one: string; many: string };
  listHref?: string;                       // list route; also the recent-record href base
  title: string;
  subtitle?: React.ReactNode;
  image?: string | null;                   // photo; omit for a person avatar from the title
  avatar?: boolean;                        // show initials avatar (people records)
  icon?: React.ReactNode;                  // fallback tile icon
  status?: { value: string; tone?: Tone; enum?: { value: string; tone: Tone; label?: string }[] };
  health?: HealthIssue[] | number;
  onFix?: (issue?: HealthIssue) => void;
  facts?: RecordFact[];
  actions?: React.ReactNode;               // primary buttons, top right
  secondaryActions?: RecordAction[];       // ⋯ menu
  nav?: { index: number; total: number; prevHref?: string; nextHref?: string };
  tabs?: RecordTab[];                      // module tabs, before the automatic ones
  defaultTab?: string;
  panels?: Record<string, React.ReactNode>;// tab key → content (server-rendered)
  children?: React.ReactNode;              // content of the active module tab when panels lacks it
  capabilities?: Capabilities;
  people?: Person[];                       // @mention list and actor names
  fields?: FieldSpec[];                    // details rail, inline-editable
  values?: Row;
  onSaveField?: SaveField;
  related?: RelatedGroup[];
  aiSummary?: React.ReactNode;             // AISummaryCard (lane B ai/) or lane E's
  rail?: React.ReactNode;                  // extra rail cards under details
  initial?: { notes?: NoteRow[]; tasks?: TaskRow[]; activity?: ActivityEvent[]; documents?: DocumentRow[] };
};

// Record detail (brief §3.2): header with facts and actions, URL tabs (?tab=), automatic
// Activity/Notes/Tasks/Documents tabs from capabilities, and a rail with AI summary, inline-edit
// details and related records. Prev/next with [ and ].
export function RecordPage(p: RecordPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { params, set, pending } = useUrlState();
  useBreadcrumbTitle(p.title);
  useTrackRecent({ entity: p.entity, id: p.id, title: p.title, subtitle: p.label?.one, href: p.listHref ? `${p.listHref}/${encodeURIComponent(p.id)}` : pathname });

  const auto: RecordTab[] = [
    ...(p.capabilities?.activity ? [{ key: "activity", label: "Activity" }] : []),
    ...(p.capabilities?.notes ? [{ key: "notes", label: "Notes", count: p.initial?.notes?.length }] : []),
    ...(p.capabilities?.tasks ? [{ key: "tasks", label: "Tasks", count: p.initial?.tasks?.filter((t) => t.status !== "Done" && t.status !== "Cancelled").length }] : []),
    ...(p.capabilities?.documents ? [{ key: "documents", label: "Documents", count: p.initial?.documents?.length }] : []),
  ];
  const tabs = [...(p.tabs ?? []), ...auto.filter((a) => !p.tabs?.some((t) => t.key === a.key))];
  const active = tabs.find((t) => t.key === params.get("tab"))?.key ?? p.defaultTab ?? tabs[0]?.key;
  const names = Object.fromEntries((p.people ?? []).map((x) => [x.id, x.name]));

  useHotkeys({
    "[": () => { if (!p.nav?.prevHref) return false; router.push(p.nav.prevHref); },
    "]": () => { if (!p.nav?.nextHref) return false; router.push(p.nav.nextHref); },
  });

  let body: React.ReactNode;
  if (active === "notes" && !p.panels?.notes) body = <NotesPanel entity={p.entity} id={p.id} people={p.people} initial={p.initial?.notes} />;
  else if (active === "tasks" && !p.panels?.tasks) body = <TasksPanel entity={p.entity} id={p.id} people={p.people} initial={p.initial?.tasks} />;
  else if (active === "activity" && !p.panels?.activity) body = <ActivityPanel entity={p.entity} id={p.id} people={names} initial={p.initial?.activity} />;
  else if (active === "documents" && !p.panels?.documents) body = <DocumentsPanel entity={p.entity} id={p.id} initial={p.initial?.documents} />;
  else body = (active && p.panels?.[active]) ?? p.children;

  const hasRail = !!(p.aiSummary || p.fields?.length || p.related?.length || p.rail);

  return (
    <div className="pb-10">
      <header className="border-b px-4 pt-5 md:px-6">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 items-start gap-3.5">
            {p.image ? (
              // eslint-disable-next-line @next/next/no-img-element -- record photo, pre-sized WebP
              <img src={p.image} alt="" className="size-14 shrink-0 rounded-lg object-cover ring-1 ring-border" />
            ) : p.avatar ? <PersonAvatar name={p.title} size={56} /> : p.icon ? (
              <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground [&_svg]:size-6">{p.icon}</span>
            ) : null}
            <div className="min-w-0 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-[20px] leading-7 font-semibold tracking-[-0.01em]">{p.title}</h1>
                {p.status && <StatusBadge value={p.status.value} tone={p.status.tone} enumDef={p.status.enum} />}
                {p.health !== undefined && <DataHealthBadge issues={p.health} onFix={p.onFix} />}
              </div>
              {p.subtitle && <div className="mt-0.5 truncate text-muted-foreground">{p.subtitle}</div>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {p.nav && (
              <div className="mr-1 flex items-center gap-1 text-[12px] text-muted-foreground">
                <span className="tabular-nums">{formatNumber(p.nav.index)} of {formatNumber(p.nav.total)}</span>
                <NavBtn href={p.nav.prevHref} label="Previous" k="[" icon={<ChevronUp />} />
                <NavBtn href={p.nav.nextHref} label="Next" k="]" icon={<ChevronDown />} />
              </div>
            )}
            {p.secondaryActions && p.secondaryActions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="outline" size="icon-sm" aria-label="More actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuGroup>
                  {p.secondaryActions.map((a, i) => (
                    <Fragment key={a.key}>
                      {a.tone === "danger" && i > 0 && <DropdownMenuSeparator />}
                      {a.href
                        ? <DropdownMenuItem asChild><Link href={a.href}>{a.icon}{a.label}</Link></DropdownMenuItem>
                        : <DropdownMenuItem variant={a.tone === "danger" ? "destructive" : "default"} onSelect={a.onSelect}>{a.icon}{a.label}</DropdownMenuItem>}
                    </Fragment>
                  ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {p.actions}
          </div>
        </div>

        {p.facts && p.facts.length > 0 && (
          <dl className="mt-4 flex flex-wrap gap-x-0 gap-y-3">
            {p.facts.map((f) => (
              <div key={f.label} className="min-w-[112px] border-l px-4 first:border-l-0 first:pl-0" title={f.hint}>
                <dt className="text-[11.5px] text-muted-foreground">{f.label}</dt>
                <dd className="mt-0.5 font-medium tabular-nums">{f.href ? <Link href={f.href} className="hover:text-primary hover:underline">{f.value}</Link> : f.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {tabs.length > 0 && (
          <div role="tablist" aria-label={`${p.label?.one ?? "Record"} sections`} className="-mb-px mt-4 flex gap-0.5 overflow-x-auto [scrollbar-width:none]">
            {tabs.map((t) => {
              const on = t.key === active;
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={on}
                  onClick={() => set({ tab: t.key === (p.defaultTab ?? tabs[0]?.key) ? null : t.key })}
                  className={cn("relative flex h-9 shrink-0 items-center gap-1.5 px-2.5 text-[13px] transition-colors", on ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {t.label}
                  {t.count != null && <span className={cn("rounded px-1 text-[11px] tabular-nums", on ? "bg-foreground/[0.07]" : "")}>{formatNumber(t.count)}</span>}
                  {on && <span className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-foreground" />}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <div className={cn("grid gap-6 px-4 pt-5 md:px-6", hasRail && "xl:grid-cols-[minmax(0,1fr)_340px]")}>
        <div role="tabpanel" aria-busy={pending} className={cn("min-w-0 transition-opacity", pending && "opacity-60")}>
          {body ?? (pending ? <TabSkeleton /> : null)}
        </div>
        {hasRail && (
          <aside className="min-w-0 flex flex-col gap-3">
            {p.aiSummary}
            {p.fields && p.fields.length > 0 && (
              <RailCard title="Details">
                <div className="flex flex-col gap-0.5 px-3 py-2">
                  {p.fields.map((f) => <InlineField key={f.key} spec={f} value={p.values?.[f.key]} entity={p.entity} id={p.id} onSave={p.onSaveField} />)}
                </div>
              </RailCard>
            )}
            {p.related && <RelatedRail groups={p.related} />}
            {p.rail}
          </aside>
        )}
      </div>
    </div>
  );
}

function NavBtn({ href, label, k, icon }: { href?: string; label: string; k: string; icon: React.ReactNode }) {
  const btn = href
    ? <Button asChild variant="outline" size="icon-sm"><Link href={href} aria-label={`${label} record`}>{icon}</Link></Button>
    : <Button variant="outline" size="icon-sm" disabled aria-label={`${label} record`}>{icon}</Button>;
  return <Tooltip><TooltipTrigger asChild>{btn}</TooltipTrigger><TooltipContent className="flex items-center gap-1.5">{label} <Kbd>{k}</Kbd></TooltipContent></Tooltip>;
}

function TabSkeleton() {
  return <div className="flex flex-col gap-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" style={{ opacity: 1 - i * 0.2 }} />)}</div>;
}
