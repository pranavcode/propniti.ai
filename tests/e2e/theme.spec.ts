import { expect, test, type Page } from "@playwright/test";
import { as, BASE } from "./helpers";

// The theme is set by an inline script before the first paint, not after the app's JavaScript
// loads: with every script file blocked, a dark page is already dark. Staff app and portals share
// the pn_theme cookie; with no choice made they follow the OS.

test.use({ navigationTimeout: 180_000 });

async function firstPaint(page: Page, path: string) {
  await page.route("**/*", (r) => (r.request().resourceType() === "script" ? r.abort() : r.continue()));
  await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  return page.evaluate(() => ({ html: document.documentElement.classList.contains("dark"), root: document.querySelector("div[data-surface]")!.classList.contains("dark") }));
}

for (const [persona, path] of [["marcus", "/app/today"], ["owner", "/portal/owner"], ["resident", "/portal/resident"]] as const) {
  test(`${path}: follows the OS with no choice made, before any script file loads`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    await as(context, persona);
    expect(await firstPaint(await context.newPage(), path)).toEqual({ html: true, root: true });
    await context.close();
  });

  test(`${path}: an explicit light choice wins over a dark OS`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    await as(context, persona);
    await context.addCookies([{ name: "pn_theme", value: "light", url: BASE }]);
    expect(await firstPaint(await context.newPage(), path)).toEqual({ html: false, root: false });
    await context.close();
  });
}

test("a portal opened from a dark staff app is dark from the first paint", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "light" });
  await as(context, "owner");
  await context.addCookies([{ name: "pn_theme", value: "dark", url: BASE }]);
  expect(await firstPaint(await context.newPage(), "/portal/owner")).toEqual({ html: true, root: true });
  await context.close();
});
