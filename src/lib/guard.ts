import { getPlatform } from "@/lib/platform";

const LIMIT = 20;
const WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; reset: number }>();

function clientKey(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "anonymous";
}

// Caps calls to the paid AI routes per client IP: Cloudflare's rate limiter on Workers,
// an in-memory fixed window elsewhere (per instance; put a shared limiter in front at scale).
export async function rateLimit(request: Request): Promise<Response | null> {
  const key = clientKey(request);
  const { limiter } = getPlatform();
  let ok: boolean;
  if (limiter) {
    ok = (await limiter.limit({ key })).success;
  } else {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) hits.set(key, { count: 1, reset: now + WINDOW_MS });
    else h.count++;
    ok = (hits.get(key)!.count) <= LIMIT;
  }
  return ok ? null : Response.json({ error: "Too many requests. Try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
}
