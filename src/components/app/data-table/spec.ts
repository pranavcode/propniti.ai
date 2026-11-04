import "server-only";
import { can, getEntity, type EntityDef, type FieldDef, type Role } from "@/entities";
import { getAction } from "@/extensions/actions";
import type { BulkAction, ColumnKind, DataColumn, Facet, FacetOption, SavedView, StatusTabs } from "./types";

// EntityDef → the plain DataTable props (server side; defs hold functions and stay here).
// Usage in a list page:
//   const spec = tableSpec(def, role);
//   <DataTable {...spec} {...listResult} />

function kindOf(f: FieldDef): ColumnKind {
  switch (f.type) {
    case "number": return f.format === "pct" ? "pct" : "number";
    case "money": return "money";
    case "date": return f.format === "relative" ? "relative" : "date";
    case "datetime": return "relative";
    case "enum": return "enum";
    case "ref": return "ref";
    case "bool": return "bool";
    case "image": return "image";
    case "json": return "json";
    default: return "text";
  }
}

export function columnsFor(def: EntityDef, role: Role): DataColumn[] {
  const out: DataColumn[] = [];
  for (const [key, f] of Object.entries(def.fields)) {
    if (f.hiddenFor?.includes(role)) continue;
    const primary = key === def.titleField;
    if (!primary && !f.list) continue;
    const ref = f.type === "ref" && f.ref ? getEntity(f.ref) : undefined;
    out.push({
      key,
      label: f.label,
      kind: kindOf(f),
      align: f.list?.align,
      width: f.list?.width,
      sortable: f.sortable !== false,
      defaultHidden: !primary && !f.list?.default,
      enum: f.enum,
      href: ref ? `${ref.route}/{${key}}` : undefined,
      primary,
      thumbnail: primary && !!def.image,
      moneyStyle: f.format === "compact" ? "compact" : undefined,
    });
  }
  // Title column first.
  return out.sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
}

// Facet chips: enum fields (options from the def), date/number/money ranges, and ref fields when
// the page passes their options (e.g. properties in scope).
export function facetsFor(def: EntityDef, role: Role, refOptions: Record<string, FacetOption[]> = {}): Facet[] {
  const out: Facet[] = [];
  for (const [key, f] of Object.entries(def.fields)) {
    if (!f.facet || f.hiddenFor?.includes(role)) continue;
    if (f.type === "enum") out.push({ key, label: f.label, kind: "enum", options: (f.enum ?? []).map((e) => ({ value: e.value, label: e.label, tone: e.tone })) });
    else if (f.type === "ref" && refOptions[key]) out.push({ key, label: f.label, kind: "ref", options: refOptions[key] });
    else if (f.type === "date" || f.type === "datetime") out.push({ key, label: f.label, kind: "date" });
    else if (f.type === "money") out.push({ key, label: f.label, kind: "money" });
    else if (f.type === "number") out.push({ key, label: f.label, kind: "number" });
  }
  return out;
}

export function statusTabsFor(def: EntityDef): StatusTabs | undefined {
  const field = def.list.statusTabs;
  const f = field ? def.fields[field] : undefined;
  if (!field || !f?.enum) return undefined;
  return { field, options: f.enum };
}

export function bulkActionsFor(def: EntityDef, role: Role): BulkAction[] {
  return (def.list.bulkActions ?? []).flatMap((key) => {
    const a = getAction(key);
    if (!a || !can(role, key, def.key)) return [];
    return [{ key, label: a.label, tone: a.confirm?.tone === "danger" ? "danger" as const : "default" as const, confirm: a.confirm ? `${a.confirm.title}${a.confirm.body ? `\n\n${a.confirm.body}` : ""}` : undefined }];
  });
}

export function tableSpec(def: EntityDef, role: Role, opts: { refOptions?: Record<string, FacetOption[]> } = {}) {
  return {
    entity: def.key,
    label: def.label,
    columns: columnsFor(def, role),
    facets: facetsFor(def, role, opts.refOptions),
    statusTabs: statusTabsFor(def),
    rowHref: `${def.route}/{id}`,
    bulkActions: bulkActionsFor(def, role),
    exportHref: `/api/e/${def.key}/export.csv`,
    views: (def.list.savedViews ?? []).map((v): SavedView => ({ ...v, builtIn: true })),
    searchPlaceholder: `Search ${def.label.many.toLowerCase()}…`,
  };
}
