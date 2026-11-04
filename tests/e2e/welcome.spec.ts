import { expect as baseExpect, test, type Page } from "@playwright/test";
import { as, BASE, go, GREETING, reload, watch } from "./helpers";

// The home welcome splash and the new-feature hints as Daniel (principal): the splash greets on the
// first home visit, stays away for the rest of the day once dismissed, comes back from Help and
// starts the basics tour; once it closes, Ask Propniti opens on its own, once that day; Inbox
// carries a "new" dot until its first visit, which offers its tour once.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

test.beforeEach(({ context }) => as(context, "daniel"));

// Global setup turns the splash, the dots and the tours off for every spec; undo that for these.
async function fresh(page: Page, tips = false) {
  await page.evaluate((tips) => {
    if (tips) localStorage.removeItem("pn_guide");
    localStorage.removeItem("pn_ask_auto");
    localStorage.removeItem("pn_welcome");
    localStorage.removeItem("pn_whats_new");
    const tours = JSON.parse(localStorage.getItem("pn_tours") ?? "{}");
    delete tours["app-basics"];
    delete tours["feature-inbox"];
    localStorage.setItem("pn_tours", JSON.stringify(tours));
  }, tips);
}

test("the splash greets on the first home visit, stays dismissed that day, and its button starts the tour", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/properties`);
  await fresh(page, true);
  await go(page, `${BASE}/app`);

  const splash = page.locator("[data-welcome-splash]");
  await expect(splash).toBeVisible();
  await expect(splash.getByRole("heading", { name: GREETING })).toBeVisible();
  await expect(splash.getByText("What's new")).toBeVisible();
  await expect(splash.getByText("Inbox", { exact: true })).toBeVisible();
  // "Waiting for you" items are worded from counts and open the records behind them.
  const item = splash.getByRole("link").first();
  await expect(item).toHaveText(/^\$?[\d,]+ /);
  await expect(item).toHaveAttribute("href", /^\/app\//);
  // No first-visit tour behind it.
  await expect(page.getByRole("dialog", { name: /Getting around Propniti/ })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(splash).toBeHidden();
  // Once the splash is gone, Ask Propniti opens on its own, once for the day.
  const panel = page.getByRole("complementary", { name: "Ask Propniti" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Close assistant" }).click();
  await expect(panel).toBeHidden();
  await reload(page);
  await page.waitForTimeout(3000);
  await expect(splash).toHaveCount(0);
  await expect(panel).toBeHidden();

  await page.getByRole("button", { name: "Help" }).click();
  await page.getByRole("menuitem", { name: "Show welcome screen" }).click();
  await expect(splash).toBeVisible();
  await splash.getByRole("button", { name: "Take the 2-minute tour" }).click();
  await expect(splash).toBeHidden();
  const tour = page.getByRole("dialog", { name: /^Getting around Propniti: step 1 of/ });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Skip tour" }).click();
  await expect(tour).toBeHidden();
  expect(errors).toEqual([]);
});

test("Inbox is marked new until its first visit, which offers its tour once", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/properties`);
  await fresh(page);
  await reload(page);

  const inbox = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Inbox/ });
  await expect(inbox.locator("[data-new-dot]")).toBeVisible();
  await go(page, `${BASE}/app/inbox`);
  await expect(inbox.locator("[data-new-dot]")).toHaveCount(0);

  const toast = page.locator("[data-feature-toast]");
  await expect(toast).toContainText("New: Inbox — take a 30-second tour?");
  await toast.getByRole("button", { name: "Start tour" }).click();
  await expect(toast).toHaveCount(0);
  const tour = page.getByRole("dialog", { name: /^Inbox: step \d of 4/ });
  await expect(page.getByRole("dialog", { name: "Inbox: step 1 of 4" })).toBeVisible();
  for (let i = 0; i < 4; i++) await tour.getByRole("button", { name: /^(Start tour|Next|Done)$/ }).click();
  await expect(tour).toHaveCount(0);

  await reload(page);
  await page.waitForTimeout(4000);
  await expect(toast).toHaveCount(0);
  await expect(inbox.locator("[data-new-dot]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a page tour offer sits over the sidebar's foot, comes once a session, and never as a toast on a phone", async ({ page, browser }) => {
  await go(page, `${BASE}/app/units`);
  await page.evaluate(() => localStorage.removeItem("pn_tours"));
  await reload(page);
  const toast = page.locator("[data-feature-toast]");
  await expect(toast).toBeVisible();
  const box = (await toast.boundingBox())!;
  const nav = (await page.getByRole("navigation", { name: "Main" }).boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(nav.x + nav.width);
  await toast.getByRole("button", { name: "Not now" }).click();
  await go(page, `${BASE}/app/maintenance/work-orders`);
  await page.waitForTimeout(4000);
  await expect(toast).toHaveCount(0);

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await as(phone, "daniel");
  const p = await phone.newPage();
  await go(p, `${BASE}/app/units`);
  await p.waitForTimeout(4000);
  await expect(p.locator("[data-feature-toast]")).toHaveCount(0);
  await phone.close();
});

test("a tour offer held back in the bubble isn't spent until it's shown", async ({ browser }) => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await as(phone, "daniel");
  // Nothing waiting, so the bubble's tip is the page's tour offer.
  await phone.addInitScript(() => sessionStorage.setItem("pn_guide_facts", JSON.stringify({ persona: "daniel", at: Date.now(), facts: { approvals: 0, pastDue: { cents: 0, properties: 0 }, dataIssues: { critical: 0 } } })));
  const p = await phone.newPage();
  const errors = watch(p);
  await go(p, `${BASE}/app/units`);
  // The run's storage state turns tips off and marks every tour dismissed; undo both.
  await p.evaluate(() => { localStorage.removeItem("pn_guide"); localStorage.removeItem("pn_tours"); });
  await reload(p);
  await p.locator("[data-table-search]").focus();
  await expect(p.locator("[data-guide-pending]")).toBeVisible();
  const spent = () => p.evaluate(() => ({ offers: JSON.parse(localStorage.getItem("pn_whats_new") ?? "{}").offers ?? {}, session: sessionStorage.getItem("pn_offer_session") }));
  expect(await spent()).toEqual({ offers: {}, session: null });

  await p.getByRole("button", { name: "Show a tip from Propniti" }).click();
  const nudge = p.locator("[data-guide-nudge]");
  await expect(nudge.getByRole("button", { name: "Start tour" })).toBeVisible();
  const after = await spent();
  expect(Object.values(after.offers)).toEqual(["shown"]);
  expect(after.session).toBe("1");
  expect(errors).toEqual([]);
  await phone.close();
});
