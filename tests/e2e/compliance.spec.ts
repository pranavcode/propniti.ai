import { expect as baseExpect, test } from "@playwright/test";

// Compliance flow as the maintenance supervisor: dashboard → KPI drill-down → filtered list →
// record with its actions. Run against a dev server: BASE_URL=http://localhost:3201.

const BASE = process.env.BASE_URL ?? "http://localhost:3201";
// The shared dev server compiles pages on first hit; allow for it.
test.use({ navigationTimeout: 180_000, actionTimeout: 60_000 });
test.setTimeout(300_000);
const expect = baseExpect.configure({ timeout: 60_000 });

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: "pn_as", value: "tom", url: BASE }]);
  // Skip the first-visit product tour.
  await context.addInitScript(() => localStorage.setItem("pn_tours", JSON.stringify({ "app-basics": { tour: "app-basics", step: 0, status: "Dismissed", updatedAt: "2026-11-04T00:00:00Z" } })));
});

test("compliance dashboard drills into lists and records", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/app/compliance`);
  await expect(page.getByRole("heading", { name: "Compliance", level: 1 })).toBeVisible();
  await expect(page.getByText("Expiries timeline")).toBeVisible();
  await expect(page.getByText("Compliance agent proposals")).toBeVisible();
  await expect(page.getByText("Upcoming expiries, next 12 months")).toBeVisible();

  // KPI drill-down opens the filtered list.
  await page.getByRole("link", { name: /Overdue compliance items/ }).click();
  await expect(page).toHaveURL(/\/app\/compliance\/items\?f\.status=Overdue/);
  await expect(page.getByRole("heading", { name: "Compliance items" })).toBeVisible();

  // Vendor certificates: the current view, then a record page.
  await page.goto(`${BASE}/app/compliance/cois?view=current`);
  await expect(page.getByRole("heading", { name: "Vendor COIs" })).toBeVisible();
  const first = page.locator("a[href^='/app/compliance/cois/']").first();
  if (await first.count()) {
    await first.click();
    await expect(page).toHaveURL(/\/app\/compliance\/cois\/[^/?]+/);
    await expect(page.getByText("Overview").first()).toBeVisible();
  }

  // Timeline links open record pages.
  await page.goto(`${BASE}/app/compliance`);
  const item = page.locator("a[href^='/app/compliance/items/']").first();
  if (await item.count()) {
    await item.click();
    await expect(page).toHaveURL(/\/app\/compliance\/items\/[^/?]+/);
  }

  expect(errors).toEqual([]);
});

test("legal cases are hidden from roles without access", async ({ page }) => {
  await page.goto(`${BASE}/app/compliance`);
  await expect(page.getByRole("link", { name: "Legal and evictions" })).toHaveCount(0);
});
