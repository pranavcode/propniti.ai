import "@/entities";
import { sessionFromRequest } from "@/auth/session";
import { getPlatform } from "@/lib/platform";
import { renderLeaseDocument } from "@/server/leaseDoc";
import { getRow } from "@/server/query";

// GET /docs/leases/<lease id>, also /docs/leases/<lease id>.pdf: the signed lease agreement as
// printable HTML, rendered from data on demand. Only for personas who can read that lease; anyone
// else gets 404, so the URL doesn't reveal which leases exist.
const ID = /^L-\d{4,6}$/;
const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.replace(/\.(pdf|html)$/i, "");
  if (!ID.test(id)) return notFound();
  const session = await sessionFromRequest(request);
  const db = getPlatform().db;
  const ctx = { db, ws: session.ws, actor: session.actor };
  const visible = await getRow(ctx, "leases", id).catch(() => null);
  if (!visible) return notFound();
  const html = await renderLeaseDocument(db, session.ws, id);
  if (!html) return notFound();
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
}
