import "server-only";
import { can, type EntityDef, type Role } from "@/entities";
import type { FieldSpec } from "./types";

// EntityDef fields → plain FieldSpec[] for forms and inline edit. Computed (sql) fields and fields
// hidden from the role are left out. A field is editable when the role may update the entity and
// either the field lists the role in `editable` or (no list) the entity's update roles include it.
export function fieldSpecs(def: EntityDef, role: Role, opts: { refOptions?: Record<string, { value: string; label: string }[]>; mode?: "create" | "update" } = {}): FieldSpec[] {
  const mayWrite = can(role, opts.mode === "create" ? "create" : "update", def.key);
  const out: FieldSpec[] = [];
  for (const [key, f] of Object.entries(def.fields)) {
    if (f.sql || f.hiddenFor?.includes(role)) continue;
    out.push({
      key,
      label: f.label,
      type: f.type,
      enum: f.enum,
      options: f.type === "ref" ? opts.refOptions?.[key] : undefined,
      required: f.required,
      editable: mayWrite && (f.editable ? f.editable.includes(role) : (def.permissions.update ?? []).includes(role) || opts.mode === "create"),
      format: f.format,
      help: f.help?.summary,
    });
  }
  return out;
}
