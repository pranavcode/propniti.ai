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

test("follow-ups: AI draft edited and sent, then Send all, and Send follow-up on the record", async ({ page, context }) => {
  await as(context, "lena");
  const errors = watch(page);
  await go(page, `${BASE}/app/leasing/today`);
  const section = page.locator("[data-tour=leasing-followups]");
  await expect(section).toBeVisible(FIRST_PAINT);

  // Draft opens an editable AI draft in place (not the chat), with its run; Send sends the edit.
  const draft = section.getByRole("button", { name: /^Draft a follow-up to / }).first();
  const who = (await draft.getAttribute("aria-label"))!.replace("Draft a follow-up to ", "");
  await draft.click();
  const message = section.getByRole("textbox", { name: "Message", exact: true });
  await expect(message).not.toHaveValue("", { timeout: 60_000 });
  await expect(section.getByRole("link", { name: "View run" })).toHaveAttribute("href", /\/app\/ai\/runs\//);
  await message.fill(`${await message.inputValue()}\nP.S. Saturday tours are open too.`);
  await section.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(`Follow-up sent to ${who}`)).toBeVisible(FIRST_PAINT);

  // Send all: confirm, progress, summary.
  await page.getByRole("button", { name: /^Send all \d+/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Send \d+$/ }).click();
  await expect(page.getByRole("dialog").getByText(/^Sent \d+/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();

  // A lead record has the one-click action (with a confirmation).
  const list = await (await page.request.get(`${BASE}/api/e/prospects?f.stage=Inquiry&size=1`)).json();
  await go(page, `${BASE}/app/leasing/prospects/${list.rows[0].id}`);
  await page.getByRole("button", { name: "Send follow-up" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(/Follow-up sent to|already got a follow-up today/)).toBeVisible(FIRST_PAINT);
  expect(errors).toEqual([]);
});

test("renewals: prepare all drafts as proposals, then send the selected ones", async ({ page, context }) => {
  await as(context, "lena");
  const errors = watch(page);
  await go(page, `${BASE}/app/leasing/renewals?window=30`);
  const card = page.locator("[data-tour=renewals-prepare]");
  await expect(card).toBeVisible(FIRST_PAINT);
  const prepare = card.getByRole("button", { name: /^Prepare all drafts \(\d+\)/ });
  if (await prepare.isVisible()) {
    await prepare.click();
    await expect(card.getByText(/^Prepared \d+/)).toBeVisible({ timeout: 120_000 });
  }
  // Each prepared offer shows its rent change, reasons and message, and links to its run.
  await expect(card.getByRole("link", { name: "View run" }).first()).toHaveAttribute("href", /\/app\/ai\/runs\//);
  const sendSelected = card.getByRole("button", { name: /^Send selected \(\d+\)/ });
  await expect(sendSelected).toBeEnabled({ timeout: 30_000 });
  await sendSelected.click();
  await page.getByRole("dialog").getByRole("button", { name: /^Send \d+$/ }).click();
  await expect(card.getByText(/^Sent \d+/)).toBeVisible({ timeout: 120_000 });
  expect(errors).toEqual([]);
});

test("broker desk: Rewrite with AI on a fair-housing flag, checked again before use", async ({ page, context }) => {
  await as(context, "rachel");
  const errors = watch(page);
  await go(page, `${BASE}/app/leasing/broker`);
  const rewrite = page.locator("[data-tour=broker-compliance]").getByRole("link", { name: "Rewrite with AI" }).first();
  await expect(rewrite).toBeVisible(FIRST_PAINT);
  await rewrite.click();
  await page.waitForURL(/\/app\/leasing\/listings\/[^/?]+\?rewrite=1/);
  // The editor starts the draft on its own and shows the check on the rewritten text.
  await expect(page.getByText("AI draft", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Fair-housing check on this draft: no issues/)).toBeVisible();
  await page.getByRole("button", { name: "Use draft, then edit" }).click();
  await expect(page.getByText("Fair-housing language check")).toBeVisible();
  expect(errors).toEqual([]);
});

test("broker desk: reassign an agent's stale leads, then follow up on another agent's", async ({ page, context }) => {
  await as(context, "rachel");
  const errors = watch(page);
  await go(page, `${BASE}/app/leasing/broker`);
  const team = page.locator("[data-tour=broker-agents]");
  await expect(team).toBeVisible(FIRST_PAINT);

  await team.getByRole("button", { name: /^Reassign .+'s stale leads$/ }).first().click();
  const dialog = page.getByRole("dialog");
  // Only agents whose assignments cover the leads' properties can be picked; the seed gives each
  // property one agent, so the dialog explains how to add coverage when nobody else covers them.
  const combo = dialog.getByRole("combobox", { name: "New agent" });
  if (await combo.isEnabled()) {
    await combo.click();
    await page.getByRole("option", { disabled: false }).first().click();
    await dialog.getByRole("button", { name: /^Reassign \d+$/ }).click();
    await expect(dialog.getByText(/^Reassigned \d+/)).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole("button", { name: "Done" }).click();
  } else {
    await expect(dialog.getByText(/No other leasing agent is assigned/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  }

  await team.getByRole("button", { name: /^Follow up: / }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /^Send \d+$/ }).click();
  await expect(page.getByRole("dialog").getByText(/^Sent \d+/)).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});

test("pipeline: Undo in the move toast puts the card back", async ({ page, context }) => {
  await as(context, "lena");
  const errors = watch(page);
  await go(page, `${BASE}/app/leasing/pipeline`);
  const board = new Board(page);
  await expect(board.root).toBeVisible(FIRST_PAINT);
  const name = await board.openMoveMenu("Lead");
  await page.getByRole("menuitem", { name: "Tour", exact: true }).click();
  await expect(page.getByText(`${name} moved to Tour`)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText(`${name} moved back to Lead`)).toBeVisible(FIRST_PAINT);
  await expect(board.column("Lead").getByRole("link", { name, exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
