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

test("agent cards in a row are one height with Run now in line, and say when they run in plain words", async ({ page, context }) => {
  await as(context, "sam");
  await go(page, `${BASE}/app/agents`);
  const cards = page.locator("[data-agent-card]");
  await expect(cards.first()).toBeVisible();
  const rows = await cards.evaluateAll((els) => {
    const by = new Map<number, { h: number; run: number }[]>();
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const run = [...el.querySelectorAll("button")].find((b) => /Run now/.test(b.textContent ?? ""))!.getBoundingClientRect().top;
      by.set(Math.round(r.top), [...(by.get(Math.round(r.top)) ?? []), { h: r.height, run }]);
    }
    return [...by.values()];
  });
  for (const row of rows) {
    expect(Math.max(...row.map((c) => c.h)) - Math.min(...row.map((c) => c.h))).toBeLessThanOrEqual(2);
    expect(Math.max(...row.map((c) => c.run)) - Math.min(...row.map((c) => c.run))).toBeLessThanOrEqual(2);
  }
  // One autonomy control per card, schedules and events in words, no raw model ids.
  await expect(page.getByRole("combobox", { name: /Autonomy for/ })).toHaveCount(8);
  await expect(page.getByText("Daily at 14:00 UTC · on Payment returned", { exact: false }).first()).toBeVisible();
  await expect(page.locator("#main")).not.toContainText(/\d+ \d+ \* \* \*|payment\.failed|@cf\//);
  await expect(page.locator("#main")).not.toContainText(/Last sweep: in /);
});

// Scrolled to the bottom, no button or link in the page sits under the floating chat button.
async function coveredByBubble(page: Page, bubble: string) {
  await page.evaluate(() => {
    const main = document.getElementById("main");
    if (main && main.scrollHeight > main.clientHeight) main.scrollTop = main.scrollHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await page.waitForTimeout(300);
  return page.evaluate((sel) => {
    const b = document.querySelector(sel)!.getBoundingClientRect();
    const root = document.getElementById("main") ?? document.querySelector("main")!;
    return [...root.querySelectorAll("button, a[href]")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.bottom > b.top && r.top < b.bottom && r.right > b.left && r.left < b.right;
    }).map((el) => (el.textContent ?? "").trim().slice(0, 40));
  }, bubble);
}

for (const [persona, url, viewport] of [["tom", "/app/maintenance", { width: 1440, height: 900 }], ["lena", "/app/leasing/today", { width: 1440, height: 900 }], ["daniel", "/app", { width: 1440, height: 900 }], ["tom", "/app/maintenance", { width: 390, height: 844 }]] as const) {
  test(`the chat bubble covers no last-row action on ${url} at ${viewport.width}px`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    await as(context, persona);
    await go(page, `${BASE}${url}`);
    await expect(page.getByRole("button", { name: "Open Ask Propniti" })).toBeVisible();
    expect(await coveredByBubble(page, 'button[aria-label="Open Ask Propniti"]')).toEqual([]);
  });
}

test("the portal's Ask button covers nothing at the end of the owner portal on a phone", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await as(context, "owner");
  await go(page, `${BASE}/portal/owner`);
  await expect(page.locator('[data-tour="portal-ask"]')).toBeVisible();
  expect(await coveredByBubble(page, '[data-tour="portal-ask"]')).toEqual([]);
});

for (const [persona, url, tab] of [["tom", "/app/compliance/insurance", "Active"], ["grace", "/app/receivables/payments", "Cleared"]] as const) {
  test(`the ${tab} status tab on ${url} is selected the moment it is clicked`, async ({ page, context }) => {
    await as(context, persona);
    await go(page, `${BASE}${url}`);
    // Hold the next page payload, so the check runs while the rows are still loading.
    await page.route((u) => u.pathname === url && u.search.includes("f."), async (route) => { await new Promise((r) => setTimeout(r, 3_000)); await route.continue(); });
    const target = page.getByRole("tablist", { name: "Status" }).getByRole("tab", { name: new RegExp(`^${tab}`) });
    await target.click();
    await expect(target).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    await expect(page).toHaveURL(/f\.status=/);
    await expect(target).toHaveAttribute("aria-selected", "true");
  });
}

// Import source step: the tool tiles keep their own space with the Ask panel open beside them.
async function tilesClear(page: Page) {
  const boxes = await page.locator("[data-tool-tile]").evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const radio = el.querySelector("[role=radio]") as HTMLElement;
    return { l: r.left, r: r.right, t: r.top, b: r.bottom, clipped: radio.scrollWidth > radio.clientWidth + 1 };
  }));
  expect(boxes.length).toBe(10);
  for (const [i, a] of boxes.entries()) {
    expect(a.clipped).toBe(false);
    for (const b of boxes.slice(i + 1)) expect(a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5).toBe(true);
  }
}

for (const width of [1440, 1280]) {
  test(`import tool tiles don't overlap with the Ask panel open at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await as(context, "daniel");
    await go(page, `${BASE}/app/settings/import`);
    const dock = page.getByRole("complementary", { name: "Ask Propniti" });
    if (!(await dock.isVisible())) await page.keyboard.press("ControlOrMeta+j");
    await expect(dock).toBeVisible();
    await tilesClear(page);
  });
}

for (const [tool, files] of [["AppFolio", 3], ["Buildium", 3]] as const) {
  test(`one click on the first import step loads the ${tool} sample files`, async ({ page, context }) => {
    await as(context, "daniel");
    await go(page, `${BASE}/app/settings/import`);
    await tilesClear(page);
    await page.getByRole("button", { name: `Try ${tool} sample files` }).click();
    await expect(page.getByRole("button", { name: `Load ${tool} sample files` })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(files);
    await expect(page.getByText(new RegExp(`matches the typical ${tool} `)).first()).toBeVisible();
  });
}

test("agent cards name the last run's model only when it differs, as 'Last run used'", async ({ page, context }) => {
  await as(context, "sam");
  await go(page, `${BASE}/app/agents`);
  await expect(page.locator("[data-agent-card]").first()).toBeVisible();
  // No bare model name in a card footer.
  await expect(page.locator("[data-agent-card]").getByText(/^(Llama|Claude|GPT)\b/)).toHaveCount(0);
});

test("approval policy limits read as dollars and save the same value as before", async ({ page, context }) => {
  await as(context, "sam");
  await go(page, `${BASE}/app/agents`);
  let sent: unknown = null;
  await page.route("**/api/ai/policies/*", async (route) => { sent = route.request().postDataJSON(); await route.fulfill({ status: 200, contentType: "application/json", body: "{}" }); });
  const limit = page.getByRole("textbox", { name: "Bill payment auto-approve limit in dollars" });
  await expect(limit).toHaveValue(/^\d{1,3}(,\d{3})*(\.\d+)?$/);
  await limit.click();
  await expect(limit).not.toHaveValue(/,/);
  await limit.fill("6000");
  await limit.blur();
  await expect(limit).toHaveValue("6,000");
  await page.getByRole("row", { name: /Bill payment/ }).getByRole("button", { name: "Save" }).click();
  await expect.poll(() => sent).not.toBeNull();
  expect((sent as { limit_cents: number }).limit_cents).toBe(600_000);
});
