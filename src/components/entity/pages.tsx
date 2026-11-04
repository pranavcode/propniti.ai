import "server-only";
import Link from "@/components/Link";
import { Fragment } from "react";
import { notFound } from "next/navigation";
import { ChevronRight, Sparkles } from "lucide-react";
import { allEntities, can, getEntity, type ChartDef, type EntityDef, type KpiDef, type ListQuery, type Row, type TabDef } from "@/entities";
import { getTab } from "@/extensions/tabs";
import { cachedSummary } from "@/ai/summaries";
import type { Session } from "@/auth/session";
import { Cell } from "@/components/app/data-table/cells";
import { fillTemplate } from "@/components/app/data-table/params";
import { StatusBadge } from "@/components/app/display";
import { DataHealthBadge, type HealthIssue } from "@/components/app/ai/DataHealthBadge";
import { EmptyState, ErrorBanner } from "@/components/app/states";
import { collab, effective, facetOptions, getRow, list, metrics, parseListQuery, QueryError, relations, withView, type QueryCtx } from "@/server/query";
import { getPlatform } from "@/lib/platform";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Term } from "@/components/app/Term";
import { EntityList } from "./EntityList";
import { ChartPanel, KpiTile, type ChartData, type KpiData } from "./Metrics";
import { RecordActions } from "./RecordActions";
import { RecordSummary } from "./RecordSummary";
import { actionButtons, healthIssues, statusKeyOf } from "./peek";
import { Composer } from "./Composer";
import { withActorNames } from "@/server/actors";
import { bulkActions, columnKind, formFields, parentValues, refHref, statusTabs, tableColumns, tableFacets } from "./spec";

// Generic list, record and module pages (plan §4), rendered on the server from the registry.
// Static routes under src/app/(app)/app/ override these for custom pages.

// KPI tiles fill their row on desktop: two tiles take half each, three a third. A lone tile stays
// card-sized rather than stretching across the page.
const KPI_COLS = ["", "lg:grid-cols-4", "lg:grid-cols-2", "lg:grid-cols-3", "lg:grid-cols-4"];
const ctxOf = (s: Session): QueryCtx => ({ db: getPlatform().db, ws: s.ws, actor: s.actor });
const errMsg = (e: unknown) => (e instanceof QueryError ? e.message : "This list couldn't load. Try again, or clear the filters.");
// Links from stored data: same-site paths and http(s) only, never javascript: or data: URLs.
const safeHref = (u: unknown) => (typeof u === "string" && /^(\/(?!\/)|https?:\/\/)/i.test(u) ? u : undefined);
const attempt = <T,>(p: Promise<T>) => p.then((res) => ({ res, error: null as string | null }), (e) => ({ res: null, error: errMsg(e) }));

async function kpiData(ctx: QueryCtx, kpis: KpiDef[], property?: string): Promise<KpiData[]> {
  return Promise.all(kpis.filter((k) => !k.roles || k.roles.includes(ctx.actor.role)).map(async (k) => {
    const base = { key: k.key, metric: k.metric, property, label: k.label, format: k.format, goodWhen: k.goodWhen, drill: k.drill && property ? `${k.drill}${k.drill.includes("?") ? "&" : "?"}f.property_id=${property}` : k.drill, help: k.help?.summary };
    try {
      const m = await metrics(ctx, k.metric, { property });
      return { ...base, value: m.value ?? null, previous: m.previous ?? null, spark: m.spark ?? [], asOf: m.asOf };
    } catch (e) {
      return { ...base, value: null, previous: null, spark: [], error: errMsg(e) };
    }
  }));
}

async function chartData(ctx: QueryCtx, charts: ChartDef[], property?: string): Promise<ChartData[]> {
  return Promise.all(charts.filter((c) => !c.roles || c.roles.includes(ctx.actor.role)).map(async (c) => {
    const base = { key: c.key, title: c.title, kind: c.kind, x: c.x, series: c.series, drill: c.drill };
    try {
      const m = await metrics(ctx, c.metric, { property });
      return { ...base, points: m.points, asOf: m.asOf, source: m.source };
    } catch (e) {
      return { ...base, points: [], error: errMsg(e) };
    }
  }));
}

function PageHeader({ def, title, children }: { def: EntityDef; title?: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-[18px] font-semibold tracking-tight"><def.icon className="size-5 text-muted-foreground" />{title ?? def.label.many}</h1>
        {def.help && <p className="mt-0.5 max-w-3xl text-[13px] text-muted-foreground">{def.help.summary}</p>}
      </div>
      {children}
    </header>
  );
}

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------

export async function ListView({ def, searchParams, session }: { def: EntityDef; searchParams: URLSearchParams; session: Session }) {
  const ctx = ctxOf(session);
  const role = session.actor.role;
  if (!can(role, "read", def.key)) return <Denied def={def} />;
  const sp = withView(def, searchParams);
  const q: ListQuery = parseListQuery(sp);
  const [{ res, error }, facets, kpis] = await Promise.all([
    attempt(list(ctx, def.key, q)),
    facetOptions(ctx, def.key, q).catch(() => ({})),
    kpiData(ctx, (def.kpis ?? []).slice(0, 4)),
  ]);
  const createFields = can(role, "create", def.key) ? formFields(def, role, "create") : null;
  return (
    <main className="space-y-4 p-4 md:p-6">
      <PageHeader def={def} />
      {kpis.length > 0 && <div className={cn("grid grid-cols-2 gap-3", KPI_COLS[Math.min(kpis.length, 4)])}>{kpis.map((k) => <KpiTile key={k.key} k={k} />)}</div>}
      <EntityList
        key={def.key}
        entity={def.key}
        label={def.label}
        routeBase={def.route}
        columns={tableColumns(def, role)}
        rows={res?.rows ?? []}
        total={res?.total ?? 0}
        page={res?.page ?? 1}
        size={res?.size ?? 50}
        counts={res?.counts}
        footer={res?.footer}
        statusTabs={statusTabs(def, role)}
        facets={tableFacets(def, role, facets)}
        rowHref={`${def.route}/{id}`}
        exportHref={`/api/e/${def.key}/export.csv`}
        views={def.list.savedViews}
        bulkActions={bulkActions(def, role)}
        searchPlaceholder={`Search ${def.label.many.toLowerCase()}…`}
        empty={{ title: `No ${def.label.many.toLowerCase()} yet`, description: def.help?.summary, action: createFields ? { label: `New ${def.label.one.toLowerCase()}`, href: `${def.route}?new=1` } : undefined }}
        error={error}
        create={createFields ? { fields: createFields } : undefined}
      />
    </main>
  );
}

function Denied({ def }: { def: EntityDef }) {
  return (
    <main className="p-6">
      <EmptyState kind="table" title={`${def.label.many} aren't part of your role`} description="Switch role from your avatar menu to see this page as someone who works with it." action={{ label: "Go to your home", href: "/app" }} />
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------------------------

type AnyTab = { key: string; label: string; kind: "fields" | "relation" | "custom" | "notes" | "tasks" | "activity" | "documents"; tab?: TabDef; customKey?: string };

function tabsFor(def: EntityDef, role: Session["actor"]["role"]): AnyTab[] {
  const out: AnyTab[] = [];
  for (const t of def.detail.tabs) {
    if ("custom" in t) {
      const c = getTab(t.custom);
      if (c && (!c.roles || c.roles.includes(role))) out.push({ key: t.custom.split(".")[1], label: c.label, kind: "custom", customKey: t.custom });
      continue;
    }
    if (t.roles && !t.roles.includes(role)) continue;
    if (t.relation) {
      const r = def.relations.find((x) => x.name === t.relation);
      if (!r || !getEntity(r.entity) || !can(role, "read", r.entity)) continue;
    }
    out.push({ key: t.key, label: t.label, kind: t.relation ? "relation" : "fields", tab: t });
  }
  const caps = def.capabilities ?? {};
  if (caps.activity) out.push({ key: "activity", label: "Activity", kind: "activity" });
  if (caps.notes) out.push({ key: "notes", label: "Notes", kind: "notes" });
  if (caps.tasks) out.push({ key: "tasks", label: "Tasks", kind: "tasks" });
  if (caps.documents && can(role, "read", "documents")) out.push({ key: "documents", label: "Documents", kind: "documents" });
  return out;
}

function FieldGrid({ def, row, keys, role }: { def: EntityDef; row: Row; keys: string[]; role: Session["actor"]["role"] }) {
  const shown = keys.filter((k) => def.fields[k] && !def.fields[k].hiddenFor?.includes(role));
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
      {shown.map((k) => {
        const f = def.fields[k];
        return (
          <div key={k} className="min-w-0 border-b border-dashed pb-2">
            <dt className="flex items-center gap-1 text-[11.5px] text-muted-foreground"><Term help={f.help}>{f.label}</Term></dt>
            <dd className="mt-0.5 min-w-0 truncate text-[13px]">
              {f.type === "json"
                ? <span className="whitespace-normal break-words text-[12.5px]">{Array.isArray(row[k]) ? (row[k] as unknown[]).map(String).join(", ") || "—" : row[k] == null ? "—" : JSON.stringify(row[k])}</span>
                : <Cell col={{ key: k, label: f.label, kind: columnKind(k, f), enum: f.enum, href: f.type === "ref" ? refHref(f, k) : undefined }} row={row} />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function CollabList({ kind, rows }: { kind: "notes" | "tasks" | "activity" | "documents"; rows: Row[] }) {
  if (!rows.length) return <EmptyState compact kind="table" title={kind === "activity" ? "No activity yet" : `No ${kind} yet`} description={kind === "activity" ? "Changes, payments, approvals and agent actions on this record appear here." : undefined} />;
  return (
    <ol className="divide-y rounded-lg border">
      {rows.map((r) => (
        <li key={String(r.id)} className="flex items-start gap-3 px-3 py-2.5">
          {kind === "activity" && <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", r.actor_kind === "agent" ? "bg-tone-ai" : "bg-muted-foreground/50")} />}
          <div className="min-w-0 flex-1">
            {kind === "notes" && <p className="whitespace-pre-wrap text-[13px]">{String(r.body).replace(/@\[([^\]]+)\]\(staff:[\w-]+\)/g, "@$1")}</p>}
            {kind === "tasks" && <p className="text-[13px] font-medium">{String(r.title)} <StatusBadge value={r.status} className="ml-1" /></p>}
            {kind === "activity" && <p className="text-[13px]">{String(r.summary)}{r.actor_kind === "agent" && <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-tone-ai"><Sparkles className="size-3" />AI</span>}</p>}
            {kind === "documents" && <a href={safeHref(r.url)} target="_blank" rel="noreferrer" className="text-[13px] font-medium hover:text-primary hover:underline">{String(r.name)}</a>}
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              {kind === "notes" && <>{String(r.author_name ?? r.author_id)} · </>}
              {kind === "tasks" && r.due_on != null && <>Due {String(r.due_on)} · {String(r.priority)} · </>}
              {kind === "documents" && <>{String(r.doc_type ?? "Document")}{r.filed_to ? ` · ${String(r.filed_to)}` : ""} · </>}
              <span title={formatDateTime(String(r.created_at ?? r.at ?? r.uploaded_at))}>{formatRelative(String(r.created_at ?? r.at ?? r.uploaded_at))}</span>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export async function RecordView({ def, id, row: loaded, searchParams, session }: { def: EntityDef; id: string; row?: Row; searchParams: URLSearchParams; session: Session }) {
  const ctx = ctxOf(session);
  const role = session.actor.role;
  if (!can(role, "read", def.key)) return <Denied def={def} />;
  const row = loaded ?? await getRow(ctx, def.key, id);
  if (!row) notFound();
  const tabs = tabsFor(def, role);
  const active = tabs.find((t) => t.key === searchParams.get("tab")) ?? tabs[0];
  // The active tab loads alongside the header data, not after it.
  const tabBody = async (): Promise<React.ReactNode> => {
    if (active?.kind === "fields") {
      return <FieldGrid def={def} row={row} keys={active.tab!.fields ?? Object.keys(def.fields)} role={role} />;
    } else if (active?.kind === "relation") {
      const r = def.relations.find((x) => x.name === active.tab!.relation)!;
      const rel = getEntity(r.entity)!;
      const [remote, local] = r.fk.split("=", 2);
      const value = local ? (await ctx.db.prepare(`SELECT ${local.replace(/[^a-z_]/g, "")} AS v FROM ${effective(def.table, ctx.ws)} WHERE id = ?`).bind(id).first<{ v: unknown }>())?.v : id;
      const q = parseListQuery(withView(rel, searchParams));
      const sub = def.relations.find((x) => x.name === "subaccounts");
      const [{ res, error }, facets, children] = await Promise.all([
        attempt(list(ctx, rel.key, { ...q, where: { column: remote, value } })),
        facetOptions(ctx, rel.key, q).catch(() => ({})),
        sub ? list(ctx, def.key, { size: 20, where: { column: sub.fk, value: id } }).then((x) => x.rows).catch(() => []) : Promise.resolve([]),
      ]);
      const relCreate = can(role, "create", rel.key) ? { fields: formFields(rel, role, "create"), parent: parentValues(def, row, rel, remote, value) } : undefined;
      return (
        <div className="space-y-3">
        {children.length > 0 && (
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-[12.5px] text-muted-foreground">
            {rel.label.many} post to its sub-accounts:{" "}
            {children.map((c, i) => <Fragment key={String(c.id)}>{i > 0 && ", "}<Link href={`${def.route}/${encodeURIComponent(String(c.id))}`} className="font-medium text-foreground hover:text-primary hover:underline">{String(c._title ?? c.id)}</Link></Fragment>)}
            ; its totals include them.
          </p>
        )}
        <EntityList key={rel.key} entity={rel.key} label={rel.label} routeBase={rel.route} columns={tableColumns(rel, role, [remote])} rows={res?.rows ?? []} total={res?.total ?? 0} page={res?.page ?? 1} size={res?.size ?? 50}
          counts={res?.counts} footer={res?.footer} statusTabs={statusTabs(rel, role)} facets={tableFacets(rel, role, facets).filter((f) => f.key !== remote)} rowHref={`${rel.route}/{id}`} views={rel.list.savedViews}
          searchPlaceholder={`Search ${rel.label.many.toLowerCase()}…`} empty={{ title: `No ${rel.label.many.toLowerCase()} on this ${def.label.one.toLowerCase()}` }} error={error} maxHeight="70vh" create={relCreate} />
        </div>
      );
    } else if (active?.kind === "custom") {
      const c = getTab(active.customKey!)!;
      return c.component({ entity: def.key, id, row, actor: session.actor });
    } else if (active) {
      const res = await collab(ctx, active.kind as "notes" | "tasks" | "activity" | "documents", def.key, id, Number(searchParams.get("page")) || 1, 50);
      if (active.kind === "notes") res.rows = await withActorNames(ctx, res.rows, "author_id", "author_name");
      return (
        <div className="space-y-3">
          {(active.kind === "notes" || active.kind === "tasks") && <Composer entity={def.key} id={id} kind={active.kind} />}
          <CollabList kind={active.kind as "notes"} rows={res.rows} />
        </div>
      );
    }
    return null;
  };
  const [rail, issues, summary, kpis, body] = await Promise.all([
    relations(ctx, def, row, def.detail.related, 5),
    def.dataRules?.length ? healthIssues(ctx, def.key, id) : Promise.resolve([] as HealthIssue[]),
    def.capabilities?.aiSummary ? cachedSummary({ db: ctx.db, ws: session.ws ?? "base", actor: session.actor }, def.key, id, row) : Promise.resolve(null),
    def.key === "properties" ? kpiData(ctx, (def.kpis ?? []).slice(0, 4), id) : Promise.resolve([] as KpiData[]),
    tabBody(),
  ]);
  const statusKey = statusKeyOf(def);
  const hero = typeof row._image === "string" ? row._image.replace(/-400\.webp$/, ".webp") : null;
  const facts = def.detail.facts.filter((k) => k !== statusKey && def.fields[k] && !def.fields[k].hiddenFor?.includes(role));
  const actions = actionButtons(def, role, row);
  const editFields = can(role, "update", def.key) ? formFields(def, role, "update") : [];
  const title = String(row._title ?? id);


  return (
    <main className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- static webp in /public; the Workers build has no image optimizer */}
        {hero && <img src={hero} alt="" className="h-24 w-36 shrink-0 rounded-lg object-cover ring-1 ring-border" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[12px] text-muted-foreground"><Link href={def.route} className="hover:text-foreground hover:underline">{def.label.many}</Link><ChevronRight className="size-3" /><span className="truncate">{id}</span></div>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-2 text-[20px] font-semibold tracking-tight">
            {title}
            {statusKey && row[statusKey] != null && <StatusBadge value={row[statusKey]} enumDef={def.fields[statusKey].enum} />}
            {def.dataRules?.length ? <DataHealthBadge issues={issues} /> : null}
          </h1>
          {typeof row._subtitle === "string" && row._subtitle && <p className="text-[13px] text-muted-foreground">{row._subtitle}</p>}
        </div>
        <RecordActions entity={def.key} id={id} title={title} label={def.label} routeBase={def.route} actions={actions}
          edit={editFields.length ? { fields: editFields, initial: row } : undefined} canDelete={can(role, "delete", def.key)} />
      </div>

      {facts.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-card">
        <dl className="-mb-px -mr-px grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))]">
          {facts.map((k) => {
            const f = def.fields[k];
            return (
              <div key={k} className="min-w-0 border-b border-r px-3 py-2">
                <dt className="flex min-w-0 text-[11px] text-muted-foreground"><span className="min-w-0 truncate"><Term help={f.help}>{f.label}</Term></span></dt>
                <dd className="mt-0.5 truncate text-[13.5px] font-medium"><Cell col={{ key: k, label: f.label, kind: columnKind(k, f), enum: f.enum, href: f.type === "ref" ? refHref(f, k) : undefined, moneyStyle: "whole" }} row={row} /></dd>
              </div>
            );
          })}
        </dl>
        </div>
      )}

      {kpis.length > 0 && <div className={cn("grid grid-cols-2 gap-3", KPI_COLS[Math.min(kpis.length, 4)])}>{kpis.map((k) => <KpiTile key={k.key} k={k} />)}</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-3">
          <nav aria-label={`${def.label.one} sections`} className="flex gap-1 overflow-x-auto border-b">
            {tabs.map((t) => (
              <Link key={t.key} href={`?tab=${t.key}`} scroll={false} aria-current={t.key === active?.key ? "page" : undefined}
                className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] transition-colors", t.key === active?.key ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {t.label}
              </Link>
            ))}
          </nav>
          <div>{body}</div>
        </div>

        <aside className="space-y-3">
          {def.capabilities?.aiSummary && (
            <RecordSummary entity={def.key} id={id} label={def.label.one}
              initial={summary && { summary: summary.summary, model: summary.model, generated_at: summary.generated_at, source: summary.source }} />
          )}
          {issues.length > 0 && (
            <section className="rounded-lg border border-tone-warning/30 bg-tone-warning/[0.05] p-3">
              <h2 className="text-[12.5px] font-semibold">Data health</h2>
              <ul className="mt-1.5 space-y-1 text-[12.5px]">{issues.map((i) => <li key={i.id}><Link href={`/app/data-health?f.entity_id=${encodeURIComponent(id)}`} className="hover:underline">{i.summary}</Link></li>)}</ul>
            </section>
          )}
          {Object.entries(rail).map(([name, r]) => {
            const rd = getEntity(r.entity)!;
            return (
              <section key={name} className="rounded-lg border bg-card">
                <h2 className="flex items-center justify-between border-b px-3 py-2 text-[12.5px] font-semibold">{r.label}{r.kind === "many" && <span className="font-normal text-muted-foreground tabular-nums">{r.total}</span>}</h2>
                {r.rows.length ? (
                  <ul className="divide-y">
                    {r.rows.map((x) => (
                      <li key={String(x.id)}>
                        <Link href={`${rd.route}/${encodeURIComponent(String(x.id))}`} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50">
                          {/* eslint-disable-next-line @next/next/no-img-element -- 400px thumb */}
                          {typeof x._image === "string" && <img src={x._image} alt="" className="size-8 shrink-0 rounded object-cover" loading="lazy" />}
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium">{String(x._title ?? x.id)}</span>
                            {typeof x._subtitle === "string" && x._subtitle && <span className="block truncate text-[11.5px] text-muted-foreground">{x._subtitle}</span>}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <p className="px-3 py-2 text-[12.5px] text-muted-foreground">None</p>}
              </section>
            );
          })}
        </aside>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------------------------
// Module index: /app/<section> when it isn't an entity route, e.g. /app/maintenance. A dashboard
// built from the KPIs and charts of every entity under that route, plus their main lists.
// ---------------------------------------------------------------------------------------------

export function moduleDefs(path: string, role: Session["actor"]["role"]) {
  const prefix = path.replace(/\/+$/, "") + "/";
  return allEntities().filter((d) => d.route.startsWith(prefix) && can(role, "read", d.key)).sort((a, b) => (a.nav?.order ?? 99) - (b.nav?.order ?? 99));
}

export async function ModuleIndex({ path, session }: { path: string; session: Session }) {
  const ctx = ctxOf(session);
  const all = allEntities().filter((d) => d.route.startsWith(path.replace(/\/+$/, "") + "/"));
  const defs = moduleDefs(path, session.actor.role);
  if (!all.length) notFound();
  const title = path.split("/").pop()!.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  if (!defs.length) return <main className="p-6"><EmptyState title={`${title} isn't part of your role`} description="Switch role from your avatar menu to see this area." action={{ label: "Go to your home", href: "/app" }} /></main>;
  const seenK = new Set<string>(), seenC = new Set<string>();
  const kpiDefs = defs.flatMap((d) => d.kpis ?? []).filter((k) => !seenK.has(k.metric) && seenK.add(k.metric)).slice(0, 4);
  const chartDefs = defs.flatMap((d) => d.charts ?? []).filter((c) => !seenC.has(c.metric + c.x) && seenC.add(c.metric + c.x)).slice(0, 4);
  const [kpis, charts, lists] = await Promise.all([
    kpiData(ctx, kpiDefs),
    chartData(ctx, chartDefs),
    Promise.all(defs.map(async (d) => ({ d, res: await list(ctx, d.key, { size: 6 }).catch(() => null) }))),
  ]);
  return (
    <main className="space-y-5 p-4 md:p-6">
      <header>
        <h1 className="text-[18px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{session.actor.scope.label} · {defs.map((d) => d.label.many).join(", ")}</p>
      </header>
      {kpis.length > 0 && <div className={cn("grid grid-cols-2 gap-3", KPI_COLS[Math.min(kpis.length, 4)])}>{kpis.map((k) => <KpiTile key={k.key} k={k} />)}</div>}
      {charts.length > 0 && <div className="grid gap-3 lg:grid-cols-2">{charts.map((c) => <ChartPanel key={c.key} c={c} />)}</div>}
      <div className="grid gap-3 lg:grid-cols-2">
        {lists.map(({ d, res }) => {
          const cols = tableColumns(d, session.actor.role).filter((c) => !c.defaultHidden).slice(0, 4);
          return (
            <section key={d.key} className="rounded-lg border bg-card">
              <header className="flex items-center justify-between border-b px-3 py-2">
                <h2 className="flex items-center gap-1.5 text-[13px] font-semibold"><d.icon className="size-4 text-muted-foreground" />{d.label.many}</h2>
                <Link href={d.route} className="text-[12px] text-primary hover:underline">All {res?.total ?? ""} →</Link>
              </header>
              {!res ? <ErrorBanner className="m-3" message={`${d.label.many} couldn't load.`} /> : res.rows.length === 0 ? <EmptyState compact title={`No ${d.label.many.toLowerCase()} yet`} /> : (
                <table className="w-full text-[13px]">
                  <tbody>
                    {res.rows.map((r) => (
                      <tr key={String(r.id)} className="border-b last:border-0 hover:bg-muted/40">
                        {cols.map((c, i) => (
                          <td key={c.key} className={cn("max-w-0 px-3 py-1.5", i > 0 && "text-right", i === 0 && "w-1/2")}>
                            {i === 0 ? <Link href={fillTemplate(`${d.route}/{id}`, r)} className="block truncate font-medium hover:text-primary">{String(r._title ?? r.id)}</Link> : <span className="block truncate"><Cell col={c} row={r} /></span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
