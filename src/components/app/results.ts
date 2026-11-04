import type { Facet, StatusTabs } from "./data-table/types";

// The line above a filtered list that says what the filter did ("Showing 64 open issues in
// Accounting"). Counts come from data the page already loaded.

export type Noun = { one: string; many: string };

export function resultsSummary(count: number, noun: Noun, scope?: string) {
  const where = scope ? ` ${scope}` : "";
  return count === 0 ? `No ${noun.many}${where}` : `Showing ${count.toLocaleString("en-US")} ${count === 1 ? noun.one : noun.many}${where}`;
}

// "matching Status: Active, Property: Preston Hollow +1, “oak”" from a list's URL filters.
export function listScope(params: URLSearchParams, facets: Facet[], tabs?: StatusTabs) {
  const parts: string[] = [];
  const all: Facet[] = tabs && !facets.some((f) => f.key === tabs.field) ? [{ key: tabs.field, label: "Status", kind: "enum", options: tabs.options }, ...facets] : facets;
  for (const f of all) {
    if (f.kind === "enum" || f.kind === "ref") {
      const values = (params.get(`f.${f.key}`) ?? "").split(",").filter(Boolean);
      if (!values.length) continue;
      const first = f.options.find((o) => o.value === values[0])?.label ?? values[0];
      parts.push(`${f.label}: ${first}${values.length > 1 ? ` +${values.length - 1}` : ""}`);
    } else {
      const min = params.get(`f.${f.key}.min`), max = params.get(`f.${f.key}.max`);
      if (min && max) parts.push(`${f.label} ${min}–${max}`);
      else if (min) parts.push(`${f.label} from ${min}`);
      else if (max) parts.push(`${f.label} up to ${max}`);
    }
  }
  const q = params.get("q");
  if (q) parts.push(`“${q}”`);
  return parts.length ? `matching ${parts.join(", ")}` : undefined;
}
