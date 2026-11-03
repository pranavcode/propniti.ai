import { z } from "zod";
import { INTERNAL_ROLES } from "@/entities/types";
import { ORG_ID, one } from "@/extensions/settings/data";
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
// assignments. Accepting the invite is outside the demo.
export const POST = settingsPost(body, async (ctx, b) => {
  if (b.scope_kind !== "org" && !b.scope_ids.length) return { error: "Pick at least one region or property" };
  if (await one(ctx, "SELECT 1 FROM {staff} WHERE lower(email) = lower(?)", [b.email])) return { error: `${b.email} already has an account` };
  const id = `s-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const scopes = b.scope_kind === "org" ? [ORG_ID] : b.scope_ids;
  await ctx.db.batch([
    ctx.db.prepare("INSERT INTO staff (workspace_id, id, org_id, name, title, email, active, last_active_at) VALUES (?, ?, ?, ?, ?, ?, 0, NULL)").bind(ctx.ws, id, ORG_ID, b.name, b.title, b.email),
    ...scopes.map((s) => ctx.db.prepare("INSERT INTO role_assignments (workspace_id, id, staff_id, role, scope_kind, scope_id) VALUES (?, ?, ?, ?, ?, ?)").bind(ctx.ws, `ra-${id}-${s}`, id, b.role, b.scope_kind, s)),
    audit(ctx, "staff.invited", "staff", id, `Invited ${b.name} as ${b.role.replace(/_/g, " ")}`, null, { name: b.name, email: b.email, role: b.role, scope_kind: b.scope_kind, scope_ids: scopes }),
    setupStep(ctx, "team", "Done"),
  ]);
  return { id, href: `/app/settings/users/${id}`, message: `Invite sent to ${b.email}` };
}, { adminOnly: true });
