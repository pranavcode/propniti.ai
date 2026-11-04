import { expect as baseExpect, test, type Page } from "@playwright/test";
import { as, BASE, go, reload, watch } from "./helpers";

// The "Ask Propniti" chat bubble as Marcus (property manager): it opens and closes the same
// assistant panel as ⌘J, shows a nudge worded from real counts whose action opens the records
// behind it, remembers dismissals, and steps aside while the record peek drawer is open.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

test.beforeEach(({ context }) => as(context, "marcus"));

// Global setup turns tips off for every other spec; turn them on and reset the session's cooldown.
async function tipsOn(page: Page) {
  await page.evaluate(() => { localStorage.removeItem("pn_guide"); sessionStorage.clear(); });
  await reload(page);
}
// A new session: no cooldown, no "already shown", but localStorage (dismissals) kept.
async function newSession(page: Page) {
  await page.evaluate(() => sessionStorage.clear());
  await reload(page);
}

test("the bubble opens and closes the assistant panel; Esc closes it and ⌘J still works", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/today`);
  const dock = page.getByRole("complementary", { name: "Ask Propniti" });
  await page.getByRole("button", { name: "Open Ask Propniti" }).click();
  await expect(dock).toBeVisible();
  // Opened from the bubble: the page guide and this page's questions.
  await expect(dock.getByRole("button", { name: /What can I do here\?/ })).toHaveAttribute("aria-expanded", "true");
  await expect(dock.getByText(/Your day across your properties/)).toBeVisible();
  await expect(dock.getByRole("button", { name: "Who is late on rent?" })).toBeVisible();

  const close = page.getByRole("button", { name: "Close Ask Propniti" });
  await expect(close).toHaveAttribute("aria-expanded", "true");
  await close.click();
  await expect(dock).toBeHidden();

  await page.getByRole("button", { name: "Open Ask Propniti" }).click();
  await expect(dock).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dock).toBeHidden();
  await expect(page.getByRole("button", { name: "Open Ask Propniti" })).toBeFocused();

  // The top-bar shortcut toggles the same panel, without the page guide.
  await page.keyboard.press("ControlOrMeta+j");
  await expect(dock).toBeVisible();
  await expect(dock.getByRole("button", { name: /What can I do here\?/ })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+j");
  await expect(dock).toBeHidden();
  expect(errors).toEqual([]);
});

test("a nudge states a real count, its action opens the records behind it, and dismissals stick", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/today`);
  await tipsOn(page);

  const nudge = page.locator("[data-guide-nudge]");
  await expect(nudge).toBeVisible();
  await expect(nudge).toHaveAttribute("data-guide-nudge", "approvals");
  await expect(page.locator("[aria-live=polite]").filter({ hasText: "Suggestion:" })).toHaveCount(1);
  const n = Number((await nudge.innerText()).match(/(\d[\d,]*) agent proposals? (?:is|are) waiting/)![1].replace(/,/g, ""));
  expect(n).toBeGreaterThan(0);

  await nudge.getByRole("button", { name: "Review" }).click();
  await expect(page).toHaveURL(/\/app\/ai\/approvals$/);
  await expect(page.getByRole("tab", { name: /Needs you/ })).toContainText(String(n));

  // Acting on it counts as done: a new session on the same page doesn't repeat it.
  await go(page, `${BASE}/app/today`);
  await newSession(page);
  const next = page.locator("[data-guide-nudge]");
  await expect(next).toBeVisible();
  const id = (await next.getAttribute("data-guide-nudge"))!;
  expect(id).not.toBe("approvals");

  // Dismissed with ×: it stays dismissed in the next session too.
  await next.getByRole("button", { name: "Dismiss suggestion" }).click();
  await expect(next).toBeHidden();
  await newSession(page);
  await page.waitForTimeout(8000);
  await expect(page.locator(`[data-guide-nudge="${id}"]`)).toHaveCount(0);
  await expect(page.locator('[data-guide-nudge="approvals"]')).toHaveCount(0);
  const dismissed = await page.evaluate(() => JSON.parse(localStorage.getItem("pn_guide") ?? "{}").dismissed);
  expect(Object.keys(dismissed)).toEqual(expect.arrayContaining(["approvals", id]));

  // "Show tips" in the bubble's menu turns them off.
  await page.getByRole("button", { name: "Open Ask Propniti" }).hover();
  await page.getByRole("button", { name: "Assistant tips settings" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show tips" }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("pn_guide") ?? "{}").off)).toBe(true);
  expect(errors).toEqual([]);
});

test("the bubble is hidden while the record peek drawer is open", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/properties?sort=name`);
  const bubble = page.getByRole("button", { name: "Open Ask Propniti" });
  await expect(bubble).toBeVisible();
  await page.locator("tbody a[data-peek-id]").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(bubble).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(bubble).toBeVisible();
  expect(errors).toEqual([]);
});
