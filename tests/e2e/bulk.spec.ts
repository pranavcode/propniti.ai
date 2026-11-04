import { expect as baseExpect, test } from "@playwright/test";
import { as, go, watch } from "./helpers";

// Generic list friction: bulk actions on every matching record, and "New" forms that start
// from the parent record. As Tom Alvarez (maintenance supervisor).

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

test.beforeEach(({ context }) => as(context, "tom"));

test("select all matching runs a bulk action on every matching work order", async ({ page }) => {
  const errors = watch(page);
  // A match set just over one page (46 in the seed): on production each record's action pays a
  // database round trip, so "all 500" would take minutes; two pages still need "select all matching".
  await go(page, "/app/maintenance/work-orders?f.status=Completed&f.property_id=p01&f.category=HVAC&size=25");
  await page.getByRole("checkbox", { name: "Select all on this page" }).click();
  const bar = page.getByRole("toolbar", { name: "Bulk actions" });
  await expect(bar.getByText("25 selected")).toBeVisible();
  const selectAll = bar.getByRole("button", { name: /^Select (all \d+ matching|the first \d+ of [\d,]+)$/ });
  const n = Number((await selectAll.textContent())!.match(/(\d+)/)![1]);
  expect(n).toBeGreaterThan(25);
  await selectAll.click();
  await expect(bar.getByText(`All ${n} matching selected`)).toBeVisible();
  await bar.getByRole("button", { name: "Run photo check" }).click();
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dialog.getByText(`Run photo check: ${n} work orders?`)).toBeVisible();
  await expect(dialog.getByText(/matching the current filters.*not only this page/)).toBeVisible();
  await dialog.getByRole("button", { name: "Run photo check" }).click();
  // Every matching id reaches the action route: done + skipped (no photos) adds up to n.
  const toastText = page.getByText(new RegExp(`Run photo check: \\d+ of ${n} done`));
  await expect(toastText).toBeVisible({ timeout: 120_000 });
  expect(errors).toEqual([]);
});

test("a new work order from a unit's page starts with the unit and its property", async ({ page }) => {
  const errors = watch(page);
  await go(page, "/app/maintenance/work-orders");
  const unit = await page.evaluate(async () => (await (await fetch("/api/e/units?size=1&sort=id")).json()).rows[0] as { id: string; property_id: string });
  await go(page, `/app/units/${encodeURIComponent(unit.id)}?tab=work_orders`);
  await page.getByRole("button", { name: "New work order" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("combobox", { name: /^Property/ })).toHaveValue(unit.property_id);
  await expect(sheet.getByRole("combobox", { name: /^Unit/ })).toHaveValue(unit.id);
  expect(errors).toEqual([]);
});

test("an action run from the peek drawer offers View, which opens the record", async ({ page, context }) => {
  const errors = watch(page);
  await as(context, "marcus");
  await go(page, "/app/residents/insurance?f.status=Lapsed");
  await page.locator("tbody tr").nth(5).locator("td").nth(1).locator("a").click();
  await page.locator("[data-peek-drawer]").getByRole("button", { name: "Send reminder" }).click();
  await page.getByRole("button", { name: "View" }).click();
  await expect(page).toHaveURL(/\/app\/residents\/insurance\/[^?]+$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/residents\/insurance\?f\.status=Lapsed$/);
  expect(errors).toEqual([]);
});
