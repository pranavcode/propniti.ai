import { expect, test, type Page } from "@playwright/test";

// Residents lane flows in a real browser: Today, the unified inbox with an AI-suggested reply,
// lease abstraction with "AI: fix this", the duplicate-resident merge and the announcement
// composer. Each test gets a fresh context, so a fresh visitor overlay; base data is untouched.
// The seed ids used here (L-10601 with swapped dates, res-p01-0076 and its duplicate) are planted
// by the generator's corrupted cases.
const BASE = process.env.BASE_URL ?? "http://localhost:3201";

async function as(page: Page, persona: string) {
  await page.context().addCookies([{ name: "pn_as", value: persona, url: BASE }]);
  await page.addInitScript(() => {
    const at = new Date().toISOString();
    localStorage.setItem("pn_tours", JSON.stringify(Object.fromEntries(["app-basics", "pm-today"].map((t) => [t, { tour: t, step: 0, status: "Dismissed", updatedAt: at }]))));
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/favicon|404/.test(m.text()) && errors.push(m.text()));
  return errors;
}
const go = (page: Page, path: string) => page.goto(BASE + path, { waitUntil: "load" });

test.describe.configure({ timeout: 300_000 });

test("Today: briefing, KPIs that drill, charts and the approvals queue", async ({ page }) => {
  const errors = await as(page, "marcus");
  await go(page, "/app/today");
  await expect(page.getByRole("heading", { name: /^Good (morning|afternoon|evening), Marcus/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your briefing" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  await expect(page.getByText("Needs you").first()).toBeVisible();
  await expect(page.getByText("Lease expirations by month")).toBeVisible();
  await page.getByRole("link", { name: /Leases ending in 60 days/ }).click();
  await expect(page).toHaveURL(/\/app\/leases\?view=expiring-60/);
  expect(errors).toEqual([]);
});

test("inbox: suggest a reply, edit it and send it on the conversation", async ({ page }) => {
  const errors = await as(page, "marcus");
  await go(page, "/app/communications/inbox?kind=resident");
  const pane = page.getByRole("region", { name: "Conversation" });
  await pane.getByRole("button", { name: /Suggest a reply|Regenerate/ }).first().click();
  await expect(pane.getByText("Suggested reply")).toBeVisible({ timeout: 60_000 });
  await pane.getByRole("button", { name: "Use reply" }).click();
  const box = pane.getByRole("textbox", { name: "Reply" });
  const text = `${await box.inputValue()} (checked by Marcus)`;
  await box.fill(text);
  await pane.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/sent \(simulated\)/)).toBeVisible();
  await expect(pane.getByText("(checked by Marcus)")).toBeVisible();
  await expect(pane.getByText("AI-drafted").last()).toBeVisible();
  expect(errors).toEqual([]);
});

test("lease abstraction cites pages, flags swapped dates and fixes the record", async ({ page }) => {
  const errors = await as(page, "marcus");
  await go(page, "/app/leases/L-10601?tab=abstraction");
  await page.getByRole("button", { name: /Abstract lease on file|Re-run/ }).click();
  await expect(page.getByText(/terms? in the document differ from the lease record/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: "Page 1" }).first()).toBeVisible();
  await expect(page.getByText("AI: fix expiration date from the signed lease")).toBeVisible();
  await page.getByRole("button", { name: "Apply fix" }).first().click();
  await expect(page.getByText(/Updated leases L-10601/)).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});

test("data health: merge a duplicate resident field by field", async ({ page }) => {
  const errors = await as(page, "marcus");
  await go(page, "/app/residents/res-p01-0076");
  await expect(page.getByText("Possible duplicate:")).toBeVisible();
  await page.getByRole("button", { name: "Review merge" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Suggested field choices")).toBeVisible();
  await dialog.getByRole("button", { name: /^Merge into/ }).click();
  await expect(page.getByText(/^Merged .* into /)).toBeVisible();
  await expect(page.getByText("Possible duplicate:")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("announcement: AI draft for a property, then send", async ({ page }) => {
  const errors = await as(page, "marcus");
  await go(page, "/app/communications/announcements/new");
  await page.getByLabel("What is it about?").fill("Water shutoff Thursday Nov 12, 9 am to 1 pm in building B for a valve replacement");
  await page.getByRole("button", { name: "Draft with AI" }).click();
  await expect(page.getByRole("link", { name: "View run" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel("Message")).not.toHaveValue("");
  await page.getByRole("button", { name: /^Send to \d+ residents/ }).click();
  await expect(page).toHaveURL(/\/app\/communications\/announcements\/ann-/);
  await expect(page.getByText("Sent").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("resident 360 links to the ledger and the lease", async ({ page }) => {
  const errors = await as(page, "marcus");
  await go(page, "/app/residents");
  await page.getByRole("cell", { name: /^Chloe Adams/ }).first().click();
  await expect(page.getByRole("heading", { name: "Delinquency risk" })).toBeVisible();
  await page.getByRole("link", { name: "Open lease" }).click();
  await expect(page).toHaveURL(/\/app\/leases\/L-/);
  await page.getByRole("link", { name: "Terms and schedule" }).click();
  await expect(page.getByRole("heading", { name: "Rent schedule" })).toBeVisible();
  expect(errors).toEqual([]);
});
