import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, go, watch } from "./helpers";

// Approvals inbox filters that survive paging and URL links, "approve all matching" with a count,
// "Notify approver" for someone who can't decide, and Data Health honouring the record and rule
// links other pages send, with removable filter pills and bulk actions across pages.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

test("Daniel's High-risk link keeps its filter on page 2 and in the URL", async ({ page, context }) => {
  await as(context, "daniel");
  const errors = watch(page);
  await go(page, `${BASE}/app/ai/approvals?f.risk=High`);
  await expect(page.getByRole("button", { name: /^High risk/ })).toHaveAttribute("aria-pressed", "true");
  const items = page.locator("article[id^=proposal-]");
  await expect(items.first()).toBeVisible();
  for (const risk of await items.locator("text=/^(Low|Medium|High) risk$/").allInnerTexts()) expect(risk).toBe("High risk");
  const next = page.getByRole("button", { name: "Next" });
  if (await next.isVisible() && await next.isEnabled()) {
    await next.click();
    await expect(page.getByText(/^Page 2 of/)).toBeVisible();
    for (const risk of await items.locator("text=/^(Low|Medium|High) risk$/").allInnerTexts()) expect(risk).toBe("High risk");
  }
  // Another filter joins the risk one in the URL; clearing drops both.
  await page.getByRole("button", { name: /^Agent/ }).click();
  await page.getByRole("menuitemradio").nth(1).click();
  await expect(page).toHaveURL(/[?&]risk=High/);
  await expect(page).toHaveURL(/[?&]agent=/);
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).not.toHaveURL(/risk=|agent=/);
  expect(errors).toEqual([]);
});

test("Marcus sees how many low-risk items match on every page before approving them", async ({ page, context }) => {
  await as(context, "marcus");
  await go(page, `${BASE}/app/ai/approvals?risk=Low`);
  await page.getByRole("button", { name: "Approve all low-risk matching" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /^(Approve \d+ low-risk items?\?|Nothing to approve in bulk)$/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("Sam can't decide approvals, so he can notify the approver", async ({ page, context }) => {
  await as(context, "sam");
  // Admins approve compliance items themselves; data fixes and bills go to someone else, so they
  // sit under "Waiting on others", not "Needs you".
  await go(page, `${BASE}/app/ai/approvals?tab=waiting&agent=data_health`);
  await expect(page.getByRole("tab", { name: /^Waiting on others/, selected: true })).toBeVisible();
  // This tab lists rows (div), not cards (article).
  const first = page.locator("[id^=proposal-]").filter({ has: page.getByRole("button", { name: "Notify approver" }) }).first();
  const item = page.locator(`[id="${await first.getAttribute("id")}"]`);
  await expect(item.getByRole("button", { name: /Needs approver/ })).toBeVisible();
  await item.getByRole("button", { name: "Notify approver" }).click();
  // A rerun on the same day finds it already sent; the first click names who was notified.
  await expect(page.getByText(/^(Notified |Already notified today)/)).toBeVisible();
  if (await page.getByText(/^Notified /).isVisible()) await expect(item.getByRole("button", { name: "Notify approver" })).toBeHidden();
});

test("Data Health honours rule and record links, shows removable pills and bulk counts", async ({ page, context }) => {
  await as(context, "marcus");
  const errors = watch(page);
  await go(page, `${BASE}/app/data-health?f.rule_id=bill_lines.gl_miscoded`);
  // Issues name their rule in words, not by key: every card on the page is from this rule.
  await expect(page.getByText("Rule: GL account doesn't fit the line")).toBeVisible();
  const cards = page.getByRole("button", { name: "Send for approval", exact: true });
  await expect(cards.first()).toBeVisible();
  await expect(page.getByText(/^GL account doesn't fit the line · /)).toHaveCount(await cards.count());
  // GL recodes move money, so a property manager can't dismiss them; only the principal or a payables approver can.
  await expect(page.getByRole("button", { name: "Dismiss" })).toHaveCount(0);
  // GL recodes move money: the rule's fixes go to the approvals inbox in one click, after a confirm.
  await page.getByRole("button", { name: /^Send all \d+\+? for approval$/ }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: /^Send \d+ fixes for approval\?$/ })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("link", { name: "Remove rule filter" }).click();
  await expect(page).not.toHaveURL(/rule/);

  // A record link (as the record page and drawer send it): only that lease's issues, as a pill.
  await go(page, `${BASE}/app/data-health?f.entity_id=L-10094`);
  await expect(page.getByText("Record: L-10094")).toBeVisible();
  await expect(page.getByText(/^1 issues · page 1 of 1$/)).toBeVisible();
  expect(errors).toEqual([]);
});
