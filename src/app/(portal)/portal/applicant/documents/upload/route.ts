import { getPersona } from "@/auth/personas";
import { readBodyLimited, rateLimit } from "@/lib/guard";
import { getPlatform } from "@/lib/platform";
import { MAX_UPLOAD_BYTES, sniff } from "@/lib/upload";
import { resolveWorkspace } from "@/server/workspace";
import { sameOrigin } from "@/lib/https";
import { handle, json, readCtx } from "@/app/api/e/_lib/http";
import { resolveAction, runAction } from "@/app/api/e/_lib/actions";
import { UPLOAD_ROUTE, UploadDocument } from "@/extensions/owners/portal-actions";

// POST multipart { file, docType, sample? } — an applicant's document. The file is capped at 4 MB
// and identified by its first bytes (JPEG, PNG, WebP or PDF; anything else is 415), then dropped:
// only its name, type and size reach applicants.upload_document, which files it on the application.
export async function POST(request: Request) {
  return handle(async () => {
    if (!sameOrigin(request)) return json({ error: "Cross-site request refused" }, 403);
    const limited = await rateLimit(request, "write");
    if (limited) return limited;
    const base = await readCtx(request);
    const me = base.actor.role === "applicant" ? getPersona(base.actor.personaId)?.record?.id : null;
    if (!me) return json({ error: "Sign in to the applicant portal first" }, 403);
    const body = await readBodyLimited(request, MAX_UPLOAD_BYTES + 64 * 1024);
    if (body instanceof Response) return json({ error: "File too large (max 4 MB)" }, 413);
    let form: FormData;
    try {
      form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    } catch {
      return json({ error: "Expected a multipart upload with a 'file' field" }, 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "Expected a multipart upload with a 'file' field" }, 400);
    if (file.size > MAX_UPLOAD_BYTES) return json({ error: "File too large (max 4 MB)" }, 413);
    const mime = sniff(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!mime) return json({ error: "Upload a JPEG, PNG, WebP or PDF" }, 415);
    const input = UploadDocument.safeParse({ docType: form.get("docType"), fileName: file.name.slice(0, 120) || "document", mime, bytes: file.size, sample: form.get("sample") || undefined });
    if (!input.success) return json({ error: input.error.issues[0]?.message ?? "Check the upload" }, 400);
    const nowMs = Date.now();
    const r = await resolveWorkspace(getPlatform().db, request, nowMs, true, !!getPlatform().writeLimiter);
    if (r instanceof Response) return r;
    const out = await runAction({ ...base, ws: r.ws!, nowMs }, resolveAction("applicants", "upload_document", UPLOAD_ROUTE), me, input.data);
    return json(out.status === 200 ? { ok: true, message: out.message } : { error: "error" in out ? out.error : out.message }, out.status, r.setCookie);
  });
}
