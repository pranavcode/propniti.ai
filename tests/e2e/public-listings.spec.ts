import { expect, test, type Page } from "@playwright/test";

// The renter's path through the public site, signed out: search → listing → ask about the unit →
// book a tour → apply in five steps → status page. Run against a dev server:
// BASE_URL=http://localhost:3201 npx playwright test tests/e2e/public-listings.spec.ts

const BASE = process.env.BASE_URL ?? "http://localhost:3201";
const slow = expect.configure({ timeout: 120_000 });

test.setTimeout(900_000);

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/Download the React DevTools/.test(m.text()) && errors.push(m.text()));
  return errors;
}

test("a renter searches, asks, books a tour and applies without signing in", async ({ page }) => {
  const errors = watchErrors(page);

  // Search: the metro chooser and filters narrow server-paginated results, kept in the URL.
  await page.goto(`${BASE}/listings`, { timeout: 300_000 });
  await slow(page.getByRole("heading", { level: 1, name: "Find your next home" })).toBeVisible();
  // On a busy dev server a click can land before hydration; retry until the URL changes.
  await expect(async () => {
    await page.getByRole("region", { name: "Choose a metro" }).getByRole("link", { name: /^Austin/ }).first().click();
    await expect(page).toHaveURL(/metro=Austin/, { timeout: 20_000 });
  }).toPass({ timeout: 300_000 });
  await slow(page.getByRole("heading", { level: 1, name: "Homes for rent in Austin" })).toBeVisible();
  await expect(async () => {
    const one = page.getByRole("group", { name: "Bedrooms" }).getByRole("checkbox", { name: "1", exact: true });
    if (!(await one.isChecked())) await one.check({ force: true });
    else await one.dispatchEvent("change", { bubbles: true });
    await expect(page).toHaveURL(/beds=1/, { timeout: 20_000 });
  }).toPass({ timeout: 300_000 });
  const results = page.getByRole("list").filter({ has: page.locator("article") }).first();
  await slow(results.locator("article").first()).toBeVisible();
  const count = await results.locator("article").count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(12);
  await expect(results.locator("article").first()).toContainText("1 bed");

  // Listing: open the first result.
  await results.locator("article").first().getByRole("link").click();
  await slow(page).toHaveURL(/\/listings\/lst-/);
  const listingUrl = page.url();
  const listingId = listingUrl.split("/listings/")[1];
  await slow(page.getByRole("heading", { level: 2, name: "Pricing and fees" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Due before move-in" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Floor plan/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Floor plan/ })).toBeVisible();

  // Ask about this unit: a priced answer with its source, then a fair-housing refusal.
  const ask = page.getByRole("region", { name: /^Ask about unit/ });
  const sources = ask.getByText(/^Source:/);
  await ask.getByRole("button", { name: "What's the total to move in?" }).click();
  await slow(sources.first()).toBeVisible();
  await expect(ask).toContainText("Before move-in you pay");
  await expect(ask).toContainText(/Rule-based fallback|AI/);
  await ask.getByLabel("Your question about this home").fill("Is this a safe neighborhood for families?");
  await ask.getByLabel("Your question about this home").press("Enter");
  await slow(sources.nth(1)).toBeVisible();
  await expect(ask.getByText("Fair housing policy")).toBeVisible();
  await expect(ask).toContainText("I can't describe an area as safe or unsafe");

  // Book a tour: creates a prospect and a showing in this visitor's workspace.
  const tour = page.locator("#tour");
  await tour.getByText("Self-guided").click();
  await tour.getByLabel("Time").selectOption({ index: 3 });
  await tour.getByLabel("Full name").fill("Jordan Avery");
  await tour.getByLabel("Email").fill("jordan@example.com");
  await tour.getByLabel("Phone").fill("512-555-0199");
  await tour.getByRole("button", { name: "Book tour" }).click();
  await slow(tour.getByText(/^Tour booked:/)).toBeVisible();

  // Apply: step validation blocks an empty step and focuses the first invalid field.
  await page.goto(`${BASE}/apply/${listingId}`, { timeout: 300_000 });
  await slow(page.getByRole("heading", { level: 1, name: /^Apply for unit/ })).toBeVisible();
  await page.getByRole("button", { name: /^Continue/ }).click();
  await expect(page.getByText("Required").first()).toBeVisible();
  await expect(page.locator("#first_name")).toBeFocused();

  await page.locator("#first_name").fill("Jordan");
  await page.locator("#last_name").fill("Avery");
  await page.locator("#email").fill("jordan@example.com");
  await page.locator("#phone").fill("512-555-0199");
  await page.getByRole("button", { name: /^Continue/ }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Where you've lived" })).toBeVisible();
  await page.locator("#street").fill("4100 Speedway");
  await page.locator("#city").fill("Austin");
  await page.locator("#state").fill("TX");
  await page.locator("#zip").fill("78751");
  await page.locator("#since").fill("2023-06");
  await page.locator("#rent").fill("1450");
  await page.getByLabel("No", { exact: true }).check();
  await page.getByRole("button", { name: /^Continue/ }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Income" })).toBeVisible();
  await page.locator("#employment").selectOption("Employed");
  await page.locator("#employer").fill("Dell Technologies");
  await page.locator("#monthly_income").fill("6800");
  await page.locator("#credit").selectOption("Good");
  await page.getByRole("button", { name: /^Continue/ }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Documents" })).toBeVisible();
  const files = page.locator('input[type="file"]');
  await files.nth(0).setInputFiles({ name: "drivers-license.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(2048) });
  await files.nth(1).setInputFiles({ name: "paystub-oct.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(9000) });
  await expect(page.getByText("paystub-oct.pdf")).toBeVisible();
  await page.getByRole("button", { name: /^Continue/ }).click();

  await expect(page.getByRole("heading", { level: 2, name: "Review and sign" })).toBeVisible();
  await page.getByRole("checkbox").nth(0).check();
  await page.getByRole("checkbox").nth(1).check();
  await page.locator("#signature").fill("Someone Else");
  await page.getByRole("button", { name: "Submit application" }).click();
  await expect(page.getByText("Type your name exactly as entered in step 1")).toBeVisible();
  await page.locator("#signature").fill("Jordan Avery");
  await page.getByRole("button", { name: "Submit application" }).click();

  // Status: what happens next, and the broker-side screening panel.
  await slow(page).toHaveURL(/\/status\?app=app_/);
  await slow(page.getByRole("heading", { level: 1, name: "Thanks, Jordan. Your application is in." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What happens next" })).toBeVisible();
  await expect(page.getByText("Application received")).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI screening summary" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open the broker's approvals" })).toBeVisible();
  // The Leasing agent scores this application in the background; the page refreshes itself.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(/Jordan Avery .* score \d+/)).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 300_000 });
  await expect(page.getByRole("button", { name: "See the agent's steps" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("another visitor can't open someone else's application status", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const res = await page.goto(`${BASE}/apply/lst-u-p01-105/status?app=app_notyours`, { timeout: 300_000 });
  expect(res?.status()).toBe(404);
});

test("the ask route refuses cross-site posts and answers only about active listings", async ({ request }) => {
  const crossSite = await request.post(`${BASE}/listings/lst-u-p01-105/ask`, { headers: { Origin: "https://evil.example" }, data: { question: "How much is rent?" } });
  expect(crossSite.status()).toBe(403);
  const missing = await request.post(`${BASE}/listings/lst-does-not-exist/ask`, { headers: { Origin: BASE }, data: { question: "How much is rent?" }, timeout: 300_000 });
  expect(missing.status()).toBe(404);
  const tooLong = await request.post(`${BASE}/listings/lst-u-p01-105/ask`, { headers: { Origin: BASE }, data: { question: "x".repeat(301) } });
  expect(tooLong.status()).toBe(400);
});
