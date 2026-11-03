/* eslint-disable @typescript-eslint/ban-ts-comment -- see the next line */
// @ts-nocheck -- @playwright/test is not a dependency yet (requested from the lead); remove once it is.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Leasing flows: the leasing agent's day, the pipeline board (a move and a refused move), the
// listing editor's AI draft with the fair-housing check, the renewal offer from AI price to sent
// message, and the broker scoring and deciding an application. Every AI step must link to its run.
// Run against a dev server: BASE_URL=http://localhost:3201.

const BASE = process.env.BASE_URL ?? "http://localhost:3201";
const TOURS = ["app-basics", "leasing-agent", "broker"];

async function as(context: BrowserContext, persona: string) {
  await context.addCookies([{ name: "pn_as", value: persona, url: BASE }]);
  await context.addInitScript((ids: string[]) => localStorage.setItem("pn_tours", JSON.stringify(Object.fromEntries(ids.map((t) => [t, { tour: t, step: 0, status: "Dismissed", updatedAt: "2026-11-04T00:00:00Z" }])))), TOURS);
}

function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return errors;
}

test("leasing agent: day, board move and the broker-only column", async ({ page, context }) => {
  await as(context, "lena");
  const errors = watch(page);

  await page.goto(`${BASE}/app/leasing/today`);
  await expect(page.getByRole("heading", { level: 1, name: /Lena/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Briefing" })).toBeVisible();
  await expect(page.getByText("Follow-ups due")).toBeVisible();

  await page.goto(`${BASE}/app/leasing/pipeline`);
  const board = page.getByRole("list", { name: "Leasing pipeline" });
  await expect(board).toBeVisible();
  const lead = board.getByRole("listitem", { name: /^Lead:/ });
  const first = lead.locator("li").first();
  const name = (await first.locator("a").first().innerText()).trim();
  await first.getByRole("button", { name: `Move ${name}` }).click();
  await page.getByRole("menuitem", { name: "Tour" }).click();
  await expect(page.getByText(`${name} moved to Tour`)).toBeVisible();

  // Approval belongs to the broker: the menu item is disabled for a leasing agent.
  const screening = board.getByRole("listitem", { name: /^Screening:/ }).locator("li").first();
  const sName = (await screening.locator("a").first().innerText()).trim();
  await screening.getByRole("button", { name: `Move ${sName}` }).click();
  await expect(page.getByRole("menuitem", { name: "Approved" })).toBeDisabled();
  await page.keyboard.press("Escape");

  expect(errors).toEqual([]);
});

test("listing editor: AI draft with its run, fair-housing flag blocks wording", async ({ page, context }) => {
  await as(context, "lena");
  const errors = watch(page);
  const list = await (await page.request.get(`${BASE}/api/e/listings?f.status=Active&size=1`)).json();
  await page.goto(`${BASE}/app/leasing/listings/${list.rows[0].id}`);
  await expect(page.getByRole("heading", { name: "Headline and description" })).toBeVisible();

  await page.getByRole("button", { name: "Draft with AI" }).click();
  const draft = page.getByText("AI draft", { exact: true });
  await expect(draft).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: "View run" }).first()).toHaveAttribute("href", /\/app\/ai\/runs\//);
  await page.getByRole("button", { name: "Use draft, then edit" }).click();

  const desc = page.getByPlaceholder(/Describe the home/);
  await desc.fill(`${await desc.inputValue()} Perfect for young professionals.`);
  await expect(page.getByText(/fair-housing issue/)).toBeVisible();
  await desc.fill((await desc.inputValue()).replace(" Perfect for young professionals.", ""));
  await expect(page.getByText("Fair-housing language check")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Saved\. The AI draft run/)).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("renewal: agent prices with reasons, person accepts, AI drafts, person sends", async ({ page, context }) => {
  await as(context, "lena");
  const errors = watch(page);
  await page.goto(`${BASE}/app/leasing/renewals?status=Draft`);
  await page.getByRole("button", { name: /Ask the Renewals agent|Price again/ }).click();
  await expect(page.getByText(/market rent/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: "View run" }).first()).toHaveAttribute("href", /\/app\/ai\/runs\//);

  await page.getByRole("button", { name: /^(Accept|Save edit)$/ }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Draft with AI" }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).not.toHaveValue("", { timeout: 60_000 });
  await page.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByText("Renewal offer sent")).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("broker: scores an application with reasons and decides it on the record", async ({ page, context }) => {
  await as(context, "rachel");
  const errors = watch(page);
  await page.goto(`${BASE}/app/leasing/broker`);
  await expect(page.getByRole("heading", { name: /Broker desk/ })).toBeVisible();
  await expect(page.getByText("Fair-housing language", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Review" }).first().click();

  await expect(page.getByRole("heading", { name: "Leasing agent score" })).toBeVisible();
  await expect(page.getByText("Fair-housing safe scoring")).toBeVisible();
  await page.getByRole("button", { name: /Score with AI|Re-score/ }).click();
  await expect(page.getByRole("img", { name: /Score \d+ out of 100/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Reasons for")).toBeVisible();
  await expect(page.getByRole("link", { name: "View run" })).toHaveAttribute("href", /\/app\/ai\/runs\//);

  // A conditional approval needs a reason for the adverse-action record.
  await page.getByRole("button", { name: "Approve with conditions" }).click();
  await expect(page.getByText(/Add a reason first/)).toBeVisible();
  await page.getByLabel("Reason or conditions").fill("One extra month of deposit");
  await page.getByRole("button", { name: "Approve with conditions" }).click();
  await expect(page.getByText("Application conditional")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Conditional by Rachel Moore/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
