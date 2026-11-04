import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, go, watch } from "./helpers";

// The staff inbox as Marcus (property manager), Grace (accountant) and Daniel (principal): one list
// of conversations to answer, agent proposals to decide and alerts, filtered by kind, with the
// nav badge, the peek drawer on a row and actions that go to the page doing the work.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

const badge = (page: import("@playwright/test").Page) => page.getByRole("link", { name: /^Inbox/ }).first();

test("Marcus sees his conversations, approvals and alerts, filters by kind and opens a row", async ({ page, context }) => {
  await as(context, "marcus");
  const errors = watch(page);
  await go(page, `${BASE}/app/inbox`);
  await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible();
  await expect(page.getByText(/\d+ need you/)).toBeVisible();
  await expect(badge(page)).toContainText(/\d+/);
  const list = page.getByRole("list", { name: "Inbox items" });
  await expect(list.locator("li[data-kind=message]").first()).toBeVisible();
  await expect(list.locator("li[data-kind=approval]").first()).toBeVisible();

  // Approvals: each shows the agent's reason with its source and a Review deep link.
  await page.getByRole("link", { name: /^Approvals/ }).filter({ hasText: /\d/ }).last().click();
  await expect(page).toHaveURL(/tab=approvals/);
  const approval = list.locator("li[data-kind=approval]").first();
  await expect(approval.getByText(/^Why:/)).toBeVisible();
  await expect(approval.getByText(/AI · saved|Rule-based fallback|^AI$/).first()).toBeVisible();
  await expect(approval.getByRole("link", { name: /^Review/ })).toHaveAttribute("href", /\/app\/ai\/approvals\?proposal=/);
  await expect(list.locator("li[data-kind=message]")).toHaveCount(0);

  // Messages: Reply opens the conversation in the messages inbox.
  await page.getByRole("link", { name: /^Messages/ }).filter({ hasText: /\d/ }).last().click();
  await expect(page).toHaveURL(/tab=messages/);
  const thread = list.locator("li[data-kind=message]").first();
  await expect(thread.getByText(/Needs reply|Unread/)).toBeVisible();
  // A title click opens the peek drawer on the conversation.
  await thread.locator("a[data-peek-id]").click();
  await expect(page).toHaveURL(/[?&]peek=message_threads(:|%3A)/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await thread.getByRole("link", { name: /^Reply/ }).click();
  await expect(page).toHaveURL(/\/app\/communications\/inbox\?t=/);
  expect(errors).toEqual([]);
});

test("Grace gets bills to decide and no conversations", async ({ page, context }) => {
  await as(context, "grace");
  const errors = watch(page);
  await go(page, `${BASE}/app/inbox`);
  const list = page.getByRole("list", { name: "Inbox items" });
  await expect(list.locator("li[data-kind=approval]").first()).toBeVisible();
  await expect(list.locator("li[data-kind=message]")).toHaveCount(0);
  await go(page, `${BASE}/app/inbox?tab=messages`);
  await expect(page.getByText("No open conversations assigned to you.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("Daniel's alerts link into the app and pages move through the list", async ({ page, context }) => {
  await as(context, "daniel");
  const errors = watch(page);
  await go(page, `${BASE}/app/inbox?tab=alerts`);
  const list = page.getByRole("list", { name: "Inbox items" });
  await expect(list.locator("li[data-kind=alert]").first()).toBeVisible();
  await go(page, `${BASE}/app/inbox?tab=approvals`);
  await expect(page.getByText(/^1–25 of \d+/)).toBeVisible();
  await page.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText(/^26–\d+ of \d+/)).toBeVisible();
  expect(errors).toEqual([]);
});
