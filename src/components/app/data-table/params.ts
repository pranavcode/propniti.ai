// List URL format, the same one the list API parses (parseListQuery in src/server/query.ts), so
// a page URL like /app/units?f.status=Vacant,Down&sort=-rent works for the page and the API:
//
//   q=<text>                         search
//   f.<field>=a,b                    enum / ref: any of the values
//   f.<field>.min=…&f.<field>.max=…  date or number range (either side optional)
//   sort=<field> | sort=-<field>     ascending / descending
//   page=<n>&size=<25|50|100>        1-based page
//   cols=a,b,c                       visible columns; view=<key> saved view

export const PAGE_SIZES = [25, 50, 100] as const;

export type Range = { min?: string; max?: string };

export const readValues = (sp: URLSearchParams, field: string) => (sp.get(`f.${field}`) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
export const readRange = (sp: URLSearchParams, field: string): Range => ({ min: sp.get(`f.${field}.min`) || undefined, max: sp.get(`f.${field}.max`) || undefined });
export function readSort(sp: URLSearchParams): [string, "asc" | "desc"] | undefined {
  const s = sp.get("sort");
  return s ? (s.startsWith("-") ? [s.slice(1), "desc"] : [s, "asc"]) : undefined;
}
export const encodeSort = (sort?: [string, "asc" | "desc"]) => (sort ? (sort[1] === "desc" ? `-${sort[0]}` : sort[0]) : "");

// Every f.* key currently set (for "Clear filters" and chips).
export const filterKeys = (sp: URLSearchParams) => [...sp.keys()].filter((k) => k.startsWith("f."));

// View state (saved_views.state) → URL params, replacing q/filters/sort/cols.
export function viewToParams(current: URLSearchParams, state: { q?: string; filters?: Record<string, string | string[]>; sort?: [string, "asc" | "desc"]; columns?: string[] }, viewKey?: string) {
  const sp = new URLSearchParams();
  for (const [k, v] of current) if (!["q", "sort", "page", "cols", "view"].includes(k) && !k.startsWith("f.")) sp.set(k, v);
  if (state.q) sp.set("q", state.q);
  for (const [k, v] of Object.entries(state.filters ?? {})) {
    const s = Array.isArray(v) ? v.join(",") : v;
    if (s) sp.set(`f.${k}`, s);
  }
  if (state.sort) sp.set("sort", encodeSort(state.sort));
  if (state.columns?.length) sp.set("cols", state.columns.join(","));
  if (viewKey) sp.set("view", viewKey);
  return sp;
}

// URL params → view state, for "Save view".
export function paramsToView(sp: URLSearchParams) {
  const filters: Record<string, string | string[]> = {};
  for (const k of filterKeys(sp)) {
    const v = sp.get(k)!;
    const key = k.slice(2);
    filters[key] = key.endsWith(".min") || key.endsWith(".max") || !v.includes(",") ? v : v.split(",");
  }
  const cols = sp.get("cols");
  return { q: sp.get("q") || undefined, filters: Object.keys(filters).length ? filters : undefined, sort: readSort(sp), columns: cols ? cols.split(",") : undefined };
}

// "/app/properties/{id}" + row → "/app/properties/p01". Unknown fields become empty.
export function fillTemplate(tpl: string, row: Record<string, unknown>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(row[k] ?? "")));
}
