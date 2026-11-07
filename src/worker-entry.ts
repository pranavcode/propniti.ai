// Worker entry: the vinext app's fetch, plus the Cron Trigger (cloudflare.config.ts, every 15
// minutes). The scheduled handler sends one internal request to /api/ai/sweep through the app
// itself, so the sweep runs in the same request context (bindings, after()/waitUntil) as any route.
// A per-isolate token in the request proves it came from here. Plain HTTP on the production
// hosts is redirected to https before the app runs (src/lib/https.ts).
import app from "vinext/server/fetch-handler";
import { edgeGuard } from "@/lib/https";

type Ctx = { waitUntil(p: Promise<unknown>): void; passThroughOnException?(): void };

const worker = {
  fetch(request: Request, env: unknown, ctx: Ctx) {
    return edgeGuard(request) ?? app.fetch(request, env, ctx);
  },
  async scheduled(controller: { cron: string; scheduledTime: number }, env: unknown, ctx: Ctx) {
    const token = crypto.randomUUID();
    (globalThis as { __pnCronToken?: string }).__pnCronToken = token;
    const req = new Request("https://cron.internal/api/ai/sweep", { method: "POST", headers: { "x-pn-cron": token, "content-type": "application/json" } });
    ctx.waitUntil(
      Promise.resolve(app.fetch(req, env, ctx))
        .then(async (res: Response) => console.log(`[cron] ${controller.cron} sweep ${res.status}`, (await res.text()).slice(0, 500)))
        .catch((err: unknown) => console.error(`[cron] ${controller.cron} sweep failed:`, err)),
    );
  },
};

export default worker;
