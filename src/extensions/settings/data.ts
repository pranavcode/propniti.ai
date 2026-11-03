import "server-only";
import { AS_OF as AS_OF_SQL } from "@/entities/common";
import { effective, type QueryCtx } from "@/server/query";

// Small read helpers for the settings pages. Tables are named as {table} and expand to the
// visitor's effective rows (overlay over base).

export const ORG_ID = "org-summit";

export function expandSql(ctx: QueryCtx, sql: string) {
  return sql.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, t: string) => effective(t, ctx.ws)).replace(/\$AS_OF/g, AS_OF_SQL);
}

export async function rows<T = Record<string, unknown>>(ctx: QueryCtx, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await ctx.db.prepare(expandSql(ctx, sql)).bind(...params).all<T>()).results;
}

export async function one<T = Record<string, unknown>>(ctx: QueryCtx, sql: string, params: unknown[] = []): Promise<T | null> {
  return ctx.db.prepare(expandSql(ctx, sql)).bind(...params).first<T>();
}

export async function count(ctx: QueryCtx, sql: string, params: unknown[] = []): Promise<number> {
  return Number((await one<{ n: number }>(ctx, sql, params))?.n ?? 0);
}

export const parseJson = <T,>(v: unknown, fallback: T): T => {
  if (typeof v !== "string") return (v as T) ?? fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

// Org-level settings without their own table (company profile, integrations) live in
// user_preferences.data under the org id; personal ones under the persona id.
export async function prefsData(ctx: QueryCtx, id: string): Promise<Record<string, unknown>> {
  const r = await one<{ data: string }>(ctx, "SELECT data FROM {user_preferences} WHERE id = ?", [id]);
  return parseJson<Record<string, unknown>>(r?.data, {});
}

export async function asOf(ctx: QueryCtx): Promise<string> {
  return (await one<{ d: string }>(ctx, "SELECT $AS_OF AS d"))?.d ?? new Date().toISOString().slice(0, 10);
}
