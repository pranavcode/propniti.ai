import { getPersona } from "@/auth/personas";
import { getPlatform } from "@/lib/platform";
import { effective } from "@/server/effective";
import { getRow, QueryError } from "@/server/query";
import { readCtx } from "@/app/api/e/_lib/http";
import { sniff } from "@/lib/upload";

// GET /api/photos/<id>: a photo a resident took on their phone, stored with its work order. Pages
// link here (a same-site URL) instead of to the data: URL. Staff and the job's vendor see it when
// the work order is in their scope; a resident sees photos on their own requests; an owner on
// their own properties. Anyone else gets 404. Not cached: personas switch on the same browser.

const DATA = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return notFound();
  const ctx = await readCtx(request);
  const ws = ctx.ws ?? "~";
  const { db } = getPlatform();
  const p = await db.prepare(`SELECT p.data, p.entity_id FROM ${effective("photos")} AS p WHERE p.id = ?2 AND p.entity_type = 'work_orders' AND p.data IS NOT NULL`).bind(ws, id).first<{ data: string; entity_id: string }>();
  const m = p ? DATA.exec(p.data) : null;
  if (!p || !m) return notFound();
  const me = getPersona(ctx.actor.personaId)?.record?.id;
  const role = ctx.actor.role;
  let allowed = false;
  if (role === "resident") {
    allowed = !!(await db.prepare(`SELECT 1 AS x FROM ${effective("service_requests")} AS sr WHERE sr.work_order_id = ?2 AND sr.resident_id = ?3`).bind(ws, p.entity_id, me ?? "").first());
  } else if (role === "owner") {
    allowed = !!(await db.prepare(`SELECT 1 AS x FROM ${effective("work_orders")} AS w JOIN ${effective("properties")} AS pr ON pr.id = w.property_id JOIN ${effective("owner_entities")} AS e ON e.id = pr.owner_entity_id WHERE w.id = ?2 AND e.owner_id = ?3`).bind(ws, p.entity_id, me ?? "").first());
  } else if (role !== "applicant") {
    allowed = !!(await getRow(ctx, "work_orders", p.entity_id).catch((e) => { if (e instanceof QueryError) return null; throw e; }));
  }
  if (!allowed) return notFound();
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  const type = `image/${m[1]}`;
  if (sniff(bytes) !== type) return notFound();
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  return new Response(bytes, { headers: { "Content-Type": type, "Content-Disposition": `inline; filename="${id}.${ext}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
