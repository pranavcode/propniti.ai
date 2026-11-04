import { expect, test, type Locator } from "@playwright/test";
import { as, go } from "./helpers";

// Definitions on jargon labels, and the KPI and chart card layout on the principal's portfolio page.

const box = async (l: Locator) => (await l.boundingBox())!;
const midY = async (l: Locator) => { const b = await box(l); return b.y + b.height / 2; };
const card = (l: Locator, cls: string) => l.locator(`xpath=ancestor::div[contains(@class,"${cls}")][1]`);

test.beforeEach(async ({ context, page }) => {
  await as(context, "daniel");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go(page, "/app/portfolio");
});

test("hovering Economic occupancy shows its definition", async ({ page }) => {
  await page.locator('[data-term="Economic occupancy"]').first().hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("gross potential rent");
  await expect(tip.getByRole("link", { name: /Learn more/ })).toHaveAttribute("href", "/app/help/occupancy");
});

test("keyboard focus opens a definition and Escape closes it", async ({ page }) => {
  const term = page.locator('[data-term="Vacancy loss"]').first();
  await term.focus();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText("units sat empty");
  const described = await term.getAttribute("aria-describedby");
  await expect(page.locator(`[id="${described}"]`)).toHaveText(/units sat empty/);
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
});

test("the help article behind Learn more opens", async ({ page }) => {
  await go(page, "/app/help/occupancy");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("KPI header items share one centre line and every drilling card shows its arrow", async ({ page }) => {
  for (const label of ["NOI", "Occupancy", "Vacancy loss", "Economic occupancy"]) {
    const term = page.locator(`[data-term="${label}"]`).first();
    const kpi = card(term, "group/kpi");
    const explain = kpi.getByRole("button", { name: `Explain ${label}` });
    const arrow = kpi.locator("svg.lucide-arrow-up-right");
    await expect(arrow).toBeVisible();
    const y = await midY(term);
    expect(Math.abs((await midY(explain)) - y), `${label} Explain`).toBeLessThanOrEqual(1);
    expect(Math.abs((await midY(arrow)) - y), `${label} arrow`).toBeLessThanOrEqual(1);
  }
});

test("cards in one row have equal heights", async ({ page }) => {
  const kpis = await Promise.all(["NOI", "Occupancy", "Vacancy loss", "Economic occupancy"].map(async (l) => box(card(page.locator(`[data-term="${l}"]`).first(), "group/kpi").locator(".."))));
  for (const b of kpis) expect(Math.abs(b.height - kpis[0]!.height)).toBeLessThanOrEqual(1);

  const chart = (title: string) => card(page.getByRole("heading", { name: title, exact: true }), "rounded-lg");
  const [noi, units] = await Promise.all([box(chart("NOI vs budget")), box(chart("Units by status"))]);
  expect(Math.abs(noi.y - units.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(noi.height - units.height)).toBeLessThanOrEqual(1);
});
