import { expect as baseExpect, test, type Page } from "@playwright/test";
import { as as asPersona, go, watch } from "./helpers";

// The shared dev server compiles pages on first visit, which can take well over the 5 s default.
const expect = baseExpect.configure({ timeout: 60_000 });

// Receivables flows in a real browser, in the run's shared demo workspace.
async function as(page: Page, persona: string) {
  await asPersona(page.context(), persona);
  return watch(page);
}

test.describe.configure({ timeout: 300_000 });

test("aging drills from a cell to the residents, a ledger and the charges behind a figure", async ({ page }) => {
  const errors = await as(page, "grace");
  await go(page, "/app/receivables/delinquency");
  await expect(page.getByRole("heading", { name: "Delinquency aging" })).toBeVisible();
  await page.getByRole("link", { name: /^Residents: .*90\+ days/ }).first().click();
  await expect(page.getByRole("heading", { name: "Delinquent residents" })).toBeVisible();
  await page.getByRole("link", { name: "Ledger →" }).first().click();
  await expect(page.getByText("Resident ledger:")).toBeVisible();
  await page.getByRole("link", { name: /Past due/ }).click();
  await expect(page).toHaveURL(/receivables\/charges\?.*f\.status=Overdue/);
  expect(errors).toEqual([]);
});

test("record payment: a double click records one payment", async ({ page }) => {
  const errors = await as(page, "marcus");
  await go(page, "/app/receivables/record-payment");
  await page.getByRole("button", { name: "Record payment" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Amount received").fill("25.00");
  await dialog.getByLabel("Reference").fill("Check #1001");
  const submit = dialog.getByRole("button", { name: /Record \$25\.00/ });
  await submit.dblclick();
  await expect(page.getByText(/Recorded \$25\.00 against/)).toBeVisible();
  await expect(page.getByText(/Recorded \$25\.00 against/)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("collections workbench explains each score and drafts in English or Spanish", async ({ page }) => {
  const errors = await as(page, "marcus");
  await go(page, "/app/receivables/collections?step=reminder");
  await expect(page.getByRole("heading", { name: "Collections" })).toBeVisible();
  await expect(page.getByText("Why this score")).toBeVisible();
  await page.getByRole("radio", { name: "Español" }).first().click();
  await expect(page.getByText(/Recordatorio de pago/).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("deposit disposition: itemise, send once, settled", async ({ page }) => {
  const errors = await as(page, "grace");
  await go(page, "/app/receivables/deposits?view=due");
  await page.getByRole("row").nth(1).getByRole("cell").first().click();
  await expect(page).toHaveURL(/receivables\/deposits\/dep-/);
  // The row opens the record by client navigation; wait for the form before reading its state.
  await expect(page.getByRole("button", { name: /Send disposition and refund/ })).toBeVisible();
  // Open charges come pre-selected up to the deposit; clear them so a damage line fits.
  const checked = page.getByRole("checkbox", { checked: true });
  while (await checked.count()) await checked.first().click();
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByLabel("Damage description").fill("Carpet cleaning, bedroom 2");
  await page.getByLabel("Damage amount").fill("125");
  await page.getByRole("button", { name: /Send disposition and refund/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Send and refund/ }).click();
  await expect(page.getByText(/Disposition sent/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Disposition sent/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("data health: a payment on the wrong lease is moved after approval", async ({ page }) => {
  const errors = await as(page, "grace");
  await go(page, "/app/receivables/payments/pay-000211?tab=payment_health");
  await expect(page.getByText("payment looks posted to the wrong lease")).toBeVisible();
  await page.getByRole("button", { name: "Apply fix" }).click();
  await expect(page.getByText(/Moved \$125\.00 to L-10018/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("mark a payment returned: the amount and capped fee are stated, the ledger shows it returned", async ({ page }) => {
  const errors = await as(page, "grace");
  await go(page, "/app/receivables/ledger/L-10494");
  await page.getByRole("button", { name: /^Mark Payment .* returned$/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/returned-payment fee is charged \(TX cap\)/)).toBeVisible();
  await dialog.getByLabel(/^Note/).fill("R01");
  await dialog.getByRole("button", { name: "Mark returned and charge $30.00" }).click();
  await expect(page.getByText(/Marked \$[\d,.]+ returned; \$30\.00 fee charged/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "Returned", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Returned payment fee/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
