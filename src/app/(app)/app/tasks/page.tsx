import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckSquare } from "lucide-react";
import { can, getEntity } from "@/entities";
import { currentSession, requireStaff } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { facetOptions, list, QueryError, type QueryCtx } from "@/server/query";
import { tableColumns, tableFacets } from "@/components/entity/spec";
import { PageBody, PageHeader } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { myTasksQuery, propertyOptions, relatedRecords, staffOptions, taskView, type Related } from "@/extensions/intelligence/my-tasks";
import { getAction } from "@/extensions/actions";
import { AS_OF } from "@/seed/constants";
import { MyTasks } from "@/extensions/intelligence/ui/MyTasks";

export const metadata: Metadata = { title: "My tasks · Propniti" };

// My tasks: the signed-in person's work list (tasks assigned to them, or to their role with no
// person named), in their scope, by due date. Rows open in the peek drawer; /app/tasks/<id> is
// the generic task record.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const FACETS = ["entity_type", "property_id", "priority", "source"];

export default async function TasksPage({ searchParams }: Props) {
  await requireStaff();
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) for (const x of Array.isArray(v) ? v : v == null ? [] : [v]) sp.append(k, x);
  // The home briefing links one task as ?task=<id>: open it in the drawer.
  const task = sp.get("task");
  if (task) {
    sp.delete("task");
    sp.set("peek", task);
    redirect(`/app/tasks?${sp}`);
  }

  const session = await currentSession();
  const { actor } = session;
  const def = getEntity("tasks");
  if (!def || !can(actor.role, "read", "tasks")) {
    return <div className="p-6"><EmptyState kind="tasks" title="Tasks aren't part of your role" description="Switch role from your avatar menu to see a work list." action={{ label: "Go to your home", href: "/app" }} /></div>;
  }
  const ctx: QueryCtx = { db: getPlatform().db, ws: session.ws, actor };
  const view = taskView(sp.get("due"));
  const q = myTasksQuery(actor, sp);
  const [result, facets, properties, staff] = await Promise.all([
    list(ctx, "tasks", q).then((res) => ({ res, error: null }), (e) => ({ res: null, error: e instanceof QueryError ? e.message : "Your tasks couldn't load. Try again, or clear the filters." })),
    facetOptions(ctx, "tasks", q).catch(() => ({})),
    propertyOptions(ctx).catch(() => []),
    staffOptions(ctx).catch(() => []),
  ]);
  // The tasks entity's bulk actions this role may run, labelled from the action registry.
  const bulkActions = (def.list.bulkActions ?? []).filter((k) => can(actor.role, k, "tasks")).map((k) => ({ key: k, label: getAction(k)?.label ?? k }));
  const res = result.res;
  const related = res ? await relatedRecords(ctx, res.rows).catch((): Record<string, Related> => ({})) : {};
  const rows = (res?.rows ?? []).map((r) => ({
    ...r,
    _subtitle: r.detail || null,
    _related: r.entity_type && r.entity_id ? related[`${r.entity_type}:${r.entity_id}`] ?? null : null,
  }));
  const facetList = tableFacets(def, actor.role, facets).filter((f) => FACETS.includes(f.key)).map((f) =>
    f.key === "entity_type" && "options" in f ? { ...f, options: f.options.map((o) => ({ ...o, label: getEntity(o.value)?.label.many ?? o.value })) } : f);

  return (
    <div>
      <PageHeader
        icon={<CheckSquare />}
        title="My tasks"
        description="Follow-ups assigned to you or your role, from people, automations and AI agents."
        meta={<span>{actor.scope.label}</span>}
      />
      <PageBody className="gap-0 pt-2">
        <MyTasks
          me={actor.personaId}
          view={view}
          columns={tableColumns(def, actor.role)}
          rows={rows}
          total={res?.total ?? 0}
          page={res?.page ?? 1}
          size={res?.size ?? 50}
          counts={res?.counts ?? {}}
          facets={facetList}
          error={result.error}
          properties={properties}
          needsProperty={actor.propertyIds !== "all"}
          bulkActions={bulkActions}
          staff={staff}
          today={AS_OF}
        />
      </PageBody>
    </div>
  );
}
