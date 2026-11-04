import "server-only";
import type { EntityDef, FieldDef, ListQuery, Row } from "@/entities/types";
import { demoNowIso } from "@/lib/clock";
import { capNote, EXPORT_CAP, type ExportDoc, type Kind } from "@/lib/export/types";
import { exportColumns, getDef, list, PAGE_SIZE_CAP, type QueryCtx } from "@/server/query";

// An entity list as an export document: the rows the list shows (same scope, search, filters,
// saved view, sort and columns) up to EXPORT_CAP, refs as labels and enums as their labels.

const kindOf = (f: FieldDef): Kind =>
  f.type === "number" && f.format === "pct" ? "percent" : f.type === "money" || f.type === "number" || f.type === "date" || f.type === "datetime" || f.type === "bool" ? f.type : "text";

function value(k: string, f: FieldDef, r: Row) {
  if (f.type === "ref") return (r[`${k}__label`] ?? r[k]) as string | null;
  if (f.type === "enum") return f.enum?.find((e) => e.value === r[k])?.label ?? (r[k] as string | null);
  // Like formatPct: a stored value above 1.5 is already a percent (95.3), not a ratio.
  if (kindOf(f) === "percent" && typeof r[k] === "number") return Math.abs(r[k]) <= 1.5 ? r[k] : r[k] / 100;
  return r[k] as string | number | boolean | null;
}

function describe(def: EntityDef, q: ListQuery, view: string | undefined, rows: Row[]): string[] {
  const out: string[] = [];
  if (view) out.push(`View: ${view}`);
  if (q.q) out.push(`Search: "${q.q}"`);
  for (const [k, v] of Object.entries(q.filters ?? {})) {
    const f = def.fields[k];
    const vals = (Array.isArray(v) ? v : [v]).map((x) =>
      f?.type === "enum" ? f.enum?.find((e) => e.value === x)?.label ?? x
      : f?.type === "ref" ? String(rows.find((r) => r[k] === x)?.[`${k}__label`] ?? x)
      : x);
    out.push(`${f?.label ?? k.replace(/_/g, " ")}: ${vals.join(", ")}`);
  }
  if (q.sort) out.push(`Sorted by ${def.fields[q.sort[0]]?.label.toLowerCase() ?? q.sort[0]}, ${q.sort[1] === "asc" ? "ascending" : "descending"}`);
  return out;
}

export async function entityDoc(ctx: QueryCtx, entity: string, q: ListQuery, opts: { branded: boolean; view?: string }): Promise<ExportDoc> {
  const def = getDef(entity);
  const cols = exportColumns(def, ctx.actor.role, q);
  const first = await list(ctx, entity, { ...q, size: PAGE_SIZE_CAP, page: 1, cursor: undefined });
  const rows = [...first.rows];
  let cursor = first.nextCursor;
  while (cursor && rows.length < EXPORT_CAP) {
    const res = await list(ctx, entity, { ...q, size: PAGE_SIZE_CAP, cursor, page: 1, rowsOnly: true });
    rows.push(...res.rows);
    cursor = res.nextCursor;
  }
  const kept = rows.slice(0, EXPORT_CAP);
  return {
    title: def.label.many,
    columns: [{ label: "ID" }, ...cols.map(([, f]) => ({ label: f.label, kind: kindOf(f) }))],
    rows: kept.map((r) => [r.id as string, ...cols.map(([k, f]) => value(k, f, r))]),
    branded: opts.branded,
    scope: ctx.actor.scope.label,
    filters: describe(def, q, opts.view, kept),
    generatedAt: demoNowIso(),
    note: first.total > EXPORT_CAP ? capNote(first.total) : undefined,
  };
}
