import { ask, AskRequest } from "@/ai/assistant";
import { DB_BUSY, dataOf, guarded, json, publicError, waitUntil, writeSession } from "@/ai/http";
import { MODEL_DOWN, ModelError } from "@/ai/providers";
import { cookieHeader } from "@/server/workspace";

// The assistant (⌘J and /app/copilot): chat about data, actions to confirm, and help.
// With Accept: application/x-ndjson the reply streams: {"status"} lines while it works (what it is
// reading or checking), then {"reply"} or {"error"}. The answer itself arrives whole, after its
// figures are checked.
export async function POST(request: Request) {
  return guarded(async () => {
    const w = await writeSession(request, AskRequest, "ai");
    if (w instanceof Response) return w;
    const { s, body } = w;
    const args = { data: dataOf(s), persona: s.persona, question: body.question, mode: body.mode, threadId: body.threadId, context: body.context, waitUntil };
    if (!request.headers.get("accept")?.includes("application/x-ndjson")) return json(await ask(args), { setCookie: s.setCookie });

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const out = writable.getWriter();
    const enc = new TextEncoder();
    const send = (line: unknown) => out.write(enc.encode(`${JSON.stringify(line)}\n`)).catch(() => undefined);
    void ask({ ...args, onStatus: (status) => void send({ status }) })
      .then((reply) => send({ reply }))
      .catch((err) => {
        if (err instanceof ModelError) return send({ error: MODEL_DOWN });
        const shown = publicError(err instanceof Error ? err.message : "Something went wrong");
        if (shown !== DB_BUSY) console.error("[ai] assistant failed:", err);
        return send({ error: shown });
      })
      .finally(() => out.close().catch(() => undefined));
    const headers = new Headers({ "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    if (s.setCookie) headers.set("set-cookie", cookieHeader(s.setCookie));
    return new Response(readable, { headers });
  });
}
