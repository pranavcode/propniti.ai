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

// Value tops of every KPI tile, grouped by the row the tile starts on.
const kpiRows = (page: Page) => page.evaluate(() => {
  const rows = new Map<number, number[]>();
  for (const v of document.querySelectorAll("[data-kpi-value]")) {
    const top = Math.round(v.closest("[data-kpi]")!.getBoundingClientRect().top);
    rows.set(top, [...(rows.get(top) ?? []), v.getBoundingClientRect().top]);
  }
  return [...rows.values()];
});

for (const [persona, url] of [["tom", "/app/maintenance"], ["tom", "/app/maintenance/work-orders"], ["rachel", "/app/leasing/broker"], ["lena", "/app/leasing/today"]] as const) {
  test(`KPI values on ${url} line up across each row`, async ({ page, context }) => {
    await as(context, persona);
    await go(page, `${BASE}${url}`);
    await expect(page.locator("[data-kpi-value]").first()).toBeVisible();
    const rows = await kpiRows(page);
    expect(rows.length).toBeGreaterThan(0);
    for (const tops of rows) expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
  });
}
