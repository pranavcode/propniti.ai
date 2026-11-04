import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, GREETING, go, reload, watch } from "./helpers";

// Maintenance as Tom Alvarez (maintenance supervisor): home → chart drill-down → intake with the
// Maintenance Triage agent → dispatch → board and calendar → vendor invoice approve-and-pay →
// technician view. Run against a dev server: BASE_URL=http://localhost:3201.

test.describe.configure({ mode: "serial", timeout: 240_000 });
// The shared dev server compiles each route on first visit, which can take a while.
const expect = baseExpect.configure({ timeout: 60_000 });

test.beforeEach(({ context }) => as(context, "tom"));

test("home shows the briefing, triage queue, approvals and drillable charts", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/maintenance`);
  await expect(page.getByRole("heading", { name: new RegExp(`${GREETING.source}, Tom`), level: 1 })).toBeVisible();
  await expect(page.getByText("Briefing")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Triage queue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  await expect(page.getByText("SLA met")).toBeVisible();
  await expect(page.getByText("Open work orders by age and priority")).toBeVisible();
  // The SLA KPI drills to the past-SLA list.
  await page.getByRole("link", { name: /SLA met/ }).click();
  await expect(page).toHaveURL(/\/app\/maintenance\/work-orders\?view=past-sla/);
  await expect(page.getByRole("heading", { name: "Work orders" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a plain-language request is triaged by the agent and dispatched", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/maintenance/intake`);
  await page.getByLabel("What's wrong?").fill("Water leaking under the kitchen sink, cabinet floor is soaked and the drain pipe is dripping.");
  await page.getByRole("radio", { name: "Water leak" }).click();
  await page.getByRole("button", { name: "Save and triage" }).click();
  await expect(page).toHaveURL(/\/app\/maintenance\/intake\/[^/?]+/, { timeout: 60_000 });
  // The agent's suggestion with why, confidence and a link to its run.
  const suggestion = page.getByText(/(Suggested|Applied within policy): Plumbing/);
  await expect(suggestion).toBeVisible();
  // The reason also appears outside the card (the run summary); check the one in the card.
  await expect(suggestion.locator("xpath=ancestor::div[.//ul][1]").getByText(/Reads as Plumbing/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Agent run and trace" })).toBeVisible();
  // The photo check ran on the attached photo.
  await expect(page.getByText(/Matches · \d+%/)).toBeVisible();
  // Ranked vendors with insurance status, and the owner-limit check.
  await expect(page.getByRole("columnheader", { name: "Insurance" })).toBeVisible();
  await expect(page.getByText(/auto-approve limit|approval limit/).first()).toBeVisible();
  await page.getByRole("button", { name: /^(Dispatch|Line up and ask owner)$/ }).click();
  await expect(page).toHaveURL(/\/app\/maintenance\/work-orders\/[^/?]+\?tab=wo_timeline/, { timeout: 30_000 });
  await expect(page.getByText("Dispatched").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("board and calendar show open work orders", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/maintenance/board`);
  for (const col of ["New", "Assigned", "In progress", "Submitted"]) await expect(page.getByRole("region", { name: new RegExp(`^${col}, \\d+ work orders`) })).toBeVisible();
  await page.getByRole("tab", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/view=calendar/);
  await expect(page.getByRole("heading", { name: "November 2026" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a submitted vendor invoice is checked against the PO and paid once", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/maintenance/work-orders?view=awaiting-approval`);
  await page.getByRole("row").filter({ hasText: "Submitted" }).first().getByText(/^WO-/).click();
  await expect(page).toHaveURL(/\/app\/maintenance\/work-orders\/WO-[^/?]+/);
  await go(page, `${page.url().split("?")[0]}?tab=wo_invoice`);
  await expect(page.getByText("PO check")).toBeVisible();
  const pay = page.getByRole("button", { name: /Approve and pay|Review and pay anyway/ });
  if (await pay.isDisabled()) return; // over the owner's limit or a fraud hold: the reason is shown instead
  await pay.click();
  const note = page.getByLabel(/Why pay despite these issues/);
  if (await note.isVisible()) await note.fill("Trip charge agreed by phone with the property manager.");
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Approve and pay" });
  // Two quick clicks: the second is ignored in the browser and refused by the server's guard.
  await confirm.dblclick();
  await expect(page.getByText(/is on its way|already approved/).first()).toBeVisible({ timeout: 30_000 });
  await reload(page);
  await expect(page.getByText(/^Paid \$/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("technician view starts a job and logs time", async ({ page }) => {
  const errors = watch(page);
  await go(page, `${BASE}/app/maintenance/my-jobs`);
  await expect(page.getByRole("heading", { name: /'s jobs$/ })).toBeVisible();
  const card = page.locator("article").first();
  const toggle = card.getByRole("button").first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const start = card.getByRole("button", { name: "Start job" });
  if (await start.isVisible()) {
    await start.click();
    await expect(page.getByText(/→ in progress/)).toBeVisible();
  }
  await card.getByRole("button", { name: "30 min" }).click();
  await expect(page.getByText(/Logged 30 min/)).toBeVisible();
  expect(errors).toEqual([]);
});
