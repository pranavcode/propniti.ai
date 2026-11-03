/* eslint-disable @typescript-eslint/ban-ts-comment -- see the next line */
// @ts-nocheck -- @playwright/test is not a dependency yet (requested from the lead); remove once it is.
import { expect, test } from "@playwright/test";

// Platform flows: the /app router and AI briefing, then an admin changing an approval policy
// (audited, shown in the change history) and a personal notification preference.
// Run against a dev server: BASE_URL=http://localhost:3201.

const BASE = process.env.BASE_URL ?? "http://localhost:3201";
const as = async (context, persona: string) => {
  await context.addCookies([{ name: "pn_as", value: persona, url: BASE }]);
  await context.addInitScript(() => localStorage.setItem("pn_tours", JSON.stringify({ "app-basics": { tour: "app-basics", step: 0, status: "Dismissed", updatedAt: "2026-11-04T00:00:00Z" } })));
};

test("routes personas from /app to their homes", async ({ context, page }) => {
  await as(context, "lena");
  await page.goto(`${BASE}/app`);
  await expect(page).toHaveURL(/\/app\/leasing\/prospects/);
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
  await page.getByLabel("Auto-approve up to ($)").fill("1250");
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByText("Updated Auto-approve up to")).toBeVisible();
  await expect(page.locator("tr", { hasText: "Maintenance spend" }).first()).toContainText("$1,250");
});

test("anyone sets their own notification preferences", async ({ context, page }) => {
  await as(context, "marcus");
  await page.goto(`${BASE}/app/settings/notifications`);
  const sms = page.getByRole("switch", { name: "Agent run results by SMS" });
  await sms.click();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Agent run results by SMS" })).toHaveAttribute("aria-checked", "true");
});
