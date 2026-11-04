import "server-only";
import type { ZodType } from "zod";
import { can, getEntity, type EntityDef, type FieldDef, type Role, type Row } from "@/entities";
import { actionsFor, getAction } from "@/extensions/actions";
import type { BulkAction, ColumnKind, DataColumn, Facet, StatusTabs } from "@/components/app/data-table/types";
import { editable, type FacetOptions } from "@/server/query";

// EntityDef → the plain data the client components need (DataTable columns and facets, form
// fields, fact labels). Defs hold functions and icons, so they never cross to the client.

const visible = (def: EntityDef, role: Role) => Object.entries(def.fields).filter(([, f]) => !f.hiddenFor?.includes(role)) as [string, FieldDef][];

export const refHref = (f: FieldDef, key: string) => {
  const ref = f.ref && getEntity(f.ref);
  return ref ? `${ref.route}/{${key}}` : undefined;
};

export function columnKind(key: string, f: FieldDef): ColumnKind {
  if (key === "open_issues") return "health";
  switch (f.type) {
    case "money": return "money";
    case "number": return f.format === "pct" ? "pct" : "number";
    case "date": return f.format === "relative" ? "relative" : "date";
    case "datetime": return f.format === "relative" ? "relative" : "datetime";
    case "enum": return "enum";
    case "ref": return "ref";
    case "bool": return "bool";
    case "image": return "image";
    case "json": return "json";
    default: return "text";
  }
}

export function tableColumns(def: EntityDef, role: Role, omit: string[] = []): DataColumn[] {
  const cols: DataColumn[] = [];
  for (const [key, f] of visible(def, role)) {
    if (omit.includes(key) || f.type === "image" || (f.type === "json" && !f.list)) continue;
    const primary = key === def.titleField;
    cols.push({
      key,
      label: f.label,
      kind: columnKind(key, f),
      align: f.list?.align,
      width: f.list?.width,
      sortable: f.sortable !== false && f.type !== "json",
      defaultHidden: !primary && !f.list?.default,
      enum: f.enum,
      href: f.type === "ref" ? refHref(f, key) : undefined,
      primary,
      thumbnail: primary && !!def.image,
      moneyStyle: f.type === "money" && f.format === "compact" ? "compact" : undefined,
    });
  }
  // The title column leads.
  return cols.sort((a, b) => Number(!!b.primary) - Number(!!a.primary));
}

export function tableFacets(def: EntityDef, role: Role, options: FacetOptions): Facet[] {
  const out: Facet[] = [];
  for (const [key, f] of visible(def, role)) {
    if (!f.facet || key === def.list.statusTabs) continue;
    if (f.type === "date" || f.type === "datetime") out.push({ key, label: f.label, kind: "date" });
    else if (f.type === "number" || f.type === "money") out.push({ key, label: f.label, kind: f.type === "money" ? "money" : "number" });
    else if (options[key]) out.push({ key, label: f.label, kind: f.type === "ref" ? "ref" : "enum", options: options[key].map((o) => ({ value: o.value, label: o.label, count: o.count, tone: f.enum?.find((e) => e.value === o.value)?.tone })) });
  }
  return out;
}

export function statusTabs(def: EntityDef, role: Role): StatusTabs | undefined {
  const key = def.list.statusTabs;
  const f = key ? def.fields[key] : undefined;
  if (!key || !f || f.hiddenFor?.includes(role)) return undefined;
  return { field: key, options: f.enum ?? [], allLabel: `All ${def.label.many.toLowerCase()}` };
}

// Form fields for the new/edit sheet: only stored fields the role may set.
export type FormField = {
  key: string;
  label: string;
  type: FieldDef["type"];
  required?: boolean;
  options?: { value: string; label: string }[];
  refEntity?: string;
  refRoute?: string;
  help?: string;
  format?: FieldDef["format"];
};

export function formFields(def: EntityDef, role: Role, mode: "create" | "update"): FormField[] {
  const out: FormField[] = [];
  for (const [key, f] of visible(def, role)) {
    if (f.type === "json" || !editable(role, key, f, mode)) continue;
    const ref = f.ref ? getEntity(f.ref) : undefined;
    out.push({
      key,
      label: f.label,
      type: f.type,
      required: mode === "create" && f.required,
      options: (f.system ? f.enum?.filter((e) => f.initial?.includes(e.value)) : f.enum)?.map((e) => ({ value: e.value, label: e.label ?? e.value })),
      refEntity: ref?.key,
      refRoute: ref?.route,
      help: f.help?.summary,
      format: f.format,
    });
  }
  // Required fields first, then the def's order.
  return out.sort((a, b) => Number(!!b.required) - Number(!!a.required));
}

// Bulk buttons for a list: the def's list.bulkActions plus any action on the entity marked
// `bulk` that runs in one click (no input to fill, no money moved), labelled from the action.
export function bulkActions(def: EntityDef, role: Role): BulkAction[] {
  const oneClick = actionsFor(def.key).filter((a) => a.bulk && !a.money && (!a.input || (a.input as ZodType).safeParse({}).success)).map((a) => a.key);
  return [...new Set([...(def.list.bulkActions ?? []), ...oneClick])].flatMap((k) => {
    const a = getAction(k);
    if (!a || !can(role, k, def.key)) return [];
    return [{ key: k, label: a.label, tone: a.confirm?.tone === "danger" ? "danger" as const : "default" as const, confirm: a.confirm ? a.confirm.body ?? a.confirm.title : undefined }];
  });
}

// Starting values for a record created from a parent's tab (a work order from a unit): the link
// to the parent, plus each reference the parent holds to the same entity (the unit's property).
export function parentValues(parent: EntityDef, row: Row, child: EntityDef, fk: string, value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, f] of Object.entries(child.fields)) {
    if (f.type !== "ref") continue;
    const pf = parent.fields[key];
    if (pf?.type === "ref" && pf.ref === f.ref && row[key] != null) out[key] = String(row[key]);
  }
  if (value != null) out[fk] = String(value);
  return out;
}
