import "server-only";
import { allEntities, can, getEntity } from "@/entities";
import { actionsFor, getAction } from "@/extensions/actions";
import { PERMISSIONS, type Persona } from "@/auth/personas";
import { ROLES, type Actor, type EntityKey, type ModuleKey, type Role } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { settleIfDue } from "./money";
import { effective } from "./query";

// Role × scope permissions. What a role may do comes from the defs (registry.can, which also
// requires module access in PERMISSIONS); which rows it sees comes from its scope, resolved here
// to a property id list that the query layer applies to every read.

export { can };

// Properties a persona's scope covers. "all" for platform/org scope.
export async function scopeProperties(db: Db, ws: string | null, persona: Persona): Promise<string[] | "all"> {
  const { scope } = persona;
  const ids = JSON.stringify(scope.ids ?? []);
  const props = effective("properties", ws);
  const q = async (sql: string, ...binds: unknown[]) => (await db.prepare(sql).bind(...binds).all<{ id: string }>()).results.map((r) => String(r.id));
  switch (scope.kind) {
    case "platform":
    case "org":
      return "all";
    case "property":
      return [...(scope.ids ?? [])];
    case "region":
      return q(`SELECT id FROM ${props} WHERE region_id IN (SELECT value FROM json_each(?)) ORDER BY id`, ids);
    case "portfolio":
      return q(`SELECT id FROM ${props} WHERE portfolio_id IN (SELECT value FROM json_each(?)) ORDER BY id`, ids);
    case "owner_entity":
      return q(`SELECT id FROM ${props} WHERE owner_entity_id IN (SELECT value FROM json_each(?)) ORDER BY id`, ids);
    case "self": {
      const rec = persona.record;
      if (!rec) return [];
      if (rec.entity === "owners") return q(`SELECT id FROM ${props} WHERE owner_entity_id IN (SELECT id FROM ${effective("owner_entities", ws)} WHERE owner_id = ?) ORDER BY id`, rec.id);
      if (rec.entity === "residents") return q(`SELECT property_id AS id FROM ${effective("residents", ws)} WHERE id = ?`, rec.id);
      // Vendors and applicants are matched row by row (vendor_id, applicant_id), not by property.
      return "all";
    }
  }
}

export async function actorFor(db: Db, ws: string | null, persona: Persona): Promise<Actor> {
  // Every page and API request resolves its actor here, so pending ACH transfers settle on read.
  await settleIfDue(db, ws, Date.now());
  return { personaId: persona.id, name: persona.name, role: persona.role, scope: persona.scope, propertyIds: await scopeProperties(db, ws, persona) };
}

// Same, for callers without a workspace (lane E's AI session): base data only.
export const resolveActor = (db: Db, persona: Persona, ws: string | null = null) => actorFor(db, ws, persona);

// Settings → Roles: one row per entity, one cell per role, generated from the defs.
export type MatrixCell = { read: boolean; create: boolean; update: boolean; delete: boolean; actions: string[] };
export type MatrixRow = { entity: EntityKey; label: string; module: ModuleKey; writes: string; cells: Record<Role, MatrixCell> };

export function permissionMatrix(roles: readonly Role[] = ROLES): MatrixRow[] {
  return allEntities()
    .sort((a, b) => a.module.localeCompare(b.module) || a.label.many.localeCompare(b.label.many))
    .map((def) => ({
      entity: def.key,
      label: def.label.many,
      module: def.module,
      writes: def.writes,
      cells: Object.fromEntries(roles.map((role) => [role, {
        read: can(role, "read", def.key),
        create: can(role, "create", def.key),
        update: can(role, "update", def.key),
        delete: can(role, "delete", def.key),
        actions: actionsFor(def.key).filter((a) => can(role, a.key, def.key)).map((a) => a.label),
      }])) as Record<Role, MatrixCell>,
    }));
}

export const moduleAccess = (role: Role) => PERMISSIONS[role];

// The named actions a role may run on a row (enabled by ActionDef.when).
export function actionsForRow(entity: EntityKey, role: Role, row: Record<string, unknown>) {
  const def = getEntity(entity);
  if (!def) return [];
  const keys = new Set([...(def.actions ?? []), ...actionsFor(entity).map((a) => a.key)]);
  return [...keys].map((k) => getAction(k)).filter((a) => !!a && can(role, a.key, entity) && (!a.when || a.when(row))).map((a) => a!);
}
