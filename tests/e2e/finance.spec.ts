import { expect, test, type BrowserContext } from "@playwright/test";

// Finance flows as Grace Kim (accountant): home briefing → payables aging drill; AP inbox sample
// invoice with the bank-change hard stop; bill review and GL lines; 1099 prep; budget vs actual
// with an explanation; the plain-words report builder. Run against a dev server: BASE_URL=http://localhost:3201.

const BASE = process.env.BASE_URL ?? "http://localhost:3201";
const TOURS = ["app-basics", "persona-accountant"];

async function as(context: BrowserContext, persona: string) {
  await context.addCookies([{ name: "pn_as", value: persona, url: BASE }]);
  await context.addInitScript((ids: string[]) => localStorage.setItem("pn_tours", JSON.stringify(Object.fromEntries(ids.map((t) => [t, { tour: t, step: 0, status: "Dismissed", updatedAt: "2026-11-04T00:00:00Z" }])))), TOURS);
}

test.beforeEach(async ({ context }) => as(context, "grace"));

test("accountant home shows the briefing, KPIs and drills from payables aging", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${BASE}/app/finance`);
  await expect(page.getByRole("heading", { name: "Good morning, Grace", level: 1 })).toBeVisible();
  await expect(page.getByText("Briefing")).toBeVisible();
  await expect(page.getByText("wait for approval")).toBeVisible();
  for (const k of ["Open payables", "Unreconciled items", "Cash in trust", "Expense vs budget"]) await expect(page.getByText(k).first()).toBeVisible();
  await expect(page.getByText("Cash forecast, 90 days")).toBeVisible();
  await page.getByText("wait for approval").click();
  await expect(page).toHaveURL(/\/app\/payables\/bills\?view=to-approve/, { timeout: 60_000 });
  await expect(page.getByRole("table")).toBeVisible();
  expect(errors).toEqual([]);
});

test("AP inbox reads a sample invoice and stops payment on an unverified bank change", async ({ page }) => {
  await page.goto(`${BASE}/app/finance/ap-inbox`);
  await expect(page.getByRole("heading", { name: /AP inbox/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: /Thermostat and condensate pump/ }).click();
  await expect(page.getByText("hill-country-hvac-70214.png")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/0442/).first()).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Payment hold" })).toBeVisible();
});

test("bill record shows the Payables checks and coded lines", async ({ page }) => {
  await page.goto(`${BASE}/app/payables/bills/BILL-20001`);
  await expect(page.getByText("Payables checks")).toBeVisible();
  await page.getByRole("link", { name: "Lines" }).click();
  await expect(page.getByText(/Landscaping/).first()).toBeVisible();
});

test("1099 preparation finds reportable vendors and budget vs actual explains a variance", async ({ page }) => {
  await page.goto(`${BASE}/app/finance/1099?year=2025`);
  await expect(page.getByText("Reportable pairs")).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await page.goto(`${BASE}/app/finance/budget-vs-actual`);
  await expect(page.getByRole("heading", { name: /Budget vs actual/ })).toBeVisible();
  await page.getByRole("link", { name: /Explain/ }).first().click();
  await expect(page.getByText(/Rule-based|AI/).first()).toBeVisible();
});

test("report builder turns a question into a validated report", async ({ page }) => {
  await page.goto(`${BASE}/app/reports?ask=${encodeURIComponent("show me utilities by property for Q3 vs budget")}`);
  await expect(page.getByText(/Utilities/i).first()).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("button", { name: /Export CSV/ })).toBeVisible();
});

test("reconciliation shows AI-suggested matches and an unexplained deposit; capex flags overruns", async ({ page }) => {
  await page.goto(`${BASE}/app/banking/reconciliations/rec-oe01-trust-2026-10`);
  await expect(page.getByText("Bank statement")).toBeVisible();
  await expect(page.getByRole("button", { name: /Accept match/ }).first()).toBeVisible();
  await expect(page.getByText(/Unexplained deposit/).first()).toBeVisible();
  await page.goto(`${BASE}/app/accounting/capex/cx-4`);
  await expect(page.getByText(/Over budget by/)).toBeVisible();
  await expect(page.getByText("Milestones")).toBeVisible();
});
