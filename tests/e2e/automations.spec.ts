import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, go, watch } from "./helpers";

// Automations: what runs on its own, when, and under which rules. Agents table with drill-downs,
// event triggers, approval rules and the rules built into the product; edits follow the role.

test.use({ navigationTimeout: 180_000, actionTimeout: 60_000 });
test.setTimeout(300_000);
const expect = baseExpect.configure({ timeout: 60_000 });

const AGENTS = ["Collections agent", "Leasing agent", "Renewals agent", "Maintenance triage agent", "Payables agent", "Data Health agent", "Owner Reporting agent", "Compliance agent"];

test("principal sees every automation, changes autonomy and drills into an agent's runs", async ({ page, context }) => {
  await as(context, "daniel");
  const errors = watch(page);
  await go(page, `${BASE}/app/automations`);
  await expect(page.getByRole("heading", { name: "Automations", level: 1 })).toBeVisible();
  await expect(page.getByText(/Sweep every 15 min/)).toBeVisible();

  const agents = page.getByRole("table", { name: "Agents" });
  for (const name of AGENTS) await expect(agents.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(agents.getByText("Daily at 14:00")).toBeVisible();

  await expect(page.getByRole("table", { name: "Event triggers" }).getByText("Rent overdue")).toBeVisible();
  const rules = page.getByRole("table", { name: "Approval rules" });
  await expect(rules.getByText("Legal")).toBeVisible();
  await expect(rules.getByText("Always a person").first()).toBeVisible();
  await expect(page.getByRole("table", { name: "Rules built into the product" }).getByText(/Late fee/)).toBeVisible();

  // Autonomy uses the Agents page's setting and the same two levels; change it and put it back.
  const select = page.getByRole("combobox", { name: "Autonomy for Collections agent" });
  await expect(select).toHaveText(/Approve first/);
  await select.click();
  await page.getByRole("option", { name: "Auto within policy" }).click();
  await expect(page.getByText("Saved and logged to the audit trail")).toBeVisible();
  await select.click();
  await page.getByRole("option", { name: "Approve first" }).click();
  await expect(select).toHaveText(/Approve first/);

  await agents.getByRole("link", { name: "Collections agent", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/ai\/activity\?agent=collections/);
  await expect(page.getByRole("heading", { name: "AI activity" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("admin reads autonomy and edits approval policies in settings", async ({ page, context }) => {
  await as(context, "sam");
  const errors = watch(page);
  await go(page, `${BASE}/app/automations`);
  await expect(page.getByRole("heading", { name: "Automations", level: 1 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Autonomy for/ })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Agents" }).getByText("Auto within policy").first()).toBeVisible();
  await page.getByRole("link", { name: "Edit approval policies" }).click();
  await expect(page).toHaveURL(/\/app\/settings\/approvals$/);
  expect(errors).toEqual([]);
});

test("property manager sees the same automations without settings links", async ({ page, context }) => {
  await as(context, "marcus");
  const errors = watch(page);
  await go(page, `${BASE}/app/automations`);
  await expect(page.getByRole("heading", { name: "Automations", level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Agents" }).getByRole("link", { name: "Compliance agent", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Autonomy for Compliance agent" })).toBeVisible();
  await expect(page.locator("main a[href^='/app/settings']")).toHaveCount(0);
  expect(errors).toEqual([]);
});
