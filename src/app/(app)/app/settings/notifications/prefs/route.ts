import { z } from "zod";
import { CHANNELS, NOTIFICATION_TYPES } from "@/extensions/settings/notifications";
import { mergePrefs, settingsPost } from "@/extensions/settings/write";

const channels = z.strictObject(Object.fromEntries(CHANNELS.map((c) => [c.key, z.boolean()])) as Record<(typeof CHANNELS)[number]["key"], z.ZodBoolean>);
const body = z.strictObject({
  types: z.strictObject(Object.fromEntries(NOTIFICATION_TYPES.map((t) => [t.key, channels.optional()]))).optional(),
  digest: z.enum(["Off", "Daily 7:00", "Daily 17:00", "Weekly Monday"]).optional(),
  quiet_hours: z.boolean().optional(),
});

// Personal preferences: every staff persona edits their own, keyed by persona id.
export const POST = settingsPost(body, async (ctx, b) => {
  const prefs = await mergePrefs(ctx, ctx.actor.personaId, "notifications", b, "Updated notification preferences");
  return { prefs, message: "Notification preferences saved" };
}, { adminOnly: false });
