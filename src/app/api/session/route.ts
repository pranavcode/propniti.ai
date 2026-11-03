import { getPersona, personaCookie, PN_AS } from "@/auth/personas";
import { rateLimit, readBodyLimited } from "@/lib/guard";
import { sameOrigin } from "../e/_lib/http";

// Demo sign-in and "Switch role": sets the pn_as cookie and lands on the persona's home.
// Accepts a plain form post (persona, optional next) so the picker works before hydration.
// DELETE signs out (clears the persona).
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const limited = await rateLimit(request, "write");
  if (limited) return limited;
  let id: string | undefined;
  let next: string | undefined;
  const type = request.headers.get("content-type") ?? "";
  const bytes = await readBodyLimited(request, 4096);
  if (bytes instanceof Response) return bytes;
  const text = new TextDecoder().decode(bytes);
  if (type.includes("application/json")) {
    let b: { persona?: unknown; next?: unknown } = {};
    try {
      b = JSON.parse(text);
    } catch {}
    id = typeof b.persona === "string" ? b.persona : undefined;
    next = typeof b.next === "string" ? b.next : undefined;
  } else {
    const f = new URLSearchParams(text);
    id = f.get("persona") ?? undefined;
    next = f.get("next") ?? undefined;
  }
  const persona = getPersona(id);
  if (!persona) return Response.json({ error: "Unknown persona" }, { status: 400 });
  // Only same-site paths, so the picker can't be used as an open redirect.
  const to = next && /^\/(app|portal)(\/|$|\?)/.test(next) ? next : persona.home;
  const headers = new Headers({ "Set-Cookie": personaCookie(persona.id), "Cache-Control": "no-store" });
  if (type.includes("application/json")) return Response.json({ ok: true, persona: persona.id, href: to }, { headers });
  headers.set("Location", to);
  return new Response(null, { status: 303, headers });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": `${PN_AS}=; Path=/; SameSite=Lax; Max-Age=0`, "Cache-Control": "no-store" } });
}
