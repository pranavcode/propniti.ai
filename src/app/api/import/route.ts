import { handle, json } from "@/app/api/e/_lib/http";
import { parseBody } from "@/lib/requests";
import { importCtx, writeWorkspace } from "@/extensions/import/http";
import { commit, ImportRequest, plan } from "@/extensions/import/server";

// POST { mode: "preview" | "commit", payload, options }. The payload is the cleaned records the
// browser built from the files; the server re-checks them, matches them to existing records and,
// on commit, writes them to the visitor's workspace in one batch.
const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  return handle(async () => {
    const ctx = await importCtx(request, "write");
    if (ctx instanceof Response) return ctx;
    const body = await parseBody(request, ImportRequest, MAX_IMPORT_BYTES);
    if (body instanceof Response) return body;
    if (body.mode === "preview") {
      const p = await plan(ctx, body.payload, body.options);
      return json({ batch: p.batch, summary: p.summary, skipped: p.skipped, matched: p.matched, samples: p.samples, notes: p.notes });
    }
    const w = await writeWorkspace(request, ctx, true);
    if (w instanceof Response) return w;
    return json(await commit(w.ctx, body.payload, body.options), 200, w.setCookie);
  });
}
