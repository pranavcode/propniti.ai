import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, go, watch } from "./helpers";

// Record peek drawer on a generic list, as Sam (admin): a row click opens the drawer and sets
// ?peek, J moves to the next row, Back closes it, and "Open full page" navigates to the record.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

test.beforeEach(({ context }) => as(context, "sam"));

test("a list row opens the peek drawer, J moves, Back closes, Open full page navigates", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/properties?sort=name`);
  const rows = page.locator("tbody a[data-peek-id]");
  await expect(rows.first()).toBeVisible();
  const first = (await rows.nth(0).getAttribute("data-peek-id"))!;
  const second = (await rows.nth(1).getAttribute("data-peek-id"))!;
  const firstTitle = (await rows.nth(0).innerText()).split("\n")[0]!.trim();

  // The row link stays a real link to the full record page.
  await expect(rows.first()).toHaveAttribute("href", `/app/properties/${first}`);

  await rows.first().click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`[?&]peek=${first}(&|$)`));
  await expect(page).toHaveURL(/sort=name/);
  await expect(drawer.getByRole("heading", { name: new RegExp(firstTitle) })).toBeVisible();
  await expect(drawer.getByRole("link", { name: /Open full page/ })).toBeVisible();

  await page.keyboard.press("j");
  await expect(page).toHaveURL(new RegExp(`[?&]peek=${second}(&|$)`));
  await expect(drawer.getByText(`· ${second}`)).toBeVisible();

  // Moving replaced the entry, so one Back closes the drawer and keeps the list's own params.
  await page.goBack();
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/peek=/);
  await expect(page).toHaveURL(/\/app\/properties\?sort=name$/);

  // A deep link opens the drawer on load; Open full page goes to the record.
  await go(page, `${BASE}/app/properties?sort=name&peek=${second}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("link", { name: /Open full page/ }).click();
  await expect(page).toHaveURL(new RegExp(`/app/properties/${second}$`));
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(errors).toEqual([]);
});
