import { expect as baseExpect, test, type BrowserContext } from "@playwright/test";
import { getPersona } from "../../src/auth/personas";

// Platform flows: the /app router and AI briefing, then an admin changing an approval policy
// (audited, shown in the change history) and a personal notification preference.
// Run against a dev server: BASE_URL=http://localhost:3201.

const BASE = process.env.BASE_URL ?? "http://localhost:3201";
// The shared dev server compiles pages on first hit; allow for it.
test.use({ navigationTimeout: 180_000, actionTimeout: 60_000 });
test.setTimeout(300_000);
const expect = baseExpect.configure({ timeout: 60_000 });
const as = async (context: BrowserContext, persona: string) => {
  await context.addCookies([{ name: "pn_as", value: persona, url: BASE }]);
  await context.addInitScript(() => localStorage.setItem("pn_tours", JSON.stringify({ "app-basics": { tour: "app-basics", step: 0, status: "Dismissed", updatedAt: "2026-11-04T00:00:00Z" } })));
};

test("routes personas from /app to their homes", async ({ context, page }) => {
  await as(context, "lena");
  await page.goto(`${BASE}/app`);
  await expect(page).toHaveURL(new RegExp(`${getPersona("lena")!.home}$`));
});

test("admin briefing shows overnight agents, what needs you and risks", async ({ context, page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await as(context, "sam");
  await page.goto(`${BASE}/app`);
  await expect(page.getByRole("heading", { level: 1, name: /Good (morning|afternoon|evening), Sam/ })).toBeVisible();
  await expect(page.getByLabel("Ask Propniti")).toBeVisible();
  await expect(page.getByText("What needs you")).toBeVisible();
  await expect(page.getByText("Risks and anomalies")).toBeVisible();
  await expect(page.getByText("Overnight")).toBeVisible();
  expect(errors).toEqual([]);
});

test("admin edits an approval limit and sees it in the change history", async ({ context, page }) => {
  await as(context, "sam");
  await page.goto(`${BASE}/app/settings/approvals`);
  await page.getByRole("button", { name: "Edit Maintenance spend · org default" }).click();
  const amount = String(1000 + Math.floor(Math.random() * 900));
  await page.getByLabel("Auto-approve up to ($)").fill(amount);
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByRole("list", { name: "Change history" }).getByRole("listitem").first()).toContainText(`$${Number(amount).toLocaleString("en-US")}`);
  await expect(page.locator("tr", { hasText: "Maintenance spend" }).first()).toContainText(`$${Number(amount).toLocaleString("en-US")}`);
});

test("anyone sets their own notification preferences", async ({ context, page }) => {
  await as(context, "marcus");
  await page.goto(`${BASE}/app/settings/notifications`);
  const sms = page.getByRole("switch", { name: "Agent run results by SMS" });
  const before = await sms.getAttribute("aria-checked");
  const saved = page.waitForResponse((r) => r.url().includes("/app/settings/notifications/prefs") && r.request().method() === "POST");
  await sms.click();
  expect((await saved).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("switch", { name: "Agent run results by SMS" })).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
});
