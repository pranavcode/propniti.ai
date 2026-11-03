/* eslint-disable @typescript-eslint/ban-ts-comment -- see the next line */
// @ts-nocheck -- @playwright/test is not a dependency yet (requested from the lead); remove once it is.
import { expect, test, type BrowserContext } from "@playwright/test";

// Portfolio flows: principal home → explain a KPI → drill to a property → unit stack → unit;
// regional comparison with "explain this variance"; the what-if simulator with its AI narrative.
// Run against a dev server: BASE_URL=http://localhost:3201.

const BASE = process.env.BASE_URL ?? "http://localhost:3201";
const TOURS = ["app-basics", "portfolio-principal", "portfolio-regional"];

async function as(context: BrowserContext, persona: string) {
  await context.addCookies([{ name: "pn_as", value: persona, url: BASE }]);
  await context.addInitScript((ids: string[]) => localStorage.setItem("pn_tours", JSON.stringify(Object.fromEntries(ids.map((t) => [t, { tour: t, step: 0, status: "Dismissed", updatedAt: "2026-11-04T00:00:00Z" }])))), TOURS);
}

test("principal home explains NOI and drills to a property and unit", async ({ page, context }) => {
  await as(context, "daniel");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/app`);
  await expect(page.getByRole("heading", { name: "Good morning, Daniel", level: 1 })).toBeVisible();
  await expect(page.getByText("Briefing")).toBeVisible();
  await expect(page.getByText("Portfolio NOI vs budget")).toBeVisible();
  await expect(page.getByText("AI hours saved").first()).toBeVisible();

  // Explain this number: computed movers, a source badge and the run link.
  await page.getByRole("button", { name: "Explain NOI" }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Why did noi change?")).toBeVisible();
  await expect(sheet.getByText("Properties that moved it most")).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByRole("link", { name: /View run/ })).toHaveAttribute("href", /\/app\/ai\/runs\/run_/);
  await page.keyboard.press("Escape");

  // Drill: watchlist property → unit stack → a unit.
  await page.getByText("Furthest below budget").locator("xpath=ancestor::section").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/app\/properties\/p\d{2}\?tab=financials/);
  await page.getByRole("link", { name: "Unit stack" }).click();
  await page.locator('a[href^="/app/units/u-"]').first().click();
  await expect(page).toHaveURL(/\/app\/units\/u-/);
  await expect(page.getByRole("link", { name: "Lease history" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("regional comparison explains one property's variance", async ({ page, context }) => {
  await as(context, "priya");
  await page.goto(`${BASE}/app`);
  await expect(page.getByText("Property comparison")).toBeVisible();
  const rows = page.locator("#compare tbody tr");
  await expect(rows).toHaveCount(14);
  await rows.first().getByRole("button", { name: /Explain .* NOI/ }).click();
  await expect(page.getByRole("dialog").getByText(/NOI (rose|fell|held steady)/)).toBeVisible({ timeout: 30_000 });
});

test("what-if simulator recomputes NOI and narrates the scenario", async ({ page, context }) => {
  await as(context, "daniel");
  await page.goto(`${BASE}/app/portfolio/what-if?rent=3`);
  await expect(page.getByRole("heading", { name: /What-if/ })).toBeVisible();
  await page.locator('[data-tour="whatif-explain"]').getByRole("button").first().click();
  await expect(page.getByRole("link", { name: /View run/ })).toBeVisible({ timeout: 30_000 });
});
