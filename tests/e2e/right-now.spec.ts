import { expect as baseExpect, test, type Page } from "@playwright/test";
import { as, BASE, go, reload, watch } from "./helpers";

// "Right now" at the top of the Ask Propniti panel: items from GET /api/guide for this persona,
// one click each, hidden for the day per persona.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

async function openDock(page: Page) {
  const dock = page.getByRole("complementary", { name: "Ask Propniti" });
  if (!(await dock.isVisible())) await page.keyboard.press("ControlOrMeta+j");
  await expect(dock).toBeVisible();
  return dock;
}

test("Right now lists the persona's items from the route and hides for today", async ({ page, context }) => {
  const errors = watch(page);
  await as(context, "marcus");
  await go(page, `${BASE}/app/today`);
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("pn_ai_now_hidden:")) localStorage.removeItem(k); sessionStorage.clear(); });
  const facts = await (await page.request.get(`${BASE}/api/guide`)).json();
  expect(facts.approvals).toBeGreaterThan(0);

  const dock = await openDock(page);
  const now = dock.getByRole("region", { name: "Right now" });
  await expect(now).toBeVisible();
  await expect(now.getByText(`${facts.approvals.toLocaleString("en-US")} approval${facts.approvals === 1 ? " is" : "s are"} waiting for you`)).toBeVisible();
  if (facts.remind?.residents) await expect(now.getByRole("button", { name: "Draft reminders" })).toBeVisible();
  expect(await now.locator("li").count()).toBeLessThanOrEqual(3);

  await now.getByRole("button", { name: "Hide for today" }).click();
  await expect(now).toBeHidden();
  await reload(page);
  await openDock(page);
  await page.waitForTimeout(2000);
  await expect(page.getByRole("region", { name: "Right now" })).toHaveCount(0);

  // Another persona has their own items and their own "hide".
  await as(context, "daniel");
  await go(page, `${BASE}/app/today`);
  await openDock(page);
  await expect(page.getByRole("region", { name: "Right now" })).toBeVisible();
  expect(errors).toEqual([]);
});
