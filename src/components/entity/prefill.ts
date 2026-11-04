import type { FormField } from "./spec";

// Starting values for a "New" form: each single-value list filter the form can hold
// (?f.property_id=p01 → Property), then the parent record's values on top.
export function prefill(fields: FormField[], params: URLSearchParams, parent?: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = parent?.[f.key] ?? params.get(`f.${f.key}`);
    if (!v || (!parent?.[f.key] && v.includes(","))) continue;
    if (f.type === "bool") { if (v === "true" || v === "false") out[f.key] = v === "true"; continue; }
    if (f.type === "enum" && !f.options?.some((o) => o.value === v)) continue;
    out[f.key] = v;
  }
  return out;
}
