import { expect, test, type Locator, type Page } from "@playwright/test";
import { as, BASE, go, watch } from "./helpers";

// Leasing flows: the leasing agent's day, the pipeline board (a move and a refused move), the
// listing editor's AI draft with the fair-housing check, the renewal offer from AI price to sent
// message, and the broker scoring and deciding an application. Every AI step must link to its run.
// Run against a dev server: BASE_URL=http://localhost:3201.

// A dev server compiles each page on first visit; give the first paint of a page room for that.
const FIRST_PAINT = { timeout: 30_000 };

// The pipeline board: columns are list items named "<Column>: <count>"; cards are list items inside.
class Board {
  readonly root: Locator;
  constructor(readonly page: Page) {
    this.root = page.getByRole("list", { name: "Leasing pipeline" });
  }
  column(name: string) {
    return this.root.getByRole("listitem", { name: new RegExp(`^${name}:`) });
  }
  // Any card will do: the board is live data, so the test takes the newest one in the column.
  async firstCard(column: string) {
    const card = this.column(column).getByRole("listitem").first();
    const name = (await card.getByRole("link").first().innerText()).trim();
    return { card, name };
  }
  async openMoveMenu(column: string) {
    const { card, name } = await this.firstCard(column);
    await card.getByRole("button", { name: `Move ${name}` }).click();
    return name;
  }
}

test("leasing agent: day, board move and the broker-only column", async ({ page, context }) => {
  await as(context, "lena");
  const errors = watch(page);

  await go(page, `${BASE}/app/leasing/today`);
  await expect(page.getByRole("heading", { level: 1, name: /Lena/ })).toBeVisible(FIRST_PAINT);
  await expect(page.getByRole("heading", { name: "Briefing" })).toBeVisible();
  await expect(page.getByText("Follow-ups due")).toBeVisible();

  await go(page, `${BASE}/app/leasing/pipeline`);
  const board = new Board(page);
  await expect(board.root).toBeVisible(FIRST_PAINT);
  const name = await board.openMoveMenu("Lead");
  await page.getByRole("menuitem", { name: "Tour", exact: true }).click();
  await expect(page.getByText(`${name} moved to Tour`)).toBeVisible();

  // Approval belongs to the broker: the menu item is disabled for a leasing agent.
  await board.openMoveMenu("Screening");
  await expect(page.getByRole("menuitem", { name: /^Approved/ })).toBeDisabled();
  await page.keyboard.press("Escape");

  expect(errors).toEqual([]);
});

test("listing editor: AI draft with its run, fair-housing flag blocks wording", async ({ page, context }) => {
  await as(context, "lena");
  const errors = watch(page);
  const list = await (await page.request.get(`${BASE}/api/e/listings?f.status=Active&size=1`)).json();
  await go(page, `${BASE}/app/leasing/listings/${list.rows[0].id}`);
  await expect(page.getByRole("heading", { name: "Headline and description" })).toBeVisible(FIRST_PAINT);

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
  await expect(page.getByText(/Saved\. The AI draft run/)).toBeVisible(FIRST_PAINT);
  expect(errors).toEqual([]);
});

test("renewal: agent prices with reasons, person accepts, AI drafts, person sends", async ({ page, context }) => {
  await as(context, "lena");
  const errors = watch(page);
  await go(page, `${BASE}/app/leasing/renewals?status=Draft`);
  await page.getByRole("button", { name: /Ask the Renewals Agent|Price again/ }).click();
  await expect(page.getByText(/market rent/i).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("link", { name: "View run" }).first()).toHaveAttribute("href", /\/app\/ai\/runs\//);

  await page.getByRole("button", { name: /^(Accept|Save edit)$/ }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible(FIRST_PAINT);
  await page.getByRole("button", { name: "Draft with AI" }).click();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).not.toHaveValue("", { timeout: 60_000 });
  await page.getByRole("button", { name: "Send offer" }).click();
  await expect(page.getByText("Renewal offer sent")).toBeVisible(FIRST_PAINT);
  expect(errors).toEqual([]);
});

test("broker: scores an application with reasons and decides it on the record", async ({ page, context }) => {
  await as(context, "rachel");
  const errors = watch(page);
  await go(page, `${BASE}/app/leasing/broker`);
  await expect(page.getByRole("heading", { name: /Broker desk/ })).toBeVisible(FIRST_PAINT);
  await expect(page.getByText("Fair-housing language", { exact: true })).toBeVisible();
  // Oldest waiting application first; the run's workspace starts fresh, so it is still open.
  await page.getByRole("link", { name: "Review" }).first().click();
  await page.waitForURL(/\/app\/leasing\/applications\/[^/?]+$/);
  await expect(page.getByRole("heading", { name: "Leasing Agent score" })).toBeVisible(FIRST_PAINT);
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
  await expect(page.getByText("Application conditional")).toBeVisible(FIRST_PAINT);
  await expect(page.getByText(/Conditional by Rachel Moore/).first()).toBeVisible();
  expect(errors).toEqual([]);
});
