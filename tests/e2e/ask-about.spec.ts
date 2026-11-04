import { expect as baseExpect, test } from "@playwright/test";
import { as, BASE, go, watch } from "./helpers";

// "Ask about this" on a record opens the assistant at once on that record, with a context pill,
// the record's card and questions for its type, and sends nothing until a question is chosen.

test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

test("Ask about this opens on the record and sends nothing until a question is picked", async ({ page, context }) => {
  const errors = watch(page);
  await as(context, "marcus");
  const list = await (await page.request.get(`${BASE}/api/e/work_orders?size=1&sort=-estimate`)).json();
  const wo = list.rows[0] as { id: string; title: string; estimate: number | null };
  await go(page, `${BASE}/app/maintenance/work-orders/${encodeURIComponent(wo.id)}`);

  const asked: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/ai/assistant") asked.push(r.postData() ?? ""); });

  const started = Date.now();
  await page.getByRole("button", { name: "Ask about this" }).click();
  const dock = page.getByRole("complementary", { name: "Ask Propniti" });
  await expect(dock.getByText(`About: ${wo.title}`, { exact: false })).toBeVisible({ timeout: 2_000 });
  const opened = Date.now() - started;

  const card = dock.getByRole("region", { name: "About this work order" });
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: wo.title })).toBeVisible();
  await expect(dock.getByText("About: Work order ·")).toBeVisible();
  const why = dock.getByRole("button", { name: "Why is this taking long?" });
  await expect(why).toBeVisible();
  await expect(dock.getByRole("button", { name: "Which vendor should handle this?" })).toBeVisible();
  if (wo.estimate) await expect(dock.getByRole("button", { name: /^Is the \$[\d,]+ estimate normal for this job\?$/ })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(asked).toEqual([]);

  await why.click();
  await expect(dock.locator("[data-turn=user]").getByText("Why is this taking long?")).toBeVisible();
  await expect.poll(() => asked.length).toBe(1);
  expect(JSON.parse(asked[0]).context).toMatchObject({ entity: "work_orders", id: wo.id });
  await expect(dock.locator("[data-assistant-busy]")).toBeHidden({ timeout: 90_000 });
  const answer = dock.locator(".rounded-lg.border.bg-card").last();
  await expect(answer).toBeVisible();
  await expect(answer.locator("table")).toHaveCount(0);
  await expect(answer).not.toContainText(/\b(p\d\d|u-p\d\d-\w+|v\d\d)\b/);
  // The pill stays for follow-ups, and removing it makes the next question general.
  await dock.getByRole("button", { name: /Remove record context/ }).click();
  await expect(dock.getByText(/^About:/)).toHaveCount(0);
  console.log(`Ask about this: panel and pill shown ${opened} ms after the click`);
  expect(errors).toEqual([]);
});
