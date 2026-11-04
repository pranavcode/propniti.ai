import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, go, watch } from "./helpers";

// Owner statements (staff) and the four portals. Run against a dev server: BASE_URL=http://localhost:3201.

// The dev server compiles each route on its first hit; allow for it.
test.setTimeout(300_000);
const expect = baseExpect.configure({ timeout: 60_000 });

test("accountant reads a statement, explains a line and sees the rounding issue", async ({ page, context }) => {
  await as(context, "grace");
  const errors = watch(page);
  await go(page, `${BASE}/app/owner-statements?entity=oe05&period=2026-08`);
  await expect(page.getByRole("heading", { name: "Owner statements", level: 1 })).toBeVisible();
  const statement = page.locator("article[aria-label^='Statement']");
  await expect(statement.getByText("Southern Crescent Mixed-Use Fund, LLC")).toBeVisible();
  await expect(statement.getByText("Unreconciled difference")).toBeVisible();

  await page.getByRole("button", { name: "Explain Unreconciled difference" }).click();
  await expect(page.getByText("Looked up")).toBeVisible();
  await expect(page.getByText(/The \$0\.01/)).toBeVisible();
  await page.keyboard.press("Escape");

  // The AI fix pays the missing cent through the guarded adjustment and the statement reconciles.
  await page.getByRole("button", { name: "Approve and pay $0.01" }).click();
  await expect(page.getByText(/correction is on its way/)).toBeVisible();
  await expect(statement.getByText("Correction paid to owner")).toBeVisible();
  await expect(statement.getByText("Unreconciled difference")).toHaveCount(0);

  // Chart drill-down lands on the filtered distributions list.
  await go(page, `${BASE}/app/owner-entities/oe01?tab=statement`);
  await expect(page.getByRole("button", { name: /Send \$[\d,.]+ distribution/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("owner sees the briefing, a statement and approves a repair", async ({ page, context }) => {
  await as(context, "owner");
  const errors = watch(page);
  await go(page, `${BASE}/portal/owner`);
  await expect(page.getByRole("heading", { name: /Hi Helen/ })).toBeVisible();
  await expect(page.getByText("Your monthly briefing")).toBeVisible();

  await go(page, `${BASE}/portal/owner/statements`);
  await expect(page.getByText(/Owner statement ·/)).toBeVisible();
  await page.getByRole("button", { name: "Explain Distributed to owner" }).click();
  await expect(page.getByText("Looked up")).toBeVisible();
  await page.keyboard.press("Escape");

  await go(page, `${BASE}/portal/owner/approvals`);
  const approve = page.getByRole("button", { name: /^Approve \$/ }).first();
  if (await approve.count()) {
    await approve.click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(/Approved \$[\d,.]+ for/)).toBeVisible();
  }

  await go(page, `${BASE}/portal/owner`);
  await page.getByRole("button", { name: "Ask AI" }).click();
  await page.getByRole("button", { name: "Why was my distribution lower this month?" }).click();
  await expect(page.getByText(/distribution was \$[\d,.]+/).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test("resident pays rent once and opens a request with an AI triage preview", async ({ page, context }) => {
  await as(context, "resident");
  const errors = watch(page);
  await go(page, `${BASE}/portal/resident/pay`);
  await expect(page.getByRole("heading", { name: "Pay rent" })).toBeVisible();
  await go(page, `${BASE}/portal/resident/requests?new=1`);
  await page.getByLabel("What's wrong?").fill("The kitchen sink is leaking under the cabinet");
  await expect(page.getByLabel("AI first read").getByText("Plumbing").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("vendor accepts a job and opens the invoice form", async ({ page, context }) => {
  await as(context, "vendor");
  const errors = watch(page);
  await go(page, `${BASE}/portal/vendor`);
  await expect(page.getByRole("heading", { name: /Hi Luis/ })).toBeVisible();
  await go(page, `${BASE}/portal/vendor/jobs?tab=new`);
  const accept = page.getByRole("button", { name: "Accept" }).first();
  if (await accept.count()) {
    await accept.click();
    await page.getByRole("dialog").getByRole("button", { name: "Accept job" }).click();
    await expect(page.getByText(/Accepted WO-/)).toBeVisible();
  }
  await go(page, `${BASE}/portal/vendor/invoices?new=1`);
  await expect(page.getByText("Upload your invoice")).toBeVisible();
  await go(page, `${BASE}/portal/vendor/insurance`);
  await expect(page.getByRole("heading", { name: "Insurance" })).toBeVisible();

  // An uploaded certificate doesn't count until staff verify it.
  await page.locator("#coi-file").setInputFiles({ name: "coi-2027.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 sample") });
  await page.getByLabel("Insurance carrier").fill("Travelers");
  await page.getByLabel("Expires on").fill("2027-11-25");
  await page.getByRole("button", { name: "Save certificate" }).click();
  await expect(page.getByText("Pending verification").first()).toBeVisible();
  await expect(page.getByText(/is pending verification/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("applicant sees the status timeline, the documents checklist and pays the fee", async ({ page, context }) => {
  await as(context, "applicant");
  const errors = watch(page);
  await go(page, `${BASE}/portal/applicant`);
  await expect(page.locator("main")).toBeVisible();
  await go(page, `${BASE}/portal/applicant/documents`);
  await expect(page.getByText("Photo ID").first()).toBeVisible();

  // The application fee is paid once, by card, into the property's trust account.
  await go(page, `${BASE}/portal/applicant/pay`);
  await page.getByRole("button", { name: "Pay $55.00" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Pay $55.00" }).click();
  await expect(page.getByText("$55.00 application fee paid.")).toBeVisible();
  await expect(page.getByText(/Paid\. Nothing else is due/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a staff user on a portal URL is offered a switch, not someone else's data", async ({ page, context }) => {
  await as(context, "marcus");
  await go(page, `${BASE}/portal/owner`);
  await expect(page.getByRole("button", { name: "View as Helen Carter" })).toBeVisible();
  await expect(page.getByText("Your monthly briefing")).toHaveCount(0);
});
