import "server-only";
import type { Actor, Row } from "@/entities/types";
import { currentSession } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { effective, type QueryCtx } from "@/server/query";
import type { Photo } from "./Gallery";

// Shared reads for the portfolio detail tabs. The record page has already loaded the row through
// the scoped query layer; tabs re-check scope before reading anything keyed by the property id.

export async function tabCtx(actor: Actor): Promise<QueryCtx> {
  const s = await currentSession();
  return { db: getPlatform().db, ws: s.ws, actor };
}

export const inScope = (actor: Actor, propertyId: unknown) => actor.propertyIds === "all" || actor.propertyIds.includes(String(propertyId));

export const ACTIVE = "('Active', 'Notice', 'Month-to-month')";

export async function rows<T = Row>(ctx: QueryCtx, sql: string, ...binds: unknown[]): Promise<T[]> {
  const res = await ctx.db.prepare(sql.replace(/\{([a-z_][a-z0-9_]*)\}/g, (_, t: string) => effective(t, ctx.ws))).bind(...binds).all<T>();
  return res.results;
}

export async function one<T = Row>(ctx: QueryCtx, sql: string, ...binds: unknown[]): Promise<T | null> {
  return (await rows<T>(ctx, sql, ...binds))[0] ?? null;
}

export async function asOf(ctx: QueryCtx): Promise<string> {
  return (await ctx.db.prepare("SELECT value FROM meta WHERE key = 'as_of'").first<{ value: string }>())?.value ?? new Date().toISOString().slice(0, 10);
}

export const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function parseList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== "string") return [];
  try {
    const x = JSON.parse(v);
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
}

const CAPTION: [RegExp, string][] = [[/-alt\b/, "Exterior, second view"], [/-court/, "Courtyard"], [/-interior/, "Interior"], [/-aerial/, "Aerial"], [/living/, "Living room"], [/kitchen/, "Kitchen"], [/bedroom/, "Bedroom"], [/bath/, "Bathroom"]];

// Only same-site image paths are rendered.
export function photosOf(paths: string[], first = "Exterior"): Photo[] {
  return paths.filter((p) => /^\/img\/[\w/.-]+\.webp$/.test(p)).map((src, i) => ({
    src: src.replace(/-400\.webp$/, ".webp"),
    thumb: src.endsWith("-400.webp") ? src : src.replace(/\.webp$/, "-400.webp"),
    caption: CAPTION.find(([re]) => re.test(src))?.[1] ?? (i === 0 ? first : `Photo ${i + 1}`),
  }));
}
