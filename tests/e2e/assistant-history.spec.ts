import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import { as, BASE, go, reload, watch } from "./helpers";

// The ⌘J panel keeps each persona's conversation: a reload reopens it, another persona sees only
// their own history, and an older thread reopens from "Recent conversations".

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

// A question in the conversation (not the suggestion button with the same words).
const asked = (dock: Locator, q: string) => dock.locator("[data-turn=user]").getByText(q, { exact: true });
const dockOf = (page: Page) => page.getByRole("complementary", { name: "Ask Propniti" });

async function openDock(page: Page) {
  const dock = dockOf(page);
  if (!(await dock.isVisible())) await page.keyboard.press("ControlOrMeta+j");
  await expect(dock).toBeVisible();
  return dock;
}

async function askInDock(page: Page, question: string) {
  const dock = await openDock(page);
  const box = dock.getByRole("textbox", { name: "Ask Propniti" });
  await expect(box).toBeEnabled();
  await box.fill(question);
  await box.press("Enter");
  await expect(dock.locator("[data-assistant-busy]")).toBeHidden();
  await expect(dock.locator(".rounded-lg.border.bg-card").last()).toBeVisible();
  return dock;
}

test("a reload reopens the conversation; another persona sees only their own; Recent reopens an older one", async ({ page, context }) => {
  const errors = watch(page);
  await as(context, "marcus");
  await go(page, `${BASE}/app/today`);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("pn_ai_thread:")) localStorage.removeItem(k); });

  let dock = await askInDock(page, "Who is late on rent?");
  await expect(dock.getByText(/late, owing|is late|are late|Nobody/).first()).toBeVisible();
  await askInDock(page, "Which work orders are open?");

  // Reload: the panel stays open and the same two questions come back from the server.
  await reload(page);
  dock = await openDock(page);
  await expect(asked(dock, "Who is late on rent?")).toBeVisible();
  await expect(asked(dock, "Which work orders are open?")).toBeVisible();

  // Start a new conversation; the first one stays in Recent.
  await dock.getByRole("button", { name: "New conversation" }).click();
  await expect(asked(dock, "Who is late on rent?")).toHaveCount(0);
  await askInDock(page, "How do I post a late fee?");
  await reload(page);
  dock = await openDock(page);
  await expect(asked(dock, "How do I post a late fee?")).toBeVisible();
  await expect(asked(dock, "Who is late on rent?")).toHaveCount(0);

  await page.getByRole("button", { name: "Recent conversations" }).click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: /How do I post a late fee\?/ })).toBeVisible();
  await menu.getByRole("menuitem", { name: /Who is late on rent\?/ }).click();
  await expect(asked(dock, "Who is late on rent?")).toBeVisible();
  await expect(asked(dock, "Which work orders are open?")).toBeVisible();
  await expect(asked(dock, "How do I post a late fee?")).toHaveCount(0);

  // Another persona in the same browser: their own (empty) history, not Marcus's.
  await as(context, "lena");
  await go(page, `${BASE}/app/today`);
  dock = await openDock(page);
  await expect(dock.getByText(/What can I help with/)).toBeVisible();
  await expect(asked(dock, "Who is late on rent?")).toHaveCount(0);
  await page.getByRole("button", { name: "Recent conversations" }).click();
  await expect(page.getByRole("menu").getByText("No conversations yet today.")).toBeVisible();
  await page.keyboard.press("Escape");

  // Back to Marcus: his last opened thread is still there.
  await as(context, "marcus");
  await go(page, `${BASE}/app/today`);
  dock = await openDock(page);
  await expect(asked(dock, "Who is late on rent?")).toBeVisible();
  expect(errors).toEqual([]);
});

test("a remembered thread that no longer exists starts fresh with a note", async ({ page, context }) => {
  const errors = watch(page);
  await as(context, "marcus");
  await go(page, `${BASE}/app/today`);
  await page.evaluate(() => localStorage.setItem("pn_ai_thread:marcus", "thr-cleared-by-reset"));
  await reload(page);
  const dock = await openDock(page);
  await expect(dock.getByText(/cleared with the nightly demo reset/)).toBeVisible();
  await expect(dock.getByText(/What can I help with/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("pn_ai_thread:marcus"))).toBeNull();
  expect(errors.filter((e) => !/404/.test(e))).toEqual([]);
});
