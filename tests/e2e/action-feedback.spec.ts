import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, go, reload, watch } from "./helpers";

// Feedback after a click: a filter card lights up, says what it matched and brings the results
// into view; an approval confirms with a toast; a chat bubble tip stands out, and a tip held back
// while the person types waits as a dot on the bubble.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

test("clicking Accounting on Data Health highlights the card, says what matched and scrolls to the issues", async ({ page, context }) => {
  await as(context, "daniel");
  const errors = watch(page);
  await page.setViewportSize({ width: 1280, height: 640 });
  await go(page, `${BASE}/app/data-health`);
  const main = page.locator("#main");
  expect(await main.evaluate((m) => m.scrollTop)).toBe(0);

  const card = page.getByRole("link", { name: /^accounting \d+/i });
  await card.click();
  await expect(page).toHaveURL(/[?&]entity=/);
  await expect(card).toHaveAttribute("aria-current", "true");
  const summary = page.locator("[data-results-summary]").getByRole("status");
  await expect(summary).toContainText(/^Showing [\d,]+ open issues? in Accounting/);
  await expect(summary.getByRole("link", { name: "Clear" })).toBeVisible();
  await expect.poll(() => main.evaluate((m) => m.scrollTop)).toBeGreaterThan(100);
  await expect(summary).toBeInViewport();

  // Clicking the selected card again clears it.
  await main.evaluate((m) => m.scrollTo(0, 0));
  await card.click();
  await expect(page).not.toHaveURL(/[?&]entity=/);
  await expect(card).not.toHaveAttribute("aria-current", "true");
  expect(errors).toEqual([]);
});

test("approving a proposal confirms with a toast", async ({ page, context }) => {
  await as(context, "daniel");
  const errors = watch(page);
  await go(page, `${BASE}/app/ai/approvals?f.risk=Low`);
  const approve = page.locator("article[id^=proposal-]").getByRole("button", { name: /^Approve/ }).and(page.locator(":enabled")).first();
  await approve.click();
  await expect(page.locator("[data-sonner-toast][data-type=success]").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("a tip stands out on a dense list, and a tip held back while typing waits as a dot on the bubble", async ({ page, context }) => {
  await as(context, "daniel");
  const errors = watch(page);
  await go(page, `${BASE}/app/units`);
  await page.evaluate(() => { localStorage.removeItem("pn_guide"); sessionStorage.clear(); });
  await reload(page);

  const nudge = page.locator("[data-guide-nudge]");
  await expect(nudge).toBeVisible();
  const style = await nudge.evaluate((el) => { const s = getComputedStyle(el); return { left: s.borderLeftWidth, shadow: s.boxShadow, size: getComputedStyle(el.querySelector("p")!).fontSize }; });
  expect(style.left).toBe("3px");
  expect(style.shadow).not.toBe("none");
  expect(style.size).toBe("14px");
  await nudge.getByRole("button", { name: "Dismiss suggestion" }).click();

  // A new session on another list: typing in the search box holds the tip back.
  await page.evaluate(() => sessionStorage.clear());
  await go(page, `${BASE}/app/leases`);
  await page.locator("[data-table-search]").focus();
  await expect(page.locator("[data-guide-pending]")).toBeVisible();
  await expect(nudge).toHaveCount(0);
  await page.getByRole("button", { name: "Show a tip from Propniti" }).click();
  await expect(nudge).toBeVisible();
  await expect(page.locator("[data-guide-pending]")).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Ask Propniti" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
