import type { LucideIcon } from "lucide-react";
import { getAction } from "@/extensions/actions";
import { PERMISSIONS } from "@/auth/personas";
import { NAV_SECTIONS, type ActionKey, type EntityDef, type EntityKey, type NavSection, type Role } from "./types";

// Entity registry. Defs register themselves at import (src/entities/defs/<module>.ts) and
// src/entities/index.ts imports every defs file, so import from "@/entities" when you need the
// registered set. Re-registering a key replaces it (dev hot reload).

const entities = new Map<EntityKey, EntityDef>();

export function registerEntity(def: EntityDef) {
  entities.set(def.key, def);
  return def;
}

export const getEntity = (key: string) => entities.get(key as EntityKey);
export const allEntities = () => [...entities.values()];

// Resolves an /app path to a list or detail page: "/app/leasing/prospects" → list,
// "/app/leasing/prospects/pr_123" → detail. Longest route wins.
export function getEntityByRoute(pathname: string): { def: EntityDef; id?: string } | undefined {
  const path = pathname.replace(/\/+$/, "");
  let best: { def: EntityDef; id?: string } | undefined;
  for (const def of entities.values()) {
    if (path === def.route) return { def };
    if (path.startsWith(def.route + "/") && (!best || def.route.length > best.def.route.length)) {
      const rest = path.slice(def.route.length + 1);
      if (!rest.includes("/")) best = { def, id: decodeURIComponent(rest) };
    }
  }
  return best;
}

// Custom pages that are not entity lists (Dashboard, Inbox, Copilot, Reports, Settings…) join
// the sidebar through here.
export type NavPage = { key: string; label: string; href: string; icon: LucideIcon; section: NavSection; group?: string; order: number; roles: Role[]; ai?: boolean };
const pages = new Map<string, NavPage>();
export const registerPage = (page: NavPage) => (pages.set(page.key, page), page);

export type NavItem = { key: string; label: string; href: string; icon: LucideIcon; group?: string; order: number; ai?: boolean };
export type NavGroup = { section: NavSection; items: NavItem[] };

// Sidebar for a role: entities it can read plus pages it may open, grouped by section in order.
export function navTree(role: Role): NavGroup[] {
  const items: (NavItem & { section: NavSection })[] = [];
  for (const def of entities.values()) {
    if (!def.nav || !can(role, "read", def.key)) continue;
    items.push({ key: def.key, label: def.nav.label ?? def.label.many, href: def.route, icon: def.icon, section: def.nav.section, group: def.nav.group, order: def.nav.order });
  }
  for (const p of pages.values()) if (p.roles.includes(role)) items.push(p);
  return NAV_SECTIONS.map((section) => ({ section, items: items.filter((i) => i.section === section).sort((a, b) => a.order - b.order) })).filter((g) => g.items.length);
}

// The def's permissions decide; a module the role has no access to (PERMISSIONS) always denies.
// Named actions are gated by their own explicit roles (module read access is enough), so a
// cross-module action such as an accountant's vendor bank change works. Scope is applied by the query layer.
export function can(role: Role, action: "read" | "create" | "update" | "delete" | ActionKey, entity: EntityKey): boolean {
  const def = entities.get(entity);
  if (!def) return false;
  const access = PERMISSIONS[role][def.module] ?? "none";
  if (access === "none") return false;
  if (action === "read") return def.permissions.read.includes(role);
  if (action === "create" || action === "update" || action === "delete") {
    return access !== "read" && def.writes === "generic" && (def.permissions[action] ?? []).includes(role);
  }
  const a = getAction(action);
  return !!a && a.entity === entity && a.roles.includes(role);
}
