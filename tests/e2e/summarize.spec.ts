import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, go, reload, watch } from "./helpers";

// "Summarize with AI" on a work order with no stored summary, as Tom (maintenance supervisor):
// on the full record page and in the peek drawer. Completed jobs aren't precomputed, so they start
// empty. The summary is labelled with its source and is still there after a reload.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });
const LABEL = /Rules · from this record's current figures|Generated · /;

test.beforeEach(({ context }) => as(context, "tom"));

test("a work order with no summary gets one from the record page, and keeps it on reload", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/maintenance/work-orders?f.status=Completed&sort=-opened_at`);
  const id = (await page.locator("tbody a[data-peek-id]").first().getAttribute("data-peek-id"))!;
  await go(page, `${BASE}/app/maintenance/work-orders/${encodeURIComponent(id)}`);
  const card = page.locator("section", { has: page.getByRole("heading", { name: "AI summary" }) });
  await expect(card.getByText("No summary yet for this work order.")).toBeVisible();
  await card.getByRole("button", { name: "Summarize with AI" }).click();
  await expect(card.getByText(LABEL)).toBeVisible();
  await expect(card.getByRole("button", { name: "Summarize with AI" })).toBeHidden();

  await reload(page);
  await expect(card.getByText(LABEL)).toBeVisible();
  await expect(card.getByText("No summary yet")).toBeHidden();
  expect(errors).toEqual([]);
});

test("the peek drawer summarizes a work order in place", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/maintenance/work-orders?f.status=Completed&sort=-opened_at`);
  await page.locator("tbody a[data-peek-id]").nth(1).click();
  const drawer = page.locator("[data-peek-drawer]");
  const card = drawer.locator("section", { has: page.getByRole("heading", { name: "AI summary" }) });
  await expect(card.getByText("No summary yet for this work order.")).toBeVisible();
  await card.getByRole("button", { name: "Summarize with AI" }).click();
  await expect(card.getByText(LABEL)).toBeVisible();
  await expect(card.getByText("No summary yet")).toBeHidden();
  expect(errors).toEqual([]);
});
