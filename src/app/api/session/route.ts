import { DEMO_PASSWORD, getPersona, personaByEmail, personaCookie, PN_AS, safeNext, type Persona } from "@/auth/personas";
import { secureAttr } from "@/lib/cookie";
import { rateLimit, readBodyLimited } from "@/lib/guard";
import { COOKIE } from "@/server/workspace";
import { sameOrigin } from "../e/_lib/http";

// Demo sign-in and "Switch role": sets the pn_as cookie and lands on the persona's home.
// Two ways in, both plain form posts (or JSON) so they work before hydration:
//   email + password: a demo account (the password is published on the sign-in page);
//   persona: the one-click cards and "View as" buttons.
// DELETE signs out (clears the persona and the workspace cookie).

const noStore = { "Cache-Control": "no-store" };
const fields = ["persona", "email", "password", "next"] as const;
type Fields = Partial<Record<(typeof fields)[number], string>>;

// Compares SHA-256 digests byte by byte without stopping early, so the time taken doesn't
// depend on how much of the password matched.
async function samePassword(given: string) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, DEMO_PASSWORD].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))));
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const limited = await rateLimit(request, "write");
  if (limited) return limited;
  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  const bytes = await readBodyLimited(request, 4096);
  if (bytes instanceof Response) return bytes;
  const text = new TextDecoder().decode(bytes);
  const f: Fields = {};
  if (isJson) {
    let b: Record<string, unknown> = {};
    try {
      b = JSON.parse(text);
    } catch {}
    for (const k of fields) if (typeof b?.[k] === "string") f[k] = b[k] as string;
  } else {
    const form = new URLSearchParams(text);
    for (const k of fields) f[k] = form.get(k) ?? undefined;
  }
  const next = safeNext(f.next);

  const signIn = (persona: Persona) => {
    const to = next ?? persona.home;
    const headers = new Headers({ ...noStore, "Set-Cookie": personaCookie(persona.id) });
    if (isJson) return Response.json({ ok: true, persona: persona.id, href: to }, { headers });
    headers.set("Location", to);
    return new Response(null, { status: 303, headers });
  };

  if (f.email !== undefined) {
    const persona = personaByEmail(f.email);
    // Always compare, so an unknown email takes as long as a wrong password.
    const passwordOk = await samePassword(f.password ?? "");
    if (persona && passwordOk) return signIn(persona);
    const field = persona ? "password" : "email";
    const error = persona ? "Wrong password — the demo password is shown above." : "No demo account with that email — pick a person from the list.";
    if (isJson) return Response.json({ field, error }, { status: 401, headers: noStore });
    const back = new URLSearchParams({ error: field, email: f.email.slice(0, 254) });
    if (next) back.set("next", next);
    return new Response(null, { status: 303, headers: { ...noStore, Location: `/login?${back}` } });
  }

  const persona = getPersona(f.persona);
  if (!persona) return Response.json({ error: "Unknown persona" }, { status: 400 });
  return signIn(persona);
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  // Sign-out also drops the workspace (pn_ws), so the next person on this browser starts clean.
  const headers = new Headers(noStore);
  headers.append("Set-Cookie", `${PN_AS}=; Path=/; SameSite=Lax; Max-Age=0${secureAttr()}`);
  headers.append("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureAttr()}`);
  return Response.json({ ok: true }, { headers });
}
