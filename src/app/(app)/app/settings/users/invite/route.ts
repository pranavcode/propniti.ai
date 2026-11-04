import { z } from "zod";
import { INTERNAL_ROLES } from "@/entities/types";
import { ORG_ID, expandSql, rows } from "@/extensions/settings/data";
import { canEditSettings, canInvite } from "@/extensions/settings/nav";
import { audit, settingsPost, setupStep } from "@/extensions/settings/write";

const body = z.strictObject({
  name: z.string().trim().min(2).max(80),
  email: z.email().max(120),
  title: z.string().trim().min(2).max(80),
  role: z.enum(INTERNAL_ROLES.filter((r) => r !== "platform_admin") as [string, ...string[]]),
  scope_kind: z.enum(["org", "region", "property"]),
  scope_ids: z.array(z.string().regex(/^[a-z0-9-]{2,20}$/)).max(30).default([]),
});

// An invite is a staff row that can't sign in yet (active 0, never active) plus its role
// assignments. The email check is in the INSERT itself, so two clicks create one invite; the
// role rows only follow a staff row that exists. Accepting the invite is outside the demo.
// Admins and the principal add people. Only an admin grants the admin role, and a principal names
// only regions and properties that exist in the org and sit inside their own scope.
export const POST = settingsPost(body, async (ctx, b) => {
  if (b.scope_kind !== "org" && !b.scope_ids.length) return { error: "Pick at least one region or property" };
  if (!canEditSettings(ctx.actor.role)) {
    if (b.role === "admin") return { error: "Only an administrator can grant the administrator role", status: 403 };
    if (b.scope_kind !== "org") {
      const known = new Set((await rows<{ id: string }>(ctx, `SELECT id FROM {${b.scope_kind === "region" ? "regions" : "properties"}} WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(b.scope_ids)])).map((r) => r.id));
      const mine = ctx.actor.propertyIds;
      if (b.scope_ids.some((id) => !known.has(id) || (b.scope_kind === "property" && mine !== "all" && !mine.includes(id)))) return { error: "Pick regions or properties within your scope", status: 403 };
    }
  }
  const id = `s-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const scopes = b.scope_kind === "org" ? [ORG_ID] : b.scope_ids;
  const [created] = await ctx.db.batch([
    ctx.db.prepare(expandSql(ctx, "INSERT INTO staff (workspace_id, id, org_id, name, title, email, active, last_active_at) SELECT ?, ?, ?, ?, ?, ?, 0, NULL WHERE NOT EXISTS (SELECT 1 FROM {staff} s WHERE lower(s.email) = lower(?))"))
      .bind(ctx.ws, id, ORG_ID, b.name, b.title, b.email, b.email),
    ...scopes.map((s) => ctx.db.prepare("INSERT INTO role_assignments (workspace_id, id, staff_id, role, scope_kind, scope_id) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM staff WHERE workspace_id = ?1 AND id = ?3)").bind(ctx.ws, `ra-${id}-${s}`, id, b.role, b.scope_kind, s)),
  ]);
  if (!created.meta.changes) return { error: `${b.email} already has an account` };
  await ctx.db.batch([
    audit(ctx, "staff.invited", "staff", id, `Invited ${b.name} as ${b.role.replace(/_/g, " ")}`, null, { name: b.name, email: b.email, role: b.role, scope_kind: b.scope_kind, scope_ids: scopes }),
    setupStep(ctx, "team", "Done"),
  ]);
  return { id, href: `/app/settings/users/${id}`, message: `Invite sent to ${b.email}` };
}, { allow: canInvite, refused: "Only an administrator or the principal adds people" });
