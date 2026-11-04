import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, go, openFull } from "./helpers";

// Compliance flow as the maintenance supervisor: dashboard → KPI drill-down → filtered list →
// record with its actions. Run against a dev server: BASE_URL=http://localhost:3201.

// The shared dev server compiles pages on first hit; allow for it.
test.use({ navigationTimeout: 180_000, actionTimeout: 60_000 });
test.setTimeout(300_000);
const expect = baseExpect.configure({ timeout: 60_000 });

test.beforeEach(({ context }) => as(context, "tom"));

test("compliance dashboard drills into lists and records", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await go(page, `${BASE}/app/compliance`);
  await expect(page.getByRole("heading", { name: "Compliance", level: 1 })).toBeVisible();
  await expect(page.getByText("Expiries timeline")).toBeVisible();
  await expect(page.getByText("Compliance agent proposals")).toBeVisible();
  await expect(page.getByText("Upcoming expiries, next 12 months")).toBeVisible();

  // KPI drill-down opens the filtered list.
  await page.getByRole("link", { name: /Overdue compliance items/ }).click();
  await expect(page).toHaveURL(/\/app\/compliance\/items\?f\.status=Overdue/);
  await expect(page.getByRole("heading", { name: "Compliance items" })).toBeVisible();

  // Vendor certificates: the current view, then a record page.
  await go(page, `${BASE}/app/compliance/cois?view=current`);
  await expect(page.getByRole("heading", { name: "Vendor COIs" })).toBeVisible();
  const first = page.locator("a[href^='/app/compliance/cois/']").first();
  if (await first.count()) {
    await first.click();
    await openFull(page);
    await expect(page).toHaveURL(/\/app\/compliance\/cois\/[^/?]+/);
    await expect(page.getByText("Overview").first()).toBeVisible();
  }

  // Timeline links open record pages.
  await go(page, `${BASE}/app/compliance`);
  const item = page.locator("a[href^='/app/compliance/items/']").first();
  if (await item.count()) {
    await item.click();
    await expect(page).toHaveURL(/\/app\/compliance\/items\/[^/?]+/);
  }

  expect(errors).toEqual([]);
});

test("legal cases are hidden from roles without access", async ({ page }) => {
  await go(page, `${BASE}/app/compliance`);
  await expect(page.getByRole("link", { name: "Legal and evictions" })).toHaveCount(0);
});

test("a lapsed vendor certificate is requested from the timeline, once", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await go(page, `${BASE}/app/compliance`);
  await expect(page.getByText("Lapsed, needs action")).toBeVisible();
  const request = page.getByRole("button", { name: "Request certificate" }).first();
  await expect(request).toBeVisible();
  await request.click();
  await expect(page.getByText("Asked the vendor for a current certificate")).toBeVisible();
  // The row now says when the vendor was asked instead of offering the button again.
  await expect(page.getByText(/^Asked /).first()).toBeVisible();
  expect(errors).toEqual([]);
});
