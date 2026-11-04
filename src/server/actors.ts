import { PERSONAS } from "@/auth/personas";
import { can } from "@/entities";
import { effective, readWs, type QueryCtx } from "./query";

// Activity, audit and note rows store who acted as an id ("s-lucy", "grace", "res-p01-0001");
// timelines show the person's name. Agents and system actors keep their id (the timeline labels
// those itself). Residents are named only for roles that may read residents; vendors and owners
// see "Resident". Portal personas are left out: their names are residents', vendors' and owners'.
export async function withActorNames(ctx: QueryCtx, rows: Record<string, unknown>[], idKey: string, nameKey: string): Promise<Record<string, unknown>[]> {
  const auto = (r: Record<string, unknown>) => r.actor_kind === "agent" || r.actor_kind === "system";
  const ids = [...new Set(rows.filter((r) => !auto(r)).map((r) => r[idKey]).filter((v): v is string => typeof v === "string" && v !== ""))];
  if (!ids.length) return rows;
  const ws = await readWs(ctx);
  const residents = can(ctx.actor.role, "read", "residents");
  const found = await ctx.db.prepare(`SELECT s.id, s.name FROM ${effective("staff", ws)} AS s WHERE s.id IN (SELECT value FROM json_each(?1))${residents
    ? ` UNION ALL SELECT r.id, r.first_name || ' ' || r.last_name FROM ${effective("residents", ws)} AS r WHERE r.id IN (SELECT value FROM json_each(?1))`
    : ""}`).bind(JSON.stringify(ids)).all<{ id: string; name: string }>();
  const names = new Map<string, string>(PERSONAS.filter((p) => !p.portal).map((p) => [p.id, p.name]));
  for (const s of found.results) names.set(s.id, s.name);
  return rows.map((r) => {
    if (auto(r)) return r;
    const name = names.get(String(r[idKey])) ?? (r.actor_kind === "resident" && !residents ? "Resident" : undefined);
    return name ? { ...r, [nameKey]: name } : r;
  });
}
