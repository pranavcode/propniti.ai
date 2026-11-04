import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, go, reload, watch } from "./helpers";

// Collapsible home sections: Daniel collapses the briefing, it stays collapsed across reloads
// (rendered collapsed by the server, from the pn_layout cookie), expands again, is kept per persona,
// and "Reset layout" in the profile menu brings every section back.

test.use({ navigationTimeout: 180_000, actionTimeout: 60_000 });
test.setTimeout(300_000);
const expect = baseExpect.configure({ timeout: 60_000 });

test("collapse the briefing, keep it across reloads, expand it, then reset the layout", async ({ page, context }) => {
  await as(context, "daniel");
  const errors = watch(page);
  await go(page, `${BASE}/app`);

  const toggle = page.getByRole("button", { name: "Briefing", exact: true });
  const body = page.locator(`[id="${await toggle.getAttribute("aria-controls")}"]`);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(body.getByText("What happened")).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText(/\d[\d,]* need you · \d+ to watch/)).toBeVisible();
  await expect(body.getByText("What happened")).toBeHidden();

  // The server renders it collapsed, so there is no flash of the open card on load.
  const html = await (await page.request.get(`${BASE}/app`)).text();
  expect(html).toMatch(/data-collapsed="true"/);

  await reload(page);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText(/need you · \d+ to watch/)).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await reload(page);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("What happened")).toBeVisible();

  // Keyboard works, and the charts collapse the same way.
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Charts", exact: true }).click();
  await expect(page.getByRole("button", { name: "Charts", exact: true })).toHaveAttribute("aria-expanded", "false");

  // Kept per persona: Marcus's briefing is still open.
  await as(context, "marcus");
  await go(page, `${BASE}/app/today`);
  await expect(page.getByRole("button", { name: "Your briefing", exact: true })).toHaveAttribute("aria-expanded", "true");

  await as(context, "daniel");
  await go(page, `${BASE}/app`);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Profile and role" }).click();
  await page.getByRole("menuitem", { name: /Reset layout/ }).click();
  await page.waitForLoadState("load");
  await go(page, `${BASE}/app`);
  await expect(page.getByRole("button", { name: "Briefing", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Charts", exact: true })).toHaveAttribute("aria-expanded", "true");
  expect((await context.cookies()).some((c) => c.name === "pn_layout")).toBe(false);

  expect(errors).toEqual([]);
});
