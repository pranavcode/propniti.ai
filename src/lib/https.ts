// HTTPS only on the production hosts. Plain HTTP gets a 301 to the same URL on https, and a
// write whose Origin is an http page is refused: a page injected into an http response (before
// the redirect, on a network that rewrites traffic) would otherwise pass the host match.
// Localhost, dev servers and the internal cron host are left alone.

const PRODUCTION_HOSTS = ["propniti.ai", "www.propniti.ai"];
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

function viaHttp(request: Request, url: URL) {
  if (url.protocol === "http:") return true;
  if (request.headers.get("x-forwarded-proto") === "http") return true;
  try {
    return JSON.parse(request.headers.get("cf-visitor") ?? "{}")?.scheme === "http";
  } catch {
    return false;
  }
}

// The Worker's first check on every request; null means carry on to the app.
export function edgeGuard(request: Request): Response | null {
  const url = new URL(request.url);
  if (!PRODUCTION_HOSTS.includes(url.hostname)) return null;
  if (viaHttp(request, url)) {
    url.protocol = "https:";
    return new Response(null, { status: 301, headers: { Location: url.toString() } });
  }
  if (!SAFE_METHODS.includes(request.method) && request.headers.get("origin")?.startsWith("http:")) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  return null;
}

// Same-origin check for writes: the Origin's host must be this host, and in production the
// origin must be https (loopback hosts excepted, for local production builds).
export function secureOrigin(origin: string | null, host: string, production: boolean) {
  if (!origin) return false;
  try {
    const o = new URL(origin);
    if (o.host !== host) return false;
    return !production || o.protocol === "https:" || LOOPBACK.test(o.host);
  } catch {
    return false;
  }
}
