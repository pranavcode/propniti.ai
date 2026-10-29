import { getPlatform } from "@/lib/platform";

// Requests per client per minute: paid AI routes, and routes that change demo data.
const LIMITS = { ai: 20, write: 60 };
const WINDOW_MS = 60_000;
const hits = { ai: new Map<string, { count: number; reset: number }>(), write: new Map<string, { count: number; reset: number }>() };

// Which client a request belongs to. On Cloudflare, cf-connecting-ip is set by Cloudflare and
// can't be spoofed. Elsewhere, client headers are only trusted when TRUSTED_IP_HEADER names one
// your proxy overwrites (e.g. x-forwarded-for behind a load balancer); otherwise all callers
// share one budget, which is safe but strict.
export function clientKey(request: Request, onCloudflare: boolean, trustedHeader = process.env.TRUSTED_IP_HEADER) {
  if (onCloudflare) return request.headers.get("cf-connecting-ip") ?? "anonymous";
  if (trustedHeader) return request.headers.get(trustedHeader)?.split(",")[0].trim() || "anonymous";
  return "shared";
}

// Caps calls per client: Cloudflare's rate limiter on Workers,
// an in-memory fixed window elsewhere (per instance; put a shared limiter in front at scale).
export async function rateLimit(request: Request, kind: keyof typeof LIMITS = "ai"): Promise<Response | null> {
  const platform = getPlatform();
  const limiter = kind === "ai" ? platform.limiter : platform.writeLimiter;
  const key = clientKey(request, !!limiter);
  let ok: boolean;
  if (limiter) {
    ok = (await limiter.limit({ key })).success;
  } else {
    const now = Date.now();
    const h = hits[kind].get(key);
    if (!h || h.reset < now) hits[kind].set(key, { count: 1, reset: now + WINDOW_MS });
    else h.count++;
    ok = hits[kind].get(key)!.count <= (key === "shared" ? LIMITS[kind] * 5 : LIMITS[kind]);
  }
  return ok ? null : Response.json({ error: "Too many requests. Try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
}

// Reads a request body up to maxBytes, stopping as soon as the limit is passed, so an
// oversized or chunked upload is never buffered in full.
export async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return Response.json({ error: "Request too large" }, { status: 413 });
  if (!request.body) return new Uint8Array(new ArrayBuffer(0));
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      // Stop reading; the rest of the body is never buffered.
      reader.releaseLock();
      return Response.json({ error: "Request too large" }, { status: 413 });
    }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
