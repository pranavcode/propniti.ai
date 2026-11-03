// Worker entry that adds Cron Triggers to the vinext app (not wired yet; see AGENTS.md
// "Scheduled agents"). To enable: set `entrypoint: "./src/worker-entry.ts"` and
// `triggers: { crons: ["*/15 * * * *"] }` in cloudflare.config.ts, then prove both builds.
import app from "vinext/server/fetch-handler";

type Ctx = { waitUntil(p: Promise<unknown>): void };

const worker = {
  fetch: app.fetch,
  // Runs due agents (agent_definitions.triggers.schedule) and drains the events outbox.
  // The AI lane fills this in; work goes through ctx.waitUntil so the invocation can return.
  async scheduled(controller: { cron: string; scheduledTime: number }, _env: unknown, ctx: Ctx) {
    ctx.waitUntil(Promise.resolve(controller.cron));
  },
};

export default worker;
