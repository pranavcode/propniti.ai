import { demoNowIso } from "@/lib/clock";
import { z } from "zod";
import { orgId } from "@/extensions/settings/data";
import { INTEGRATIONS } from "@/extensions/settings/integrations";
import { mergePrefs, settingsPost, setupStep } from "@/extensions/settings/write";

const body = z.strictObject({ key: z.enum(INTEGRATIONS.map((i) => i.key) as [string, ...string[]]), connect: z.boolean() });

// Simulated connections: the demo records the status and who changed it; no external calls.
export const POST = settingsPost(body, async (ctx, b) => {
  const at = demoNowIso(ctx.nowMs);
  const name = INTEGRATIONS.find((i) => i.key === b.key)!.name;
  const value = b.connect ? { status: "Connected", at, by: ctx.actor.name } : { status: "Not connected", at, by: ctx.actor.name };
  await mergePrefs(ctx, orgId(ctx), "integrations", { [b.key]: value }, `${b.connect ? "Connected" : "Disconnected"} ${name}`);
  if (b.key === "plaid" || b.key === "stripe") await setupStep(ctx, b.key === "plaid" ? "bank" : "payments", b.connect ? "Done" : "Todo").run();
  return { key: b.key, ...value, message: `${name} ${b.connect ? "connected" : "disconnected"}` };
}, { adminOnly: true });
