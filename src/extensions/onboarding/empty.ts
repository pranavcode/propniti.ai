import "server-only";
import type { QueryCtx } from "@/server/query";
import { rows } from "@/extensions/settings/data";
import { loadState } from "./server";
import { STEPS } from "./state";

// Whether there is anything to show yet: "empty" when the org has no properties (a new company
// before its first import, such as Lakeside), "unassigned" when the org has some but none are in
// this person's scope (a property manager not yet invited to any). Portal personas never get here.
export type CompanyState = "empty" | "unassigned" | null;

export async function companyState(ctx: QueryCtx): Promise<CompanyState> {
  const ids = ctx.actor.propertyIds;
  const any = async (where = "", params: unknown[] = []) => Number((await rows<{ n: number }>(ctx, `SELECT count(*) AS n FROM (SELECT 1 FROM {properties}${where} LIMIT 1)`, params))[0]?.n) > 0;
  // Scope ids can outlive their properties (an invite to properties whose import was undone).
  if (ids !== "all" && ids.length && (await any(" WHERE id IN (SELECT value FROM json_each(?))", [JSON.stringify(ids)]))) return null;
  if (!(await any())) return "empty";
  return ids === "all" ? null : "unassigned";
}

// Guided setup is finished once every step is done or skipped.
export async function setupFinished(ctx: QueryCtx): Promise<boolean> {
  const s = await loadState(ctx);
  return STEPS.every((step) => s.done.includes(step.key) || s.skipped.includes(step.key));
}
