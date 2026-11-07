import "server-only";
import { demoNowIso } from "@/lib/clock";
import { z } from "zod";
import { handle, json, writeCtx } from "@/app/api/e/_lib/http";
import type { Role } from "@/entities/types";
import type { WriteCtx } from "@/server/query";
import { orgId, one, parseJson } from "./data";
import { canEditSettings } from "./nav";

// Writes for settings that have no entity of their own (company profile, integrations,
// notification preferences, setup steps). They go through the same guarded path as the generic
// API (same-origin, rate limit, body cap, visitor workspace) and copy-on-write into the overlay.

export function audit(ctx: WriteCtx, action: string, entityType: string, entityId: string, detail: string, before: unknown, after: unknown) {
  return ctx.db.prepare("INSERT INTO audit (workspace_id, id, at, actor, actor_id, role, action, entity_type, entity_id, detail, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(ctx.ws, crypto.randomUUID(), demoNowIso(ctx.nowMs), ctx.actor.name, ctx.actor.personaId, ctx.actor.role, action, entityType, entityId, detail, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after));
}

// Merges `patch` into user_preferences.data[key] for `id` (a persona id, or the org id).
export async function mergePrefs(ctx: WriteCtx, id: string, key: string, patch: Record<string, unknown>, detail: string) {
  const cur = await one<{ density: string; theme: string; tables: string; data: string }>(ctx, "SELECT density, theme, tables, data FROM {user_preferences} WHERE id = ?", [id]);
  const data = parseJson<Record<string, unknown>>(cur?.data, {});
  const before = (data[key] ?? {}) as Record<string, unknown>;
  const after = { ...before, ...patch };
  data[key] = after;
  const changed = Object.keys(patch).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(patch[k]));
  await ctx.db.batch([
    ctx.db.prepare("INSERT INTO user_preferences (workspace_id, id, density, theme, tables, data) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (workspace_id, id) DO UPDATE SET data = excluded.data, deleted = 0")
      .bind(ctx.ws, id, cur?.density ?? "Comfortable", cur?.theme ?? "light", cur?.tables ?? "{}", JSON.stringify(data)),
    audit(ctx, `settings.${key}`, "user_preferences", id, detail, Object.fromEntries(changed.map((k) => [k, before[k] ?? null])), Object.fromEntries(changed.map((k) => [k, patch[k]]))),
  ]);
  return after;
}

export function setupStep(ctx: WriteCtx, step: string, status: "Done" | "Todo" | "Skipped") {
  return ctx.db.prepare("INSERT INTO onboarding_progress (workspace_id, id, subject_kind, subject_id, step, status, done_at) VALUES (?, ?, 'org', ?, ?, ?, ?) ON CONFLICT (workspace_id, id) DO UPDATE SET status = excluded.status, done_at = excluded.done_at, deleted = 0")
    .bind(ctx.ws, `onb-${step}`, orgId(ctx), step, status, status === "Done" ? demoNowIso(ctx.nowMs) : null);
}

// POST handler wrapper: guarded write, a role check (admins only, or `allow`), JSON result. A
// result with `error` is refused with its `status`, or 409.
export function settingsPost<S extends z.ZodType>(schema: S, run: (ctx: WriteCtx, body: z.infer<S>) => Promise<Record<string, unknown>>, opts: { adminOnly: boolean } | { allow: (role: Role) => boolean; refused: string }) {
  return (request: Request) => handle(async () => {
    const w = await writeCtx(request, schema);
    if (w instanceof Response) return w;
    const role = w.ctx.actor.role;
    if ("allow" in opts ? !opts.allow(role) : opts.adminOnly && !canEditSettings(role)) return json({ error: "allow" in opts ? opts.refused : "Only admins change org settings" }, 403, w.setCookie);
    if (w.ctx.actor.scope.kind === "self") return json({ error: "Portal users manage settings in their portal" }, 403, w.setCookie);
    const { status, ...out } = await run(w.ctx, w.body);
    return json(out, "error" in out ? (typeof status === "number" ? status : 409) : 200, w.setCookie);
  });
}
