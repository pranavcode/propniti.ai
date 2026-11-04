import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, go, watch } from "./helpers";

// An agent run reads as plain sentences: records linked by name, no raw step kinds or JSON until
// a row's "Technical details" is opened.

test.describe.configure({ timeout: 180_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

test("a run page shows each step in plain words, with the raw data behind Technical details", async ({ page, context }) => {
  await as(context, "daniel");
  const errors = watch(page);
  await go(page, `${BASE}/app/ai/activity?agent=leasing`);
  // The scheduled leasing run that proposed prospect follow-ups.
  await page.getByRole("row").filter({ hasText: "Found prospects waiting on a reply" }).first().getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: "Leasing Agent run" })).toBeVisible();

  const rows = page.locator("[data-trace-row]");
  const proposal = rows.filter({ hasText: /^Proposed “Send follow-up” for .+ \(prospect at .+\): no contact in \d+ days · 88% confidence/ }).first();
  await expect(proposal).toBeVisible();
  await expect(proposal.getByRole("link").first()).toHaveAttribute("href", /\/app\/leasing\/prospects\/pr-/);
  await expect(rows.filter({ hasText: /^Looked up \d+ prospects/ }).first()).toBeVisible();
  // No raw kind labels or JSON on the page until asked for.
  await expect(page.getByText("PROPOSAL", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/"confidence":/)).toHaveCount(0);

  const details = proposal.getByRole("button", { name: "Technical details" });
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await expect(proposal.getByText(/"action": "prospects\.send_follow_up"/)).toBeVisible();
  await expect(proposal.getByText(/"confidence": 0\.88/)).toBeVisible();
  await expect(proposal.getByText(/Step \d+ · Proposal · \d+ ms/)).toBeVisible();
  expect(errors).toEqual([]);
});
