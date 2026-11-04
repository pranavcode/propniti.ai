import "server-only";
import { can, getEntity, type EntityDef, type Row } from "@/entities";
import type { HealthIssue } from "@/components/app/ai/DataHealthBadge";
import type { DataColumn } from "@/components/app/data-table/types";
import { effective, relations, type QueryCtx } from "@/server/query";
import { actionsForRow } from "@/server/permissions";
import { cachedSummary, type Summary } from "@/ai/summaries";
import { columnKind, formFields, refHref, type FormField } from "./spec";
import type { ActionButton } from "./RecordActions";

// The record page's header data, shared by the full page (pages.tsx) and the peek drawer
// (GET /api/e/[entity]/[id]?peek=1). Same queries, same role checks.

export async function healthIssues(ctx: QueryCtx, entity: string, id: string): Promise<HealthIssue[]> {
  const res = await ctx.db.prepare(`SELECT i.id, i.rule_id, i.severity, coalesce(r.name, i.rule_id) AS name FROM ${effective("data_issues", ctx.ws)} i LEFT JOIN ${effective("data_rules", ctx.ws)} r ON r.id = i.rule_id WHERE i.entity_type = ? AND i.entity_id = ? AND i.status = 'open' ORDER BY i.detected_at DESC LIMIT 10`).bind(entity, id).all();
  return res.results.map((r) => ({ id: String(r.id), rule: String(r.rule_id), severity: r.severity as HealthIssue["severity"], summary: String(r.name) }));
}

export type AiSummary = Pick<Summary, "summary" | "model" | "generated_at" | "source">;

// Built from the row's current figures (see cachedSummary), so it matches the facts shown beside it.
export async function aiSummary(ctx: QueryCtx, entity: string, id: string, row: Row): Promise<AiSummary | null> {
  const s = await cachedSummary({ db: ctx.db, ws: ctx.ws ?? "base", actor: ctx.actor }, entity, id, row);
  return s && { summary: s.summary, model: s.model, generated_at: s.generated_at, source: s.source };
}

export const statusKeyOf = (def: EntityDef) => (def.list.statusTabs && def.fields[def.list.statusTabs]?.type === "enum" ? def.list.statusTabs : def.fields.status ? "status" : null);

export const actionButtons = (def: EntityDef, role: QueryCtx["actor"]["role"], row: Row): ActionButton[] =>
  actionsForRow(def.key, role, row).map((a) => ({ key: a.key, label: a.label, confirm: a.confirm, money: !!a.money, hasInput: !!a.input }));

export type PeekRelated = { name: string; label: string; kind: "one" | "many"; total: number; href: string; title?: string };

export type PeekData = {
  entity: string;
  label: { one: string; many: string };
  route: string;
  href: string;
  title: string;
  subtitle: string | null;
  image: string | null;
  status: { key: string; enum?: DataColumn["enum"] } | null;
  health: HealthIssue[] | null;          // null: no data-health rules for this entity
  summary: AiSummary | null | false;     // false: the entity has no AI summary
  facts: DataColumn[];
  related: PeekRelated[];
  actions: ActionButton[];
  edit: FormField[] | null;
  canDelete: boolean;
};

export async function peekData(ctx: QueryCtx, def: EntityDef, row: Row): Promise<PeekData> {
  const role = ctx.actor.role;
  const id = String(row.id);
  const href = `${def.route}/${encodeURIComponent(id)}`;
  const names = def.detail.related.length ? def.detail.related : def.relations.slice(0, 4).map((r) => r.name);
  const [rail, health, summary] = await Promise.all([
    // Counts only: the first row of each relation carries its total.
    relations(ctx, def, row, names, 1),
    def.dataRules?.length ? healthIssues(ctx, def.key, id) : Promise.resolve(null),
    def.capabilities?.aiSummary ? aiSummary(ctx, def.key, id, row) : Promise.resolve(false as const),
  ]);
  const statusKey = statusKeyOf(def);
  const related = names.flatMap((name): PeekRelated[] => {
    const r = rail[name];
    const rd = r && getEntity(r.entity);
    if (!r || !rd) return [];
    if (r.kind === "one") {
      const one = r.rows[0];
      return [{ name, label: r.label, kind: "one", total: r.total, title: one ? String(one._title ?? one.id) : undefined, href: one ? `${rd.route}/${encodeURIComponent(String(one.id))}` : href }];
    }
    const tab = def.detail.tabs.find((t) => "relation" in t && t.relation === name);
    return [{ name, label: r.label, kind: "many", total: r.total, href: tab && "key" in tab ? `${href}?tab=${tab.key}` : href }];
  });
  return {
    entity: def.key,
    label: def.label,
    route: def.route,
    href,
    title: String(row._title ?? id),
    subtitle: typeof row._subtitle === "string" && row._subtitle ? row._subtitle : null,
    image: typeof row._image === "string" ? row._image : null,
    status: statusKey && row[statusKey] != null ? { key: statusKey, enum: def.fields[statusKey].enum } : null,
    health,
    summary: summary ?? null,
    facts: def.detail.facts.filter((k) => k !== statusKey && def.fields[k] && !def.fields[k].hiddenFor?.includes(role)).map((k) => {
      const f = def.fields[k];
      return { key: k, label: f.label, kind: columnKind(k, f), enum: f.enum, href: f.type === "ref" ? refHref(f, k) : undefined, moneyStyle: "whole" };
    }),
    related,
    actions: actionButtons(def, role, row),
    edit: can(role, "update", def.key) ? formFields(def, role, "update") : null,
    canDelete: can(role, "delete", def.key),
  };
}
