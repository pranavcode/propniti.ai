import "server-only";
import { AS_OF } from "@/entities/common";
import type { Actor } from "@/entities/types";
import type { Db } from "@/lib/platform/types";
import { demoNowIso } from "@/lib/clock";
import { effective } from "@/server/query";
import { COI_STATUS_SQL, COMPLIANCE_STATUS_SQL, POLICY_STATUS_SQL } from "./sql";

// Everything that lapses in the next `days` days, plus anything already lapsed and unresolved,
// across vendor certificates, insurance policies and compliance items. Bounded per kind. A missing
// certificate is always lapsed, whatever date it carries.

export type ExpiryKind = "coi" | "policy" | "item";
export type Expiry = { kind: ExpiryKind; id: string; title: string; where: string | null; date: string; status: string; href: string };
export const LAPSED = ["Expired", "Overdue", "Missing"];

const LIMIT = 150;

export async function expiries(ctx: { db: Db; ws: string | null; actor: Actor }, days = 90): Promise<{ today: string; rows: Expiry[] }> {
  const ws = ctx.ws;
  const ids = ctx.actor.propertyIds;
  const scope = (col: string) => (ids === "all" ? { sql: "", binds: [] as unknown[] } : { sql: ` AND ${col} IN (SELECT value FROM json_each(?))`, binds: [JSON.stringify(ids)] });
  const end = `date(${AS_OF}, '+${Math.max(1, Math.min(365, Math.floor(days)))} days')`;
  const p = scope("t.property_id");
  const c = scope("t.property_id");
  const [today, coi, pol, item] = await Promise.all([
    ctx.db.prepare(`SELECT ${AS_OF} AS d`).first<{ d: string }>(),
    ctx.db.prepare(`WITH e AS ${effective("vendor_cois", ws)}
      SELECT vendor_cois.id, coalesce(v.company, vendor_cois.vendor_id) AS title, vendor_cois.carrier AS place, vendor_cois.expires_on AS date, ${COI_STATUS_SQL} AS status
      FROM e AS vendor_cois LEFT JOIN ${effective("vendors", ws)} v ON v.id = vendor_cois.vendor_id
      WHERE vendor_cois.expires_on = (SELECT max(x.expires_on) FROM e x WHERE x.vendor_id = vendor_cois.vendor_id) AND (vendor_cois.expires_on <= ${end} OR vendor_cois.status = 'Missing')
      ORDER BY vendor_cois.expires_on LIMIT ${LIMIT}`).all<Record<string, string>>(),
    ctx.db.prepare(`SELECT t.id, t.kind || ' · ' || t.carrier AS title, pr.name AS place, t.expires_on AS date, ${POLICY_STATUS_SQL.replace(/insurance_policies\./g, "t.")} AS status
      FROM ${effective("insurance_policies", ws)} t LEFT JOIN ${effective("properties", ws)} pr ON pr.id = t.property_id
      WHERE t.expires_on <= ${end}${p.sql} ORDER BY t.expires_on LIMIT ${LIMIT}`).bind(...p.binds).all<Record<string, string>>(),
    ctx.db.prepare(`SELECT t.id, t.title, coalesce(pr.name, 'Org-wide') AS place, t.due_on AS date, ${COMPLIANCE_STATUS_SQL.replace(/compliance_items\./g, "t.")} AS status
      FROM ${effective("compliance_items", ws)} t LEFT JOIN ${effective("properties", ws)} pr ON pr.id = t.property_id
      WHERE t.completed_on IS NULL AND t.status <> 'Done' AND t.due_on <= ${end}${c.sql} ORDER BY t.due_on LIMIT ${LIMIT}`).bind(...c.binds).all<Record<string, string>>(),
  ]);
  const map = (kind: ExpiryKind, route: string) => (r: Record<string, string>): Expiry => ({ kind, id: r.id, title: r.title, where: r.place ?? null, date: r.date, status: r.status, href: `${route}/${encodeURIComponent(r.id)}` });
  const rows = [
    ...coi.results.map(map("coi", "/app/compliance/cois")),
    ...pol.results.map(map("policy", "/app/compliance/insurance")),
    ...item.results.map(map("item", "/app/compliance/items")),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return { today: today?.d ?? demoNowIso().slice(0, 10), rows };
}
