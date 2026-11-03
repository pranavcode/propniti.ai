import { z } from "zod";
import { ORG_ID } from "@/extensions/settings/data";
import { mergePrefs, settingsPost, setupStep } from "@/extensions/settings/write";

const body = z.strictObject({
  legal_name: z.string().trim().min(2).max(120),
  ein: z.string().trim().regex(/^\d{2}-\d{7}$/, "Use the format 12-3456789"),
  address: z.string().trim().min(5).max(200),
  phone: z.string().trim().min(7).max(30),
  support_email: z.email().max(120),
  timezone: z.enum(["America/Chicago", "America/New_York", "America/Phoenix", "America/Denver", "America/Los_Angeles"]),
  fiscal_year_start: z.enum(["January", "April", "July", "October"]),
  license_number: z.string().trim().max(40),
});

export const POST = settingsPost(body, async (ctx, b) => {
  const profile = await mergePrefs(ctx, ORG_ID, "profile", b, "Updated company profile");
  await setupStep(ctx, "company", "Done").run();
  return { profile, message: "Company profile saved" };
}, { adminOnly: true });
