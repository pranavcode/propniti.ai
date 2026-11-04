import { dataOf, staffSession } from "@/ai/http";
import { runDetail } from "@/ai/views";

// Live run trace as server-sent events: "refs" then "step" for each batch of new agent_steps rows, "run" when the run's
// status changes, "end" when it finishes. Steps are read from the database every 400 ms, so the
// stream works whichever isolate runs the agent. Clients fall back to polling /api/ai/runs/<id>.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await staffSession(request);
  if (s instanceof Response) return s;
  const data = dataOf(s);
  const first = await runDetail(data, id);
  if (!first) return Response.json({ error: "Run not found" }, { status: 404 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, body: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(body)}\n\n`));
      let last = -1;
      let status = "";
      const deadline = Date.now() + 90_000;
      try {
        for (let r = first; ; ) {
          // Names and links for the records the new steps mention, ahead of the steps themselves.
          if (r.steps.length) send("refs", r.refs);
          for (const step of r.steps) {
            send("step", step);
            last = Math.max(last, step.idx);
          }
          if (r.run.status !== status) {
            status = String(r.run.status);
            send("run", { run: r.run, proposals: r.proposals });
          }
          if (status !== "running" || Date.now() > deadline || request.signal.aborted) break;
          await new Promise((res) => setTimeout(res, 400));
          const next = await runDetail(data, id, last);
          if (!next) break;
          r = next;
        }
        send("end", { status });
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
