import { PERSONAS } from "@/auth/personas";
import type { Db } from "@/lib/platform/types";
import { effective, NO_WORKSPACE } from "./effective";

// Activity, audit and note rows store who acted as an id ("s-lucy", "grace", "res-p01-0001"); timelines show the
// person's name. Agents and system actors keep their id (the timeline labels those itself).
export async function withActorNames(db: Db, ws: string | null, rows: Record<string, unknown>[], idKey: string, nameKey: string): Promise<Record<string, unknown>[]> {
  const ids = [...new Set(rows.filter((r) => r.actor_kind !== "agent" && r.actor_kind !== "system").map((r) => r[idKey]).filter((v): v is string => typeof v === "string" && v !== ""))];
  if (!ids.length) return rows;
  const found = await db.prepare(`SELECT s.id, s.name FROM ${effective("staff")} AS s WHERE s.id IN (SELECT value FROM json_each(?2))
    UNION ALL SELECT r.id, r.first_name || ' ' || r.last_name FROM ${effective("residents")} AS r WHERE r.id IN (SELECT value FROM json_each(?2))`).bind(ws ?? NO_WORKSPACE, JSON.stringify(ids)).all<{ id: string; name: string }>();
  const names = new Map<string, string>(PERSONAS.map((p) => [p.id, p.name]));
  for (const s of found.results) names.set(s.id, s.name);
  return rows.map((r) => {
    const name = r.actor_kind === "agent" || r.actor_kind === "system" ? undefined : names.get(String(r[idKey]));
    return name ? { ...r, [nameKey]: name } : r;
  });
}
