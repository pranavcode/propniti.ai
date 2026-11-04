import { expect as baseExpect, test } from "@playwright/test";
import { getPersona } from "../../src/auth/personas";
import { as, BASE, go, reload } from "./helpers";

// Platform flows: the /app router and AI briefing, then an admin changing an approval policy
// (audited, shown in the change history) and a personal notification preference.
// Run against a dev server: BASE_URL=http://localhost:3201.

// The shared dev server compiles pages on first hit; allow for it.
test.use({ navigationTimeout: 180_000, actionTimeout: 60_000 });
test.setTimeout(300_000);
const expect = baseExpect.configure({ timeout: 60_000 });

test("routes personas from /app to their homes", async ({ context, page }) => {
  await as(context, "lena");
  await go(page, `${BASE}/app`);
  await expect(page).toHaveURL(new RegExp(`${getPersona("lena")!.home}$`));
});

test("admin briefing shows overnight agents, what needs you and risks", async ({ context, page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await as(context, "sam");
  await go(page, `${BASE}/app`);
  await expect(page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening), Sam/ })).toBeVisible();
  await expect(page.getByLabel("Ask Propniti")).toBeVisible();
  await expect(page.getByText("What needs you")).toBeVisible();
  await expect(page.getByText("Risks and anomalies")).toBeVisible();
  await expect(page.getByText("Overnight")).toBeVisible();
  // Tiles open the approvals inbox on their own tab (the inbox reads ?tab=).
  await expect(page.getByRole("link", { name: /Waiting on others/ })).toHaveAttribute("href", "/app/ai/approvals?tab=waiting");
  await page.getByRole("link", { name: /Handled by agents/ }).click();
  await expect(page).toHaveURL(/\/app\/ai\/approvals\?tab=auto_handled/);
  await expect(page.getByText("Low-risk actions inside your approval policies, already applied and audited.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("admin edits an approval limit and sees it in the change history", async ({ context, page }) => {
  await as(context, "sam");
  await go(page, `${BASE}/app/settings/approvals`);
  await page.getByRole("button", { name: "Edit Maintenance spend · org default" }).click();
  const amount = String(1000 + Math.floor(Math.random() * 900));
  await page.getByLabel("Auto-approve up to ($)").fill(amount);
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByRole("list", { name: "Change history" }).getByRole("listitem").first()).toContainText(`$${Number(amount).toLocaleString("en-US")}`);
  await expect(page.locator("tr", { hasText: "Maintenance spend" }).first()).toContainText(`$${Number(amount).toLocaleString("en-US")}`);
});

test("anyone sets their own notification preferences", async ({ context, page }) => {
  await as(context, "marcus");
  await go(page, `${BASE}/app/settings/notifications`);
  const sms = page.getByRole("switch", { name: "Agent run results by SMS" });
  const before = await sms.getAttribute("aria-checked");
  const saved = page.waitForResponse((r) => r.url().includes("/app/settings/notifications/prefs") && r.request().method() === "POST");
  await sms.click();
  expect((await saved).status()).toBe(200);
  await reload(page);
  await expect(page.getByRole("switch", { name: "Agent run results by SMS" })).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
});
