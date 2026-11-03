import { sameOrigin } from "@/ai/session";
import { askListing } from "@/components/public/ask";
import { getListing, renterHelp } from "@/components/public/data";
import { AskRequest } from "@/components/public/schemas";
import { rateLimit } from "@/lib/guard";
import { parseBody } from "@/lib/requests";
import { NO_WORKSPACE } from "@/server/effective";
import { readCookie } from "@/server/workspace";

// "Ask about this unit": public, no sign-in, AI rate limit (20 a minute per client), read-only.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const limited = await rateLimit(request, "ai");
  if (limited) return limited;
  const body = await parseBody(request, AskRequest, 2048);
  if (body instanceof Response) return body;
  const { id } = await params;
  const ws = readCookie(request) ?? NO_WORKSPACE;
  const listing = await getListing(ws, id);
  if (!listing) return Response.json({ error: "This listing is no longer available." }, { status: 404 });
  const reply = await askListing(listing, body.question, await renterHelp(ws));
  return Response.json(reply, { headers: { "Cache-Control": "no-store" } });
}
