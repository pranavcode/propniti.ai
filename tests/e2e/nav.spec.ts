import { expect, test, type Page } from "@playwright/test";
import { as, BASE, go } from "./helpers";

// Every sidebar link opens for the persona that sees it: no "isn't part of your role" dead ends.

test.use({ navigationTimeout: 180_000, actionTimeout: 60_000 });
test.setTimeout(900_000);

const STAFF = ["daniel", "priya", "marcus", "lena", "rachel", "grace", "tom", "sam", "nadia"];
const PORTALS = ["owner", "resident", "vendor", "applicant"];
const DENIED = /(isn&#x27;t|aren&#x27;t|isn't|aren't) part of your role|doesn(&#x27;|')t exist or isn(&#x27;|')t part of your role/;

// Opens every collapsed sidebar group, then lists the app links in the sidebar.
async function sidebarLinks(page: Page) {
  const nav = page.locator('nav[aria-label="Main"]');
  for (let i = 0; i < 3; i++) {
    const closed = nav.locator('ul button[aria-expanded="false"]');
    const n = await closed.count();
    for (let j = n - 1; j >= 0; j--) await closed.nth(j).click();
  }
  return [...new Set(await nav.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")!).filter((h) => /^\/(app|portal)(\/|$)/.test(h))))];
}

for (const persona of [...STAFF, ...PORTALS]) {
  test(`${persona}: every sidebar link opens`, async ({ page, context }) => {
    await as(context, persona);
    const portal = PORTALS.includes(persona);
    await go(page, portal ? `/portal/${persona}` : "/app");
    const links = portal
      ? [...new Set(await page.locator("a[href^='/portal/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!.split("?")[0]!)))]
      : await sidebarLinks(page);
    expect(links.length).toBeGreaterThan(0);
    const dead: string[] = [];
    for (const href of links) {
      const res = await page.request.get(BASE + href);
      if (res.status() >= 400 || DENIED.test(await res.text())) dead.push(`${href} (${res.status()})`);
    }
    expect(dead, `dead ends for ${persona}`).toEqual([]);
  });
}

// The persona's home is in the sidebar and highlighted.
const HOMES: Record<string, string> = { daniel: "/app", priya: "/app", marcus: "/app/today", lena: "/app/leasing/today", rachel: "/app/leasing/broker", grace: "/app/finance", tom: "/app/maintenance", sam: "/app/admin", nadia: "/app/admin" };
for (const [persona, home] of Object.entries(HOMES)) {
  test(`${persona}: home ${home} is in the sidebar and highlighted`, async ({ page, context }) => {
    await as(context, persona);
    await go(page, home);
    await expect(page.locator(`nav[aria-label="Main"] a[href="${home}"][aria-current="page"]`)).toBeVisible();
  });
}

test("the section and group holding the current page open, other saved-closed sections stay closed", async ({ page, context }) => {
  await as(context, "tom");
  await go(page, "/app");
  await page.evaluate(() => { localStorage.setItem("pn_nav_groups", "[]"); localStorage.setItem("pn_nav_closed", JSON.stringify(["operations", "intelligence"])); });
  await go(page, "/app/maintenance/work-orders");
  const nav = page.locator('nav[aria-label="Main"]');
  await expect(nav.getByRole("button", { name: "Operations" })).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("button", { name: /^Maintenance/ })).toHaveAttribute("aria-expanded", "true");
  await expect(nav.locator('a[href="/app/maintenance/work-orders"][aria-current="page"]')).toBeVisible();
  await expect(nav.getByRole("button", { name: /AI agents/ })).toHaveAttribute("aria-expanded", "false");
  // Closing the open section by hand still works.
  await nav.getByRole("button", { name: "Operations" }).click();
  await expect(nav.getByRole("button", { name: "Operations" })).toHaveAttribute("aria-expanded", "false");
  // A record page under the list keeps the list highlighted.
  await nav.getByRole("button", { name: "Operations" }).click();
  const href = await page.locator("main a[href^='/app/maintenance/work-orders/']").first().getAttribute("href");
  await go(page, href!);
  await expect(nav.locator('a[href="/app/maintenance/work-orders"][aria-current="page"]')).toBeVisible();
});

test("a record page has one breadcrumb, and a payment's title doesn't repeat its method", async ({ page, context }) => {
  await as(context, "grace");
  await go(page, "/app/receivables/payments?f.method=ACH");
  const href = await page.locator("main a[href^='/app/receivables/payments/']").first().getAttribute("href");
  await go(page, href!);
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs).toHaveCount(1);
  await expect(page.locator("main").getByRole("link", { name: "Payments", exact: true })).toHaveCount(0);
  await expect(page.locator("main h1")).not.toContainText("ACH · ACH");
  await expect(crumbs).not.toContainText("ACH · ACH");
});
