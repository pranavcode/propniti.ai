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
