import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type ListQuery } from "@/entities/types";

// URL ↔ list query. One format shared by the DataTable (client) and list pages / the list API
// (server), so links like /app/units?f.status=Vacant work everywhere.
//
//   q=<text>                      search
//   f.<field>=a,b                 enum / ref: any of the values (commas inside values are %2C-safe: use |)
//   f.<field>=2026-01-01..2026-03-31   date or number range; either side may be empty ("..500")
//   sort=<field> | sort=-<field>  ascending / descending
//   page=<n>&size=<25|50|100>     1-based page
//   view=<key>                    saved view; tab=<key> on record pages

export const PAGE_SIZES = [25, 50, 100] as const;
const SEP = "|";

export type Range = { min?: string; max?: string };

export function parseList(sp: URLSearchParams | Record<string, string | string[] | undefined>): ListQuery & { view?: string } {
  const get = (k: string) => {
    if (sp instanceof URLSearchParams) return sp.get(k) ?? undefined;
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const keys = sp instanceof URLSearchParams ? [...sp.keys()] : Object.keys(sp);
  const filters: Record<string, string | string[]> = {};
  for (const k of keys) {
    if (!k.startsWith("f.")) continue;
    const raw = get(k);
    if (!raw) continue;
    filters[k.slice(2)] = raw.includes("..") ? raw : raw.split(SEP);
  }
  const sortRaw = get("sort");
  const page = Math.max(1, parseInt(get("page") ?? "1", 10) || 1);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(get("size") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  return {
    q: get("q") || undefined,
    filters: Object.keys(filters).length ? filters : undefined,
    sort: sortRaw ? (sortRaw.startsWith("-") ? [sortRaw.slice(1), "desc"] : [sortRaw, "asc"]) : undefined,
    page,
    size,
    view: get("view") || undefined,
  };
}

export const encodeValues = (values: string[]) => values.join(SEP);
export const encodeRange = (r: Range) => (r.min || r.max ? `${r.min ?? ""}..${r.max ?? ""}` : "");
export function decodeRange(v: string | string[] | undefined): Range {
  if (typeof v !== "string" || !v.includes("..")) return {};
  const [min, max] = v.split("..");
  return { min: min || undefined, max: max || undefined };
}
export const encodeSort = (sort?: [string, "asc" | "desc"]) => (sort ? (sort[1] === "desc" ? `-${sort[0]}` : sort[0]) : "");

// Inverse of parseList for saved views and links.
export function toSearchParams(q: ListQuery & { view?: string }): URLSearchParams {
  const sp = new URLSearchParams();
  if (q.q) sp.set("q", q.q);
  for (const [k, v] of Object.entries(q.filters ?? {})) {
    const s = Array.isArray(v) ? encodeValues(v) : v;
    if (s) sp.set(`f.${k}`, s);
  }
  if (q.sort) sp.set("sort", encodeSort(q.sort));
  if (q.page && q.page > 1) sp.set("page", String(q.page));
  if (q.size && q.size !== DEFAULT_PAGE_SIZE) sp.set("size", String(q.size));
  if (q.view) sp.set("view", q.view);
  return sp;
}

// "/app/properties/{id}" + row → "/app/properties/p01". Unknown fields become empty.
export function fillTemplate(tpl: string, row: Record<string, unknown>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(row[k] ?? "")));
}
