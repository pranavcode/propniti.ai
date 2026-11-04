import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, go, watch } from "./helpers";

// My tasks as three personas: Marcus (property manager, 3 Austin properties) works his list,
// marks a task done and reopens it, opens a related record in the peek drawer and adds a task;
// Tom (maintenance supervisor) sees the make-ready tasks an automation gave him; Grace
// (accountant) adds an org-wide task.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

const tab = (page: import("@playwright/test").Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${name}`) });
const taskRows = (page: import("@playwright/test").Page) => page.locator("tbody a[data-peek-entity='tasks']");

test("Marcus works his list: views, related record, done and reopen", async ({ page, context }) => {
  await as(context, "marcus");
  const errors = watch(page);
  await go(page, `${BASE}/app/tasks`);
  await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();
  await expect(tab(page, "Open")).toHaveAttribute("aria-selected", "true");
  await expect(taskRows(page).first()).toBeVisible();

  await tab(page, "Overdue").click();
  await expect(page).toHaveURL(/due=overdue/);
  const walk = page.locator("tbody tr", { hasText: "Walk vacant units at The Lofts at Riverside" });
  await expect(walk).toBeVisible();

  // The related record opens in the drawer, not as a page.
  await walk.getByRole("link", { name: "The Lofts at Riverside", exact: true }).first().click();
  await expect(page).toHaveURL(/peek=properties(:|%3A)p01/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toBeHidden();

  // Done moves it to the Done view; reopen brings it back.
  await walk.getByRole("button", { name: /Mark Walk vacant units at The Lofts at Riverside done/ }).click();
  await expect(page.getByText(/Marked "Walk vacant units at The Lofts at Riverside" done/)).toBeVisible();
  await expect(walk).toBeHidden();
  await tab(page, "Done").click();
  const done = page.locator("tbody tr", { hasText: "Walk vacant units at The Lofts at Riverside" });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: /Reopen Walk vacant units/ }).click();
  await expect(page.getByText(/Reopened "Walk vacant units at The Lofts at Riverside"/)).toBeVisible();
  await expect(done).toBeHidden();
  expect(errors).toEqual([]);
});

test("Marcus adds a task due today; the briefing's task link opens it in the drawer", async ({ page, context }) => {
  await as(context, "marcus");
  const errors = watch(page);
  await go(page, `${BASE}/app/tasks?due=today`);
  await page.getByRole("button", { name: "New task" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel(/^Task/).fill("Call the roofer about unit 204");
  await sheet.getByLabel("Due").fill("2026-11-04");
  await sheet.getByLabel(/^Property/).selectOption({ label: "Barton Creek Commons" });
  await sheet.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Task added")).toBeVisible();
  const row = page.locator("tbody tr", { hasText: "Call the roofer about unit 204" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("You");

  const id = (await row.locator("a[data-peek-entity='tasks']").getAttribute("data-peek-id"))!;
  await go(page, `${BASE}/app/tasks?task=${encodeURIComponent(id)}`);
  await expect(page).toHaveURL(new RegExp(`peek=${id}`));
  await expect(page.getByRole("dialog").getByRole("heading", { name: /Call the roofer about unit 204/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Tom sees the make-ready tasks an automation assigned him", async ({ page, context }) => {
  await as(context, "tom");
  const errors = watch(page);
  await go(page, `${BASE}/app/tasks`);
  const row = page.locator("tbody tr", { hasText: "Make-ready behind target" }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Automation");
  await expect(row).toContainText("Turnover");
  expect(errors).toEqual([]);
});

test("Grace adds an org-wide task", async ({ page, context }) => {
  await as(context, "grace");
  const errors = watch(page);
  await go(page, `${BASE}/app/tasks`);
  // The seed gives accountants no tasks; other specs in a run may have added some (a vendor bank change).
  await expect(page.getByRole("heading", { name: "My tasks" })).toBeVisible();
  await page.getByRole("button", { name: "New task" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel(/^Task/).fill("Review 1099 vendor list before year end");
  await sheet.getByRole("button", { name: "Add task" }).click();
  const row = page.locator("tbody tr", { hasText: "Review 1099 vendor list before year end" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Org-wide");
  expect(errors).toEqual([]);
});
