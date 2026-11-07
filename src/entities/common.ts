import type { EntityKey, FieldDef, Role } from "./types";

// Shared building blocks for entity defs. Import from "@/entities/common" in defs files.

// The demo's "today" in SQL (meta.as_of from the generator), for derived statuses and ages.
export const AS_OF = "coalesce((SELECT value FROM meta WHERE key = 'as_of'), date('now'))";

// Role groups used by most defs.
export const LEADERS: Role[] = ["principal", "regional_manager"];
export const OPS: Role[] = ["principal", "regional_manager", "property_manager"];
export const STAFF: Role[] = ["platform_admin", "principal", "regional_manager", "property_manager", "leasing_agent", "broker", "accountant", "maintenance_supervisor", "admin"];
export const FINANCE: Role[] = ["principal", "regional_manager", "property_manager", "accountant"];

// Open data-health issues on the record: a list flag and the record page's "Data health" badge.
export const issuesField = (entity: EntityKey, table: string = entity): FieldDef => ({
  type: "number",
  label: "Data issues",
  sql: `(SELECT count(*) FROM {data_issues} di WHERE di.entity_type = '${entity}' AND di.entity_id = ${table}.id AND di.status = 'open')`,
  facet: false,
  help: { summary: "Open data-health issues on this record. Open the record to see the suggested fix.", article: "data-health" },
});

// Property photos: the generator stores full-size paths; tables load the 400px variant.
export function thumb(path: unknown): string | undefined {
  if (typeof path !== "string" || !path) return undefined;
  return path.endsWith("-400.webp") ? path : path.replace(/\.webp$/, "-400.webp");
}
// Only the seeded properties (p01–p30) have a photo on disk; an imported one has none until added.
export const propertyPhoto = (id: unknown, photos: unknown) => thumb(Array.isArray(photos) && photos[0] ? photos[0] : /^p\d{2}$/.test(String(id)) ? `/img/props/${String(id)}.webp` : undefined);
