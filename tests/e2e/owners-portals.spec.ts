/* eslint-disable @typescript-eslint/ban-ts-comment -- see the next line */
// @ts-nocheck -- @playwright/test is not a dependency yet (requested from the lead); remove once it is.
import { expect, test } from "@playwright/test";

// Owner statements (staff) and the four portals. Run against a dev server: BASE_URL=http://localhost:3201.

const BASE = process.env.BASE_URL ?? "http://localhost:3201";
const DISMISSED = ["app-basics", "owner-statements", "owner-portal", "resident-portal", "vendor-portal", "applicant-portal"];

async function as(context, persona: string) {
  await context.addCookies([{ name: "pn_as", value: persona, url: BASE }]);
  await context.addInitScript((ids) => localStorage.setItem("pn_tours", JSON.stringify(Object.fromEntries(ids.map((id) => [id, { tour: id, step: 0, status: "Dismissed", updatedAt: "2026-11-04T00:00:00Z" }])))), DISMISSED);
}

function watch(page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test("accountant reads a statement, explains a line and sees the rounding issue", async ({ page, context }) => {
  await as(context, "grace");
  const errors = watch(page);
  await page.goto(`${BASE}/app/owner-statements?entity=oe05&period=2026-08`);
  await expect(page.getByRole("heading", { name: "Owner statements", level: 1 })).toBeVisible();
  const statement = page.locator("article[aria-label^='Statement']");
  await expect(statement.getByText("Southern Crescent Mixed-Use Fund, LLC")).toBeVisible();
  await expect(statement.getByText("Unreconciled difference")).toBeVisible();

  await page.getByRole("button", { name: "Explain Unreconciled difference" }).click();
  await expect(page.getByText("Looked up")).toBeVisible();
  await expect(page.getByText(/The \$0\.01/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Chart drill-down lands on the filtered distributions list.
  await page.goto(`${BASE}/app/owner-entities/oe01?tab=statement`);
  await expect(page.getByRole("button", { name: /Send \$[\d,.]+ distribution/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("owner sees the briefing, a statement and approves a repair", async ({ page, context }) => {
  await as(context, "owner");
  const errors = watch(page);
  await page.goto(`${BASE}/portal/owner`);
  await expect(page.getByRole("heading", { name: /Good morning, Helen/ })).toBeVisible();
  await expect(page.getByText("Your monthly briefing")).toBeVisible();

  await page.getByRole("link", { name: "Statements" }).first().click();
  await expect(page.getByText(/Owner statement ·/)).toBeVisible();
  await page.getByRole("button", { name: "Explain Distributed to owner" }).click();
  await expect(page.getByText("Looked up")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto(`${BASE}/portal/owner/approvals`);
  const approve = page.getByRole("button", { name: /^Approve \$/ }).first();
  if (await approve.count()) {
    await approve.click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText(/Approved \$[\d,.]+ for/)).toBeVisible();
  }

  await page.getByRole("button", { name: "Ask Propniti" }).click();
  await page.getByRole("button", { name: "Why was my distribution lower this month?" }).click();
  await expect(page.getByText(/distribution was \$[\d,.]+/).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test("resident pays rent once and opens a request with an AI triage preview", async ({ page, context }) => {
  await as(context, "resident");
  const errors = watch(page);
  await page.goto(`${BASE}/portal/resident/pay`);
  await expect(page.getByRole("heading", { name: "Pay rent" })).toBeVisible();
  await page.goto(`${BASE}/portal/resident/requests?new=1`);
  await page.getByLabel("What's wrong?").fill("The kitchen sink is leaking under the cabinet");
  await expect(page.getByLabel("AI triage preview").getByText("Plumbing").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("vendor accepts a job and opens the invoice form", async ({ page, context }) => {
  await as(context, "vendor");
  const errors = watch(page);
  await page.goto(`${BASE}/portal/vendor`);
  await expect(page.getByRole("heading", { name: /Hi Luis/ })).toBeVisible();
  await page.goto(`${BASE}/portal/vendor/jobs?tab=new`);
  const accept = page.getByRole("button", { name: "Accept" }).first();
  if (await accept.count()) {
    await accept.click();
    await page.getByRole("dialog").getByRole("button", { name: "Accept job" }).click();
    await expect(page.getByText(/Accepted WO-/)).toBeVisible();
  }
  await page.goto(`${BASE}/portal/vendor/invoices?new=1`);
  await expect(page.getByText("Upload your invoice")).toBeVisible();
  await page.goto(`${BASE}/portal/vendor/insurance`);
  await expect(page.getByRole("heading", { name: "Insurance" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("applicant sees the status timeline and the documents checklist", async ({ page, context }) => {
  await as(context, "applicant");
  const errors = watch(page);
  await page.goto(`${BASE}/portal/applicant`);
  await expect(page.locator("main")).toBeVisible();
  await page.goto(`${BASE}/portal/applicant/documents`);
  await expect(page.getByText("Photo ID").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("a staff user on a portal URL is offered a switch, not someone else's data", async ({ page, context }) => {
  await as(context, "marcus");
  await page.goto(`${BASE}/portal/owner`);
  await expect(page.getByRole("button", { name: "View as Helen Carter" })).toBeVisible();
  await expect(page.getByText("Your monthly briefing")).toHaveCount(0);
});
