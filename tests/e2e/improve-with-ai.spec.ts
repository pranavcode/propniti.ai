import { expect, test } from "@playwright/test";
import { as, BASE, go, watch } from "./helpers";

// "Improve with AI" as Priya Shah (regional manager, Texas): the Delinquent KPI on her home is red
// (up on the month), the panel shows the drivers computed from the ledger and a plan of Collections
// agent actions; "Have agents do this" creates the proposals, which wait in Approvals.

test.beforeEach(async ({ context }) => as(context, "priya"));

test("open from a red KPI, see drivers, create the plan and find its proposals in Approvals", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app`);
  const strip = page.getByRole("button", { name: "Improve Delinquent with AI" });
  await expect(strip).toBeVisible();
  await strip.click();

  const panel = page.locator("[data-tour='improve-with-ai-panel']");
  await expect(panel.getByRole("heading", { name: /Delinquent: improve with AI/ })).toBeVisible();
  await expect(panel.getByText("Why it’s red")).toBeVisible();
  await expect(panel.getByText(/past due across \d+ households/)).toBeVisible();
  await expect(panel.getByText(/of the 30\+ day balance is \d+ households at/).first()).toBeVisible();
  await expect(panel.getByText("What agents can do")).toBeVisible();
  await expect(panel.getByText(/Collections agent · Offer payment plan/)).toBeVisible();
  await expect(panel.getByText("Always a person")).toBeVisible();
  await expect(panel.getByText("Computed from your records")).toBeVisible();

  const go1 = panel.getByRole("button", { name: /Have agents do this \(\d+\)/ });
  await go1.click();
  await expect(panel.getByRole("status").filter({ hasText: /Agents proposed \d+ actions?/ })).toBeVisible({ timeout: 60_000 });
  await expect(panel.getByText(/Plan running since/)).toBeVisible();
  // The records just proposed are left out of the next plan: nothing is proposed twice.
  await expect(panel.getByText(/already waiting/).first()).toBeVisible();

  await panel.getByRole("link", { name: /Open approvals/ }).first().click();
  await expect(page).toHaveURL(/\/app\/ai\/approvals\?agent=collections/);
  await expect(page.getByText(/Offer .+ a 3-payment plan/).first()).toBeVisible();
  await expect(page.getByText(/Review .+ for legal action/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("the card shows the plan's progress after the panel closes", async ({ page }) => {
  await go(page, `${BASE}/app`);
  await expect(page.getByRole("button", { name: "Improve Delinquent with AI" })).toContainText(/Plan since .+: \$[\d,]+ paid by \d+ of \d+ households/);
});
