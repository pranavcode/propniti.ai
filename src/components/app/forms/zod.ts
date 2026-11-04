import { z } from "zod";
import type { FieldSpec } from "./types";

// Client-side validation from a FieldSpec. The server validates again from the EntityDef.
export function zodFor(spec: FieldSpec): z.ZodType {
  const req = `${spec.label} is required`;
  switch (spec.type) {
    case "number":
    case "money": {
      const n = z.number({ error: `${spec.label} must be a number` }).refine(Number.isFinite, `${spec.label} must be a number`);
      return spec.required ? n : n.nullable();
    }
    case "date": {
      const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${spec.label} must be a date`);
      return spec.required ? d : d.nullable().or(z.literal("").transform(() => null));
    }
    case "datetime": {
      const d = z.string().min(1, req);
      return spec.required ? d : d.nullable().or(z.literal("").transform(() => null));
    }
    case "enum": {
      const values = (spec.enum ?? []).map((e) => e.value);
      const e = values.length ? z.enum(values as [string, ...string[]], { error: `Choose a ${spec.label.toLowerCase()}` }) : z.string();
      return spec.required ? e : e.nullable().or(z.literal("").transform(() => null));
    }
    case "bool":
      return spec.required ? z.boolean() : z.boolean().nullable();
    case "ref": {
      const r = z.string().min(1, req).max(80);
      return spec.required ? r : r.nullable().or(z.literal("").transform(() => null));
    }
    case "image":
    case "json":
      return z.unknown();
    default: {
      const t = z.string().trim().max(4000, `${spec.label} is too long`);
      return spec.required ? t.min(1, req) : t.nullable();
    }
  }
}

export function schemaFor(specs: FieldSpec[]) {
  return z.object(Object.fromEntries(specs.map((s) => [s.key, zodFor(s)])));
}

// Empty values per type, for create forms.
export function emptyValue(spec: FieldSpec): unknown {
  if (spec.type === "bool") return spec.required ? false : null;
  if (spec.type === "number" || spec.type === "money") return null;
  if (spec.type === "text") return "";
  return null;
}
