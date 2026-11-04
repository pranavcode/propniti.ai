import { expect as baseExpect, test, type Page } from "@playwright/test";
import { as, BASE, go } from "./helpers";

// Layout checks from the production UX audit: no sideways page scroll on a phone, KPI values on one
// line across a row, agent card footers in line, status tabs that switch at once, and last-row
// actions the chat bubble doesn't cover.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

// How far the page or its main scroll area can be scrolled sideways, in pixels.
const sideways = (page: Page) => page.evaluate(() => {
  const main = document.getElementById("main") ?? document.querySelector("main");
  return Math.max(document.documentElement.scrollWidth - innerWidth, main ? main.scrollWidth - main.clientWidth : 0);
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const [persona, url] of [["rachel", "/app/leasing/broker"], ["tom", "/app/maintenance"], ["marcus", "/app/receivables/delinquency"], ["lena", "/app/leasing/today"]] as const) {
    test(`${url} as ${persona} has no sideways scroll at 390px`, async ({ page, context }) => {
      await as(context, persona);
      await go(page, `${BASE}${url}`);
      expect(await sideways(page)).toBeLessThanOrEqual(1);
    });
  }
});
